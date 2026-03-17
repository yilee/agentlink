/**
 * Git Panel functional tests
 *
 * Verifies the Git panel UI: opening, branch display, file groups,
 * diff viewing, refresh, close, and edge states (not a repo, clean tree,
 * detached HEAD).
 *
 * Protocol:
 *   Web -> Agent: { type: 'git_status' }
 *   Web -> Agent: { type: 'git_diff', filePath: string, staged: boolean }
 *   Agent -> Web: { type: 'git_status_result', isRepo, branch, ... }
 *   Agent -> Web: { type: 'git_diff_result', filePath, staged, diff, binary }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19886;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/git-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });
  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/git-test' });
  await delay(200);
  return { agent, page };
}

/**
 * Clicks the sidebar workdir row, opens the dropdown menu, then clicks
 * the "Git" menu item.  Waits for the .git-panel element to appear.
 */
async function clickGitMenuItem(page: Page): Promise<void> {
  await page.click('.sidebar-workdir-path-row');
  await page.waitForSelector('.workdir-menu', { timeout: 3000 });
  const gitMenuItem = page.locator('.workdir-menu-item', { hasText: 'Git' });
  await gitMenuItem.click();
  await page.waitForSelector('.git-panel', { timeout: 5000 });
}

/**
 * Opens the git panel via the sidebar workdir dropdown menu, waits for
 * the agent to receive the automatic git_status request, and sends
 * back the provided status result.
 */
async function openGitPanelAndRespond(
  agent: MockAgent, page: Page,
  statusResult: Record<string, unknown>,
): Promise<void> {
  agent.drainMessages((m) => m.type === 'git_status');
  const gitStatusPromise = agent.waitForMessage((m) => m.type === 'git_status', 10000);
  await clickGitMenuItem(page);
  await gitStatusPromise;
  agent.sendEncrypted(statusResult);
  await delay(500);
}

/**
 * Opens the git panel without sending a response (for tests that only
 * care about the request).
 */
async function openGitPanel(agent: MockAgent, page: Page): Promise<void> {
  agent.drainMessages((m) => m.type === 'git_status');
  const gitStatusPromise = agent.waitForMessage((m) => m.type === 'git_status', 10000);
  await clickGitMenuItem(page);
  await gitStatusPromise;
}

/** Standard git_status_result payload with files */
function fullGitStatusResult() {
  return {
    type: 'git_status_result',
    isRepo: true,
    branch: 'main',
    detachedHead: null,
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
    staged: [{ path: 'src/app.js', status: 'M' }],
    modified: [
      { path: 'src/utils.js', status: 'M' },
      { path: 'README.md', status: 'D' },
    ],
    untracked: [{ path: 'new-file.txt', status: '?' }],
  };
}

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  await stopServer(serverProc);
});

