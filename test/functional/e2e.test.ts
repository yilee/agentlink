/**
 * Functional tests for AgentLink server + web UI.
 *
 * Spawns a real server process, connects a mock agent via raw WebSocket,
 * and uses Playwright to verify the web UI. No Claude CLI needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted,
} from './e2e-helpers';

const PORT = 19876; // High port unlikely to conflict
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

/** Connect a mock agent via WebSocket (unencrypted, for basic registration tests). */
function connectMockAgent(name = 'TestAgent', workDir = '/test'): Promise<{ ws: WebSocket; sessionId: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ type: 'agent', id: name, name, workDir, hostname: 'test-host' });
    const ws = new WebSocket(`ws://localhost:${PORT}/?${params}`);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        resolve({ ws, sessionId: msg.sessionId });
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Mock agent connect timeout')), 5000);
  });
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

describe('Functional: Server Health', () => {
  it('GET /api/health returns status ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });
});

describe('Functional: Agent Registration', () => {
  it('mock agent connects and receives sessionId', async () => {
    const { ws, sessionId } = await connectMockAgent();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
    ws.close();
  });

});

describe('Functional: Web UI', () => {
  it('session page shows Connected when agent is online', async () => {
    const { ws, sessionId } = await connectMockAgent('UIAgent', '/ui');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${sessionId}`);
      // Wait for the Connected status badge
      await page.waitForSelector('text=Connected', { timeout: 5000 });
      const text = await page.textContent('body');
      expect(text).toContain('UIAgent');
    } finally {
      await page.close();
      ws.close();
    }
  });

  it('session page shows waiting when agent is not connected', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/fakesession12345`);
      await page.waitForSelector('text=Waiting', { timeout: 5000 });
    } finally {
      await page.close();
    }
  });

  it('shows agent disconnected when agent drops', async () => {
    const { ws, sessionId } = await connectMockAgent('DropAgent', '/drop');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Kill the agent connection
      ws.close();

      // UI should show disconnected/waiting
      await page.waitForSelector('text=disconnected', { timeout: 5000 });
    } finally {
      await page.close();
    }
  });

  it('landing page loads at /', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(BASE_URL);
      const title = await page.title();
      expect(title.toLowerCase()).toContain('agenticworker');
    } finally {
      await page.close();
    }
  });
});

// ── Local helper for encrypted agent connection (wraps shared helper with local port) ──

function connectMockAgentEncryptedLocal(name = 'TestAgent', workDir = '/test', password?: string, sessionId?: string) {
  return connectMockAgentEncrypted(PORT, name, workDir, password, sessionId);
}

