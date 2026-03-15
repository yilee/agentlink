/**
 * Context Compaction E2E tests
 *
 * Verifies that context compaction system messages render correctly
 * and that the UI disables input during compaction.
 *
 * Protocol:
 *   Agent → Web: { type: 'context_compaction', status: 'started' }
 *   Agent → Web: { type: 'context_compaction', status: 'completed' }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19880;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/compaction-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/compaction-test' });

  return { agent, page };
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

describe('Context Compaction', () => {
  it('TC-1: compaction started shows system message with spinner', async () => {
    const { agent, page } = await setupTest('Compact1');
    try {
      // Agent sends compaction started
      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });

      // System message should appear with compact-msg class
      await page.waitForSelector('.system-msg.compact-msg', { timeout: 3000 });
      const msgCount = await page.locator('.system-msg.compact-msg').count();
      expect(msgCount).toBe(1);

      // Should show the spinner (not the done icon)
      const spinnerCount = await page.locator('.compact-inline-spinner').count();
      expect(spinnerCount).toBe(1);

      const doneIconCount = await page.locator('.compact-done-icon').count();
      expect(doneIconCount).toBe(0);

      // Message text should contain "Context compacting..."
      const msgText = await page.locator('.system-msg.compact-msg').textContent();
      expect(msgText).toContain('Context compacting');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: compaction completed updates message text and shows done icon', async () => {
    const { agent, page } = await setupTest('Compact2');
    try {
      // Start compaction
      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });
      await page.waitForSelector('.system-msg.compact-msg', { timeout: 3000 });

      // Complete compaction
      agent.sendEncrypted({ type: 'context_compaction', status: 'completed' });
      await delay(300);

      // Message text should update to "Context compacted"
      const msgText = await page.locator('.system-msg.compact-msg').textContent();
      expect(msgText).toContain('Context compacted');

      // Spinner should be gone, done icon should appear
      const spinnerCount = await page.locator('.compact-inline-spinner').count();
      expect(spinnerCount).toBe(0);

      const doneIconCount = await page.locator('.compact-done-icon').count();
      expect(doneIconCount).toBe(1);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: textarea placeholder changes during compaction and restores after', async () => {
    const { agent, page } = await setupTest('Compact3');
    try {
      // Before compaction, placeholder should be the default
      const defaultPlaceholder = await page.locator('textarea').getAttribute('placeholder');
      expect(defaultPlaceholder).toContain('Send a message');

      // Start compaction
      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });
      await page.waitForSelector('.system-msg.compact-msg', { timeout: 3000 });
      await delay(200);

      // During compaction, placeholder should change
      const compactingPlaceholder = await page.locator('textarea').getAttribute('placeholder');
      expect(compactingPlaceholder).toContain('Compacting context');

      // Attach button should be disabled during compaction
      const attachDisabled = await page.locator('.attach-btn').isDisabled();
      expect(attachDisabled).toBe(true);

      // Complete compaction
      agent.sendEncrypted({ type: 'context_compaction', status: 'completed' });
      await delay(300);

      // Placeholder should restore to default
      const restoredPlaceholder = await page.locator('textarea').getAttribute('placeholder');
      expect(restoredPlaceholder).toContain('Send a message');

      // Attach button should be re-enabled
      const attachEnabled = await page.locator('.attach-btn').isDisabled();
      expect(attachEnabled).toBe(false);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