describe('Git Panel', () => {
  it('TC-1: opening git panel sends git_status request', async () => {
    const { agent, page } = await setupTest('GitTC1');
    try {
      await openGitPanel(agent, page);
      // openGitPanel already verified the agent received git_status
      // (it awaits gitStatusPromise internally). If we got here, it worked.
      expect(true).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: branch info displays correctly', async () => {
    const { agent, page } = await setupTest('GitTC2');
    try {
      await openGitPanelAndRespond(agent, page, fullGitStatusResult());

      // Wait for file groups to confirm data is received
      await page.waitForSelector('.git-group-header', { timeout: 5000 });

      const branchText = await page.locator('.git-branch-name').textContent();
      expect(branchText).toContain('main');

      // Tracking info should be displayed
      await page.waitForSelector('.git-tracking', { timeout: 3000 });
      const trackingText = await page.locator('.git-tracking').textContent();
      expect(trackingText).toContain('origin/main');

      const aheadText = await page.locator('.git-ahead').textContent();
      expect(aheadText).toContain('2');

      const behindText = await page.locator('.git-behind').textContent();
      expect(behindText).toContain('1');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: detached HEAD displays correctly', async () => {
    const { agent, page } = await setupTest('GitTC3');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: null,
        detachedHead: 'a1b2c3d',
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
      });

      await page.waitForSelector('.git-branch-name', { timeout: 5000 });
      const branchText = await page.locator('.git-branch-name').textContent();
      expect(branchText).toContain('a1b2c3d');

      // No tracking info should be shown
      const trackingCount = await page.locator('.git-tracking').count();
      expect(trackingCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-4: file groups render with counts and correct expand states', async () => {
    const { agent, page } = await setupTest('GitTC4');
    try {
      await openGitPanelAndRespond(agent, page, fullGitStatusResult());

      await page.waitForSelector('.git-group-header', { timeout: 3000 });
      await delay(300);

      // Should have 3 group headers
      const headers = page.locator('.git-group-header');
      const headerCount = await headers.count();
      expect(headerCount).toBe(3);

      // Check group header text content
      const headerTexts: string[] = [];
      for (let i = 0; i < headerCount; i++) {
        headerTexts.push((await headers.nth(i).textContent()) || '');
      }
      expect(headerTexts.some(t => t.includes('Staged') && t.includes('1'))).toBe(true);
      expect(headerTexts.some(t => t.includes('Modified') && t.includes('2'))).toBe(true);
      expect(headerTexts.some(t => t.includes('Untracked') && t.includes('1'))).toBe(true);

      // Staged group arrow should have .expanded class
      const stagedArrow = page.locator('.git-group-header', { hasText: 'Staged' }).locator('.git-group-arrow');
      const stagedArrowClass = await stagedArrow.getAttribute('class') || '';
      expect(stagedArrowClass).toContain('expanded');

      // Modified group arrow should have .expanded class
      const modifiedArrow = page.locator('.git-group-header', { hasText: 'Modified' }).locator('.git-group-arrow');
      const modifiedArrowClass = await modifiedArrow.getAttribute('class') || '';
      expect(modifiedArrowClass).toContain('expanded');

      // Untracked group should NOT be expanded by default
      const untrackedArrow = page.locator('.git-group-header', { hasText: 'Untracked' }).locator('.git-group-arrow');
      const untrackedArrowClass = await untrackedArrow.getAttribute('class') || '';
      expect(untrackedArrowClass).not.toContain('expanded');

      // Staged and modified file items should be visible, untracked should not
      // Staged has 1 file, modified has 2 files => 3 visible file items
      const visibleFiles = page.locator('.git-file-item');
      const visibleCount = await visibleFiles.count();
      expect(visibleCount).toBe(3); // 1 staged + 2 modified (untracked collapsed)
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-5: file entries show name, directory, and status', async () => {
    const { agent, page } = await setupTest('GitTC5');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: 'main',
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [{ path: 'src/deep/app.js', status: 'M' }],
        modified: [],
        untracked: [],
      });

      await page.waitForSelector('.git-file-item', { timeout: 3000 });

      const fileName = await page.locator('.git-file-name').first().textContent();
      expect(fileName?.trim()).toBe('app.js');

      const fileDir = await page.locator('.git-file-dir').first().textContent();
      expect(fileDir?.trim()).toBe('src/deep');

      const statusIcon = page.locator('.git-status-icon').first();
      const statusText = await statusIcon.textContent();
      expect(statusText?.trim()).toBe('M');

      const statusClasses = await statusIcon.getAttribute('class');
      expect(statusClasses).toContain('git-status-M');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-6: clean working tree state', async () => {
    const { agent, page } = await setupTest('GitTC6');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: 'main',
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
      });

      await page.waitForSelector('.git-clean-state', { timeout: 3000 });
      const cleanText = await page.locator('.git-clean-state').textContent();
      expect(cleanText).toContain('Clean working tree');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-7: not a git repository state', async () => {
    const { agent, page } = await setupTest('GitTC7');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: false,
        branch: null,
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
      });

      await page.waitForSelector('.git-not-repo', { timeout: 5000 });
      const notRepoText = await page.locator('.git-not-repo').textContent();
      expect(notRepoText).toContain('Not a git repository');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-8: clicking file opens diff in preview panel', async () => {
    const { agent, page } = await setupTest('GitTC8');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: 'main',
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [{ path: 'src/app.js', status: 'M' }],
        modified: [],
        untracked: [],
      });

      await page.waitForSelector('.git-file-item', { timeout: 3000 });

      // Click on the staged file entry
      await page.locator('.git-file-item').first().click();

      // Agent should receive git_diff with correct filePath and staged flag
      const diffMsg = await agent.waitForMessage((m) => m.type === 'git_diff', 5000);
      expect(diffMsg.filePath).toBe('src/app.js');
      expect(diffMsg.staged).toBe(true);

      // Send back a diff result with hunks
      agent.sendEncrypted({
        type: 'git_diff_result',
        filePath: 'src/app.js',
        staged: true,
        diff: [
          'diff --git a/src/app.js b/src/app.js',
          'index abc1234..def5678 100644',
          '--- a/src/app.js',
          '+++ b/src/app.js',
          '@@ -1,3 +1,4 @@',
          ' line1',
          '+added line',
          ' line2',
          ' line3',
        ].join('\n'),
        binary: false,
      });

      // Wait for the preview panel to appear with diff content
      await page.waitForSelector('.preview-panel', { timeout: 3000 });
      await page.waitForSelector('.diff-container', { timeout: 3000 });

      // Verify diff elements are rendered
      const hunkHeaderCount = await page.locator('.diff-hunk-header').count();
      expect(hunkHeaderCount).toBeGreaterThanOrEqual(1);

      const addLineCount = await page.locator('.diff-line-add').count();
      expect(addLineCount).toBeGreaterThanOrEqual(1);

      const contextLineCount = await page.locator('.diff-line-context').count();
      expect(contextLineCount).toBeGreaterThanOrEqual(1);

      // Verify the staged badge is displayed
      const badge = page.locator('.diff-status-badge');
      const badgeText = await badge.textContent();
      expect(badgeText).toContain('Staged');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-9: refresh button sends new git_status', async () => {
    const { agent, page } = await setupTest('GitTC9');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: 'main',
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
      });

      // Drain any existing git_status messages from the queue
      agent.drainMessages((m) => m.type === 'git_status');

      // Click the refresh button
      const refreshBtn = page.locator('.git-panel .file-panel-btn[title="Refresh"]');
      await refreshBtn.click();

      // Agent should receive another git_status
      const msg = await agent.waitForMessage((m) => m.type === 'git_status', 5000);
      expect(msg).toBeDefined();
      expect(msg.type).toBe('git_status');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-10: close button closes the panel', async () => {
    const { agent, page } = await setupTest('GitTC10');
    try {
      await openGitPanelAndRespond(agent, page, {
        type: 'git_status_result',
        isRepo: true,
        branch: 'main',
        detachedHead: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
      });

      // Verify git panel is visible
      const panelBefore = await page.locator('.git-panel').count();
      expect(panelBefore).toBe(1);

      // Click the close button
      const closeBtn = page.locator('.git-panel .file-panel-btn[title="Close"]');
      await closeBtn.click();
      await delay(500);

      // Git panel should be gone
      const panelAfter = await page.locator('.git-panel').count();
      expect(panelAfter).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