describe('Functional: Delete Session', () => {
  it('delete button appears on non-active session and confirmation dialog works', async () => {
    const agent = await connectMockAgentEncryptedLocal('DeleteAgent', '/delete-test');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Wait for the web UI to request session list, then respond with fake sessions
      const listReq = await agent.waitForMessage((m) => m.type === 'list_sessions');
      expect(listReq.type).toBe('list_sessions');

      // Send fake sessions list
      agent.sendEncrypted({
        type: 'sessions_list',
        sessions: [
          { sessionId: 'active-session-id', title: 'Active Session', preview: 'test', lastModified: Date.now() },
          { sessionId: 'old-session-id', title: 'Old Session To Delete', preview: 'old test', lastModified: Date.now() - 86400000 },
        ],
        workDir: '/delete-test',
      });

      // Wait for sessions to render in sidebar - toggle sidebar if needed
      await page.waitForSelector('.session-item', { timeout: 5000 });

      // Verify we have 2 sessions
      const sessionItems = await page.locator('.session-item').count();
      expect(sessionItems).toBe(2);

      // Hover over the second session to reveal delete button
      const secondSession = page.locator('.session-item').nth(1);
      await secondSession.hover();

      // The delete button should be visible on hover
      const deleteBtn = secondSession.locator('.session-delete-btn');
      expect(await deleteBtn.isVisible()).toBe(true);

      // Click the delete button
      await deleteBtn.click();

      // Confirmation dialog should appear
      await page.waitForSelector('.confirm-dialog', { timeout: 3000 });
      const dialogText = await page.textContent('.confirm-dialog');
      expect(dialogText).toContain('Old Session To Delete');
      expect(dialogText).toContain('cannot be undone');

      // Click cancel - dialog should close
      await page.click('.confirm-dialog-cancel');
      await page.waitForSelector('.confirm-dialog', { state: 'detached', timeout: 3000 });

      // Hover and click delete again, this time confirm
      await secondSession.hover();
      await deleteBtn.click();
      await page.waitForSelector('.confirm-dialog', { timeout: 3000 });

      // Set up listener for the delete_session message before clicking confirm
      const deleteReqPromise = agent.waitForMessage((m) => m.type === 'delete_session');
      await page.click('.confirm-dialog-btn');

      // Agent should receive delete_session
      const deleteReq = await deleteReqPromise;
      expect(deleteReq.type).toBe('delete_session');
      expect(deleteReq.sessionId).toBe('old-session-id');

      // Send session_deleted response
      agent.sendEncrypted({ type: 'session_deleted', sessionId: 'old-session-id' });

      // Wait for the session to be removed from the list
      await page.waitForFunction(() => {
        return document.querySelectorAll('.session-item').length === 1;
      }, { timeout: 3000 });

      const remaining = await page.locator('.session-item').count();
      expect(remaining).toBe(1);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

describe('Functional: Session Password Auth', () => {
  it('shows password dialog for protected session and authenticates', async () => {
    // Connect agent with password
    const agent = await connectMockAgentEncryptedLocal('AuthAgent', '/auth-test', 'mypassword');
    const page = await browser.newPage();
    try {
      // Clear any saved auth token
      await page.goto(BASE_URL);
      await page.evaluate((sid) => {
        localStorage.removeItem(`agentlink-auth-${sid}`);
      }, agent.sessionId);

      // Navigate to the protected session
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);

      // Should show the auth dialog instead of Connected
      await page.waitForSelector('.auth-dialog', { timeout: 5000 });
      const headerText = await page.textContent('.auth-dialog-header');
      expect(headerText).toContain('Session Protected');

      // Try wrong password first
      await page.fill('.auth-password-input', 'wrongpass');
      await page.click('.auth-submit-btn');

      // Should show error
      await page.waitForSelector('.auth-error', { timeout: 3000 });
      const errText = await page.textContent('.auth-error');
      expect(errText).toContain('Incorrect password');

      // Now enter correct password
      await page.fill('.auth-password-input', 'mypassword');
      await page.click('.auth-submit-btn');

      // Should transition to Connected
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Auth dialog should be gone
      const dialogCount = await page.locator('.auth-dialog').count();
      expect(dialogCount).toBe(0);

      // Auth token should be saved
      const token = await page.evaluate((sid) => {
        return localStorage.getItem(`agentlink-auth-${sid}`);
      }, agent.sessionId);
      expect(token).toBeTruthy();
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('auto-authenticates with saved token', async () => {
    // Connect agent with password
    const agent = await connectMockAgentEncryptedLocal('TokenAgent', '/token-test', 'tokenpass');
    const page = await browser.newPage();
    try {
      // First: authenticate to get a token
      await page.goto(BASE_URL);
      await page.evaluate((sid) => {
        localStorage.removeItem(`agentlink-auth-${sid}`);
      }, agent.sessionId);

      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('.auth-dialog', { timeout: 5000 });
      await page.fill('.auth-password-input', 'tokenpass');
      await page.click('.auth-submit-btn');
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Token should now be saved
      const token = await page.evaluate((sid) => {
        return localStorage.getItem(`agentlink-auth-${sid}`);
      }, agent.sessionId);
      expect(token).toBeTruthy();

      // Reload the page — should auto-connect without password dialog
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Auth dialog should never appear
      const dialogCount = await page.locator('.auth-dialog').count();
      expect(dialogCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('skips auth for sessions without password', async () => {
    // Connect agent WITHOUT password
    const agent = await connectMockAgentEncryptedLocal('NoAuthAgent', '/no-auth');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // No auth dialog should appear
      const dialogCount = await page.locator('.auth-dialog').count();
      expect(dialogCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── Chat Message Flow ──

describe('Functional: Chat Message Flow', () => {
  it('sends a chat message and receives streamed response with tool use', async () => {
    const agent = await connectMockAgentEncryptedLocal('ChatAgent', '/chat-test');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume the list_sessions request
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/chat-test' });

      // Type and send a user message
      await page.fill('textarea', 'Hello, Claude!');
      await page.click('.send-btn');

      // Agent should receive the chat message
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat');
      expect(chatMsg.prompt).toBe('Hello, Claude!');

      // User message should appear in the UI
      await page.waitForSelector('.user-bubble', { timeout: 3000 });
      const userText = await page.textContent('.user-bubble');
      expect(userText).toContain('Hello, Claude!');

      // Simulate Claude streaming text response
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Hello! How can I ' },
      });
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'help you today?' },
      });

      // Simulate a tool use
      agent.sendEncrypted({
        type: 'claude_output',
        data: {
          type: 'tool_use',
          tools: [{ id: 'tool_1', name: 'Read', input: { file_path: '/test/file.txt' } }],
        },
      });

      // Wait for tool block to appear
      await page.waitForSelector('.tool-line', { timeout: 5000 });
      const toolText = await page.textContent('.tool-name');
      expect(toolText).toContain('Read');

      // Simulate tool result
      agent.sendEncrypted({
        type: 'claude_output',
        data: {
          type: 'user',
          tool_use_result: { tool_use_id: 'tool_1', content: 'file contents here' },
        },
      });

      // Simulate more text after tool
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'I read the file for you.' },
      });

      // Send turn_completed
      agent.sendEncrypted({ type: 'turn_completed' });

      // Wait for processing to end — stop button should disappear
      await page.waitForFunction(() => {
        const btn = document.querySelector('.stop-btn');
        return !btn;
      }, { timeout: 5000 });

      // Verify the assistant text appeared (streaming reveal may take a moment)
      await page.waitForFunction(() => {
        const bubbles = document.querySelectorAll('.assistant-bubble');
        for (const b of bubbles) {
          if (b.textContent?.includes('help you today')) return true;
        }
        return false;
      }, { timeout: 5000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('cancel execution sends cancel and shows system message', async () => {
    const agent = await connectMockAgentEncryptedLocal('CancelAgent', '/cancel-test');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/cancel-test' });

      // Send a chat message
      await page.fill('textarea', 'Do something long');
      await page.click('.send-btn');

      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat');
      expect(chatMsg.prompt).toBe('Do something long');

      // Start streaming so UI is in processing state
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Working on it...' },
      });

      // Click the stop button
      await page.waitForSelector('.stop-btn', { timeout: 3000 });
      await page.click('.stop-btn');

      // Agent should receive cancel_execution
      const cancelMsg = await agent.waitForMessage((m) => m.type === 'cancel_execution');
      expect(cancelMsg.type).toBe('cancel_execution');

      // Agent sends execution_cancelled
      agent.sendEncrypted({ type: 'execution_cancelled' });

      // UI should show "Generation stopped"
      await page.waitForFunction(() => {
        const msgs = document.querySelectorAll('.system-msg');
        for (const m of msgs) {
          if (m.textContent?.includes('Generation stopped')) return true;
        }
        return false;
      }, { timeout: 5000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── Working Directory Change ──

describe('Functional: Working Directory Change', () => {
  it('folder picker opens and change_workdir updates UI', async () => {
    const agent = await connectMockAgentEncryptedLocal('WdAgent', '/original-dir');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/original-dir' });

      // Verify initial working directory is displayed
      await page.waitForFunction((dir: string) => {
        return document.body.textContent?.includes(dir) ?? false;
      }, '/original-dir', { timeout: 3000 });

      // Open the workdir dropdown menu and click "Change directory"
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Change directory');

      // Folder picker modal should appear
      await page.waitForSelector('.folder-picker-dialog', { timeout: 3000 });

      // Agent should receive a list_directory request
      const listDirMsg = await agent.waitForMessage((m) => m.type === 'list_directory');
      expect(listDirMsg.type).toBe('list_directory');

      // Respond with directory listing
      agent.sendEncrypted({
        type: 'directory_listing',
        dirPath: '/original-dir',
        entries: [
          { name: 'subdir1', type: 'directory' },
          { name: 'subdir2', type: 'directory' },
          { name: 'file.txt', type: 'file' },
        ],
      });

      // Wait for entries to render (only directories should show)
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.folder-picker-item');
        return items.length === 2; // subdir1 and subdir2, file.txt filtered out
      }, { timeout: 3000 });

      // Click on subdir1 to select it
      const firstItem = page.locator('.folder-picker-item').first();
      await firstItem.click();

      // Click confirm
      await page.click('.folder-picker-confirm');

      // Agent should receive change_workdir
      const changeMsg = await agent.waitForMessage((m) => m.type === 'change_workdir');
      expect(changeMsg.type).toBe('change_workdir');
      expect((changeMsg.workDir as string)).toContain('subdir1');

      // Agent sends workdir_changed
      agent.sendEncrypted({
        type: 'workdir_changed',
        workDir: '/original-dir/subdir1',
      });

      // UI should show the new working directory
      await page.waitForFunction(() => {
        return document.body.textContent?.includes('/original-dir/subdir1') ?? false;
      }, { timeout: 3000 });

      // Chat should be cleared with a system message about the directory change
      await page.waitForFunction(() => {
        const msgs = document.querySelectorAll('.system-msg');
        for (const m of msgs) {
          if (m.textContent?.includes('Working directory changed')) return true;
        }
        return false;
      }, { timeout: 3000 });

      // Agent should also receive a new list_sessions request after workdir change
      const newListReq = await agent.waitForMessage((m) =>
        m.type === 'list_sessions'
      );
      expect(newListReq.type).toBe('list_sessions');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── Session Resume ──

describe('Functional: Session Resume', () => {
  it('clicking a session in sidebar resumes it with history', async () => {
    const agent = await connectMockAgentEncryptedLocal('ResumeAgent', '/resume-test');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions and respond with sessions
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({
        type: 'sessions_list',
        sessions: [
          {
            sessionId: 'resume-session-abc',
            title: 'Previous Conversation',
            preview: 'We discussed testing',
            lastModified: Date.now() - 3600000,
          },
        ],
        workDir: '/resume-test',
      });

      // Wait for sessions to render in sidebar
      await page.waitForSelector('.session-item', { timeout: 5000 });

      // Click the session to resume it
      await page.click('.session-item');

      // Agent should receive resume_conversation
      const resumeMsg = await agent.waitForMessage((m) => m.type === 'resume_conversation');
      expect(resumeMsg.type).toBe('resume_conversation');
      expect(resumeMsg.claudeSessionId).toBe('resume-session-abc');

      // Agent sends conversation_resumed with history
      agent.sendEncrypted({
        type: 'conversation_resumed',
        claudeSessionId: 'resume-session-abc',
        history: [
          { role: 'user', content: 'How do I write tests?' },
          { role: 'assistant', content: 'You can use vitest for unit testing.' },
          { role: 'tool', toolId: 'tool_1', toolName: 'Read', toolInput: '{"file_path": "/test.ts"}' },
          { role: 'user', content: 'Thanks, what about E2E tests?' },
          { role: 'assistant', content: 'For E2E tests, Playwright is a great choice.' },
        ],
      });

      // Wait for history messages to render
      await page.waitForFunction(() => {
        const userBubbles = document.querySelectorAll('.user-bubble');
        return userBubbles.length >= 2;
      }, { timeout: 5000 });

      // Verify user messages
      const userBubbles = await page.locator('.user-bubble').allTextContents();
      expect(userBubbles.some(t => t.includes('How do I write tests?'))).toBe(true);
      expect(userBubbles.some(t => t.includes('what about E2E tests?'))).toBe(true);

      // Verify assistant messages
      const assistantBubbles = await page.locator('.assistant-bubble').allTextContents();
      expect(assistantBubbles.some(t => t.includes('vitest'))).toBe(true);
      expect(assistantBubbles.some(t => t.includes('Playwright'))).toBe(true);

      // Verify tool block
      const toolNames = await page.locator('.tool-name').allTextContents();
      expect(toolNames.some(t => t.includes('Read'))).toBe(true);

      // Verify system message about session restore
      await page.waitForFunction(() => {
        const msgs = document.querySelectorAll('.system-msg');
        for (const m of msgs) {
          if (m.textContent?.includes('Session restored')) return true;
        }
        return false;
      }, { timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── File Browser Panel ──

/** Helper: connect agent, open page, consume list_sessions */
async function setupFileBrowserTest(agentName: string, workDir: string) {
  const agent = await connectMockAgentEncryptedLocal(agentName, workDir);
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  // Consume list_sessions
  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir });

  return { agent, page };
}

/** Helper: respond to list_directory requests with sample entries */
function respondWithDirectoryListing(
  agent: MockAgent,
  dirPath: string,
  entries: Array<{ name: string; type: string }>,
) {
  agent.sendEncrypted({
    type: 'directory_listing',
    dirPath,
    entries,
    source: 'file_browser',
  });
}

describe('Functional: File Browser Panel', () => {
  it('opens file panel via workdir dropdown "Browse files" and shows tree', async () => {
    const { agent, page } = await setupFileBrowserTest('FileBrowseAgent', '/browse-test');
    try {
      // File panel should not be visible initially
      const panelCount = await page.locator('.file-panel').count();
      expect(panelCount).toBe(0);

      // Open workdir dropdown and click "Browse files"
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');

      // File panel should appear
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      // Agent should receive list_directory for the root
      const listDirMsg = await agent.waitForMessage((m) => m.type === 'list_directory');
      expect(listDirMsg.type).toBe('list_directory');

      // Respond with directory listing
      respondWithDirectoryListing(agent, '/browse-test', [
        { name: 'src', type: 'directory' },
        { name: 'docs', type: 'directory' },
        { name: 'README.md', type: 'file' },
        { name: 'package.json', type: 'file' },
      ]);

      // Wait for tree items to render
      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 4;
      }, { timeout: 5000 });

      // Verify file names rendered
      const names = await page.locator('.file-tree-name').allTextContents();
      expect(names).toContain('src');
      expect(names).toContain('README.md');
      expect(names).toContain('package.json');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('closes file panel via close button', async () => {
    const { agent, page } = await setupFileBrowserTest('CloseAgent', '/close-test');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      // Consume list_directory
      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/close-test', [
        { name: 'file.txt', type: 'file' },
      ]);

      // Click close button (the X icon in the header)
      const closeBtn = page.locator('.file-panel-btn[title="Close"]');
      await closeBtn.click();

      // Panel should disappear
      await page.waitForSelector('.file-panel', { state: 'detached', timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('expands and collapses directories in file tree', async () => {
    const { agent, page } = await setupFileBrowserTest('ExpandAgent', '/expand-test');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      // Root listing
      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/expand-test', [
        { name: 'src', type: 'directory' },
        { name: 'config.json', type: 'file' },
      ]);

      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 2;
      }, { timeout: 5000 });

      // Click on the "src" directory to expand it
      await page.click('.file-tree-item.folder');

      // Agent should receive list_directory for the subdirectory
      const subDirMsg = await agent.waitForMessage((m) =>
        m.type === 'list_directory' && (m.dirPath as string).includes('src'),
      );
      expect(subDirMsg.type).toBe('list_directory');

      // Respond with subdirectory contents
      respondWithDirectoryListing(agent, subDirMsg.dirPath as string, [
        { name: 'index.ts', type: 'file' },
        { name: 'utils.ts', type: 'file' },
      ]);

      // Wait for subdirectory items to render (2 root + 2 sub = 4)
      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 4;
      }, { timeout: 5000 });

      // Verify expanded arrow
      const expandedArrow = await page.locator('.file-tree-arrow.expanded').count();
      expect(expandedArrow).toBe(1);

      // Click the folder again to collapse
      await page.click('.file-tree-item.folder');

      // Should go back to 2 items
      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 2;
      }, { timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('shows context menu on file click with actions', async () => {
    const { agent, page } = await setupFileBrowserTest('ContextAgent', '/ctx-test');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/ctx-test', [
        { name: 'app.js', type: 'file' },
        { name: 'style.css', type: 'file' },
      ]);

      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 2;
      }, { timeout: 5000 });

      // Right-click on a file (not a folder) to open context menu
      const firstFile = page.locator('.file-tree-item').first();
      await firstFile.click({ button: 'right' });

      // Context menu should appear
      await page.waitForSelector('.file-context-menu', { timeout: 3000 });

      // Verify menu items
      const menuItems = await page.locator('.file-context-item').allTextContents();
      const menuText = menuItems.map(t => t.trim());
      expect(menuText.some(t => t.includes('Ask Claude to read'))).toBe(true);
      expect(menuText.some(t => t.includes('Copy path'))).toBe(true);
      expect(menuText.some(t => t.includes('Insert path to input'))).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('"Ask Claude to read" populates input without sending', async () => {
    const { agent, page } = await setupFileBrowserTest('ReadAgent', '/read-test');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/read-test', [
        { name: 'data.json', type: 'file' },
      ]);

      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 1;
      }, { timeout: 5000 });

      // Right-click on file to open context menu
      await page.click('.file-tree-item', { button: 'right' });
      await page.waitForSelector('.file-context-menu', { timeout: 3000 });

      // Click "Ask Claude to read"
      await page.click('.file-context-item >> text=Ask Claude to read');

      // Context menu should close
      await page.waitForSelector('.file-context-menu', { state: 'detached', timeout: 3000 });

      // Input textarea should contain the read command but NOT be sent
      const inputValue = await page.locator('textarea').inputValue();
      expect(inputValue).toContain('Read the file');
      expect(inputValue).toContain('data.json');

      // No chat message should have been sent (no user bubble)
      const userBubbles = await page.locator('.user-bubble').count();
      expect(userBubbles).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('file panel shows correct breadcrumb matching workDir', async () => {
    const { agent, page } = await setupFileBrowserTest('BreadcrumbAgent', '/my/project/path');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/my/project/path', []);

      // Breadcrumb should show the workDir
      const breadcrumb = await page.textContent('.file-panel-breadcrumb');
      expect(breadcrumb).toContain('/my/project/path');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('refresh button reloads the file tree', async () => {
    const { agent, page } = await setupFileBrowserTest('RefreshAgent', '/refresh-test');
    try {
      // Open panel
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });
      await page.click('.workdir-menu-item >> text=Browse files');
      await page.waitForSelector('.file-panel', { timeout: 3000 });

      // First load
      await agent.waitForMessage((m) => m.type === 'list_directory');
      respondWithDirectoryListing(agent, '/refresh-test', [
        { name: 'old-file.txt', type: 'file' },
      ]);

      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 1;
      }, { timeout: 5000 });

      // Click refresh
      await page.click('.file-panel-btn[title="Refresh"]');

      // Agent should receive another list_directory
      const refreshMsg = await agent.waitForMessage((m) => m.type === 'list_directory');
      expect(refreshMsg.type).toBe('list_directory');

      // Respond with updated listing
      respondWithDirectoryListing(agent, '/refresh-test', [
        { name: 'old-file.txt', type: 'file' },
        { name: 'new-file.txt', type: 'file' },
      ]);

      // Wait for 2 items
      await page.waitForFunction(() => {
        return document.querySelectorAll('.file-tree-item').length === 2;
      }, { timeout: 5000 });

      const names = await page.locator('.file-tree-name').allTextContents();
      expect(names).toContain('new-file.txt');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── Workdir Dropdown Menu ──

// ── Reconnect + active_conversations handshake ──

describe('Functional: Reconnect Processing State', () => {
  it('sends query_active_conversations on initial connect and on agent_reconnected', async () => {
    const agent = await connectMockAgentEncryptedLocal('QueryActiveAgent', '/query-active');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/query-active' });

      // Web UI should send query_active_conversations on initial connect
      const activeQuery = await agent.waitForMessage((m) => m.type === 'query_active_conversations');
      expect(activeQuery.type).toBe('query_active_conversations');

      // No active conversations initially
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });

      // No stop button should be visible
      await page.waitForFunction(() => !document.querySelector('.stop-btn'), { timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('restores processing indicator when active_conversations reports active turn', async () => {
    const agent = await connectMockAgentEncryptedLocal('RestoreActiveAgent', '/restore-active');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions + query_active_conversations
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/restore-active' });
      await agent.waitForMessage((m) => m.type === 'query_active_conversations');
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });

      // Send a chat message so we can capture the real conversationId
      await page.fill('textarea', 'Test task');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat');
      const realConvId = chatMsg.conversationId as string;

      // Agent reports this conversation as active (simulates post-reconnect restore)
      agent.sendEncrypted({
        type: 'active_conversations',
        conversations: [{ conversationId: realConvId, claudeSessionId: null, isProcessing: true, isCompacting: false }],
      });

      // The UI should show the stop button since isProcessing was restored
      await page.waitForSelector('.stop-btn', { timeout: 5000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('clears stale processing state when active_conversations reports none active', async () => {
    const agent = await connectMockAgentEncryptedLocal('ClearStaleAgent', '/clear-stale');
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/clear-stale' });
      await agent.waitForMessage((m) => m.type === 'query_active_conversations');

      // Send a chat message to trigger processing state
      await page.fill('textarea', 'Hello');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat');

      // Start streaming — this sets isProcessing=true
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Working...' },
      });

      // Stop button should be visible
      await page.waitForSelector('.stop-btn', { timeout: 3000 });

      // Now simulate what happens after reconnect: the safety net left isProcessing=true
      // but the agent says actually nothing is active (task finished while disconnected)
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });

      // The authoritative active_conversations response should clear stale state
      // Stop button should disappear
      await page.waitForFunction(() => !document.querySelector('.stop-btn'), { timeout: 5000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('full disconnect-reconnect cycle with active_conversations handshake', async () => {
    // First agent connects
    const agent = await connectMockAgentEncryptedLocal('DisconnReconnAgent1', '/disconn-reconn');
    const savedSessionId = agent.sessionId;
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/s/${savedSessionId}`);
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume initial handshake
      await agent.waitForMessage((m) => m.type === 'list_sessions');
      agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/disconn-reconn' });
      await agent.waitForMessage((m) => m.type === 'query_active_conversations');
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });

      // Send a chat to capture the real conversationId
      await page.fill('textarea', 'Running task');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat');
      const realConvId = chatMsg.conversationId as string;

      // Disconnect the agent — server sends agent_disconnected to web client
      agent.ws.close();

      // Wait for the UI to show disconnected state (status changes to "Waiting")
      await page.waitForFunction(() => {
        return document.body.textContent?.includes('disconnected') ||
               document.body.textContent?.includes('Waiting');
      }, { timeout: 5000 });

      // Reconnect with a new agent (different id) but same sessionId
      const agent2 = await connectMockAgentEncryptedLocal('DisconnReconnAgent2', '/disconn-reconn', undefined, savedSessionId);

      // UI should show Connected again via agent_reconnected
      await page.waitForSelector('text=Connected', { timeout: 5000 });

      // Consume list_sessions
      await agent2.waitForMessage((m) => m.type === 'list_sessions');
      agent2.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/disconn-reconn' });

      // UI should send query_active_conversations on agent_reconnected
      const activeQuery = await agent2.waitForMessage((m) => m.type === 'query_active_conversations');
      expect(activeQuery.type).toBe('query_active_conversations');

      // Agent reports the original conversation is still active (using real convId)
      agent2.sendEncrypted({
        type: 'active_conversations',
        conversations: [{ conversationId: realConvId, claudeSessionId: null, isProcessing: true, isCompacting: false }],
      });

      // Stop button should appear
      await page.waitForSelector('.stop-btn', { timeout: 5000 });

      // Now complete the turn
      agent2.sendEncrypted({ type: 'turn_completed' });

      // Stop button should disappear
      await page.waitForFunction(() => !document.querySelector('.stop-btn'), { timeout: 5000 });
    } finally {
      await page.close();
    }
  });
});

describe('Functional: Workdir Dropdown Menu', () => {
  it('toggles open/close on path row click', async () => {
    const { agent, page } = await setupFileBrowserTest('MenuToggleAgent', '/toggle-test');
    try {
      // Menu should not be visible initially
      let menuCount = await page.locator('.workdir-menu').count();
      expect(menuCount).toBe(0);

      // Click path row to open
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });

      // Click path row again to close
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { state: 'detached', timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('closes on Escape key', async () => {
    const { agent, page } = await setupFileBrowserTest('EscAgent', '/esc-test');
    try {
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForSelector('.workdir-menu', { state: 'detached', timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('shows five menu items: Browse files, Change directory, Copy path, Memory, Git', async () => {
    const { agent, page } = await setupFileBrowserTest('MenuItemsAgent', '/items-test');
    try {
      await page.click('.sidebar-workdir-path-row');
      await page.waitForSelector('.workdir-menu', { timeout: 3000 });

      const items = await page.locator('.workdir-menu-item').allTextContents();
      const trimmed = items.map(t => t.trim());
      expect(trimmed).toEqual(['Browse files', 'Change directory', 'Copy path', 'Memory', 'Git', 'Proxy']);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
