/**
 * Chat Search functional tests.
 *
 * Tests sidebar session filtering and in-conversation message search
 * using a mock agent and Playwright.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19893;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/chat-search-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/chat-search-test' });

  return { agent, page };
}

function sendFakeSessions(agent: MockAgent, sessions: Array<{ sessionId: string; title: string; preview: string; lastModified: number }>) {
  agent.sendEncrypted({ type: 'sessions_list', sessions, workDir: '/chat-search-test' });
}

/** Send a user message through the UI and simulate an assistant response. */
async function simulateExchange(page: Page, agent: MockAgent, userText: string, assistantText: string) {
  // Type and send user message through the UI
  await page.fill('textarea', userText);
  await page.click('.send-btn');

  // Wait for agent to receive the chat message
  await agent.waitForMessage((m) => m.type === 'chat');

  // Simulate assistant streaming response
  agent.sendEncrypted({
    type: 'claude_output',
    data: { type: 'content_block_delta', delta: assistantText },
  });
  agent.sendEncrypted({ type: 'turn_completed' });

  // Wait for turn to complete (stop button disappears)
  await page.waitForFunction(() => !document.querySelector('.stop-btn'), { timeout: 5000 });
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

describe('Chat Search: Session filtering', () => {
  it('search icon opens search input and filters sessions by title', async () => {
    const { agent, page } = await setupTest('SessionSearch1');
    try {
      // Send some fake sessions
      const now = Date.now();
      sendFakeSessions(agent, [
        { sessionId: 's1', title: 'Fix authentication bug', preview: 'auth middleware issue', lastModified: now },
        { sessionId: 's2', title: 'Add dark mode feature', preview: 'CSS theme toggle', lastModified: now - 1000 },
        { sessionId: 's3', title: 'Refactor database layer', preview: 'optimize queries', lastModified: now - 2000 },
      ]);

      // Wait for sessions to render
      await page.waitForSelector('.session-item', { timeout: 5000 });
      const initialCount = await page.locator('.session-item').count();
      expect(initialCount).toBe(3);

      // Click the search icon button in sidebar
      const searchBtn = page.locator('.sidebar-sessions .sidebar-section-header button[title="Search sessions"]');
      await searchBtn.click();

      // Search input should appear
      await page.waitForSelector('.sidebar-search-input', { timeout: 3000 });

      // Type a query that matches only one session
      await page.fill('.sidebar-search-input', 'authentication');
      await delay(200);

      // Should filter to 1 session
      const filtered = await page.locator('.session-item').count();
      expect(filtered).toBe(1);

      // Verify the matching session title is shown
      const sessionText = await page.locator('.session-item').first().textContent();
      expect(sessionText).toContain('Fix authentication bug');

      // Close the search
      await page.click('.sidebar-search-close');
      await page.waitForSelector('.sidebar-search-input', { state: 'detached', timeout: 3000 });

      // All sessions should be visible again
      await delay(200);
      const restored = await page.locator('.session-item').count();
      expect(restored).toBe(3);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('shows empty state when no sessions match', async () => {
    const { agent, page } = await setupTest('SessionSearch2');
    try {
      const now = Date.now();
      sendFakeSessions(agent, [
        { sessionId: 's1', title: 'Hello world', preview: 'test', lastModified: now },
      ]);

      await page.waitForSelector('.session-item', { timeout: 5000 });

      // Open search
      const searchBtn = page.locator('.sidebar-sessions .sidebar-section-header button[title="Search sessions"]');
      await searchBtn.click();
      await page.waitForSelector('.sidebar-search-input', { timeout: 3000 });

      // Type a non-matching query
      await page.fill('.sidebar-search-input', 'zzz_no_match_here');
      await delay(200);

      // Should show empty state text
      const emptyText = await page.locator('.sidebar-empty').textContent();
      expect(emptyText).toBeTruthy();

      // No session items visible
      const count = await page.locator('.session-item').count();
      expect(count).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('Escape key closes session search', async () => {
    const { agent, page } = await setupTest('SessionSearch3');
    try {
      const now = Date.now();
      sendFakeSessions(agent, [
        { sessionId: 's1', title: 'Session A', preview: '', lastModified: now },
      ]);

      await page.waitForSelector('.session-item', { timeout: 5000 });

      // Open search
      const searchBtn = page.locator('.sidebar-sessions .sidebar-section-header button[title="Search sessions"]');
      await searchBtn.click();
      await page.waitForSelector('.sidebar-search-input', { timeout: 3000 });

      // Press Escape
      await page.press('.sidebar-search-input', 'Escape');

      // Search input should be gone
      await page.waitForSelector('.sidebar-search-input', { state: 'detached', timeout: 3000 });
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

describe('Chat Search: Message search in outline', () => {
  it('searching messages shows results with highlight', async () => {
    const { agent, page } = await setupTest('MsgSearch1');
    try {
      // Send messages through the UI
      await simulateExchange(page, agent, 'How do I fix the authentication bug?', 'You should check the middleware configuration.');
      await simulateExchange(page, agent, 'What about the database layer?', 'The database queries need optimization.');

      // Open the outline panel via the toggle button
      const outlineBtn = page.locator('.outline-toggle-btn');
      await outlineBtn.click();
      await page.waitForSelector('.chat-outline-panel', { timeout: 3000 });

      // The search input should be visible inside the outline
      const searchInput = page.locator('.chat-outline-search-input');
      expect(await searchInput.isVisible()).toBe(true);

      // Type a search query
      await searchInput.fill('authentication');
      await delay(200);

      // Should show search results
      const results = await page.locator('.chat-search-result').count();
      expect(results).toBeGreaterThanOrEqual(1);

      // Result should contain highlighted text
      const markCount = await page.locator('.chat-search-result mark').count();
      expect(markCount).toBeGreaterThanOrEqual(1);

      // Result count text should be visible
      const countText = await page.locator('.chat-outline-search-count').textContent();
      expect(countText).toContain('match');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('clearing search shows outline items again', async () => {
    const { agent, page } = await setupTest('MsgSearch2');
    try {
      await simulateExchange(page, agent, 'Hello world', 'Hi there!');

      // Open outline
      const outlineBtn = page.locator('.outline-toggle-btn');
      await outlineBtn.click();
      await page.waitForSelector('.chat-outline-panel', { timeout: 3000 });

      // Verify outline items are visible (user questions)
      await delay(200);
      const outlineItems = await page.locator('.chat-outline-item:not(.chat-search-result)').count();
      expect(outlineItems).toBeGreaterThanOrEqual(1);

      // Search for something
      const searchInput = page.locator('.chat-outline-search-input');
      await searchInput.fill('hello');
      await delay(200);

      // Should show search results mode
      const searchResults = await page.locator('.chat-search-result').count();
      expect(searchResults).toBeGreaterThanOrEqual(1);

      // Clear search
      await searchInput.fill('');
      await delay(200);

      // Outline items should be back
      const restoredItems = await page.locator('.chat-outline-item:not(.chat-search-result)').count();
      expect(restoredItems).toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('shows no results message for non-matching query', async () => {
    const { agent, page } = await setupTest('MsgSearch3');
    try {
      await simulateExchange(page, agent, 'Hello world', 'Hi there!');

      // Open outline
      const outlineBtn = page.locator('.outline-toggle-btn');
      await outlineBtn.click();
      await page.waitForSelector('.chat-outline-panel', { timeout: 3000 });

      // Search for non-existent text
      const searchInput = page.locator('.chat-outline-search-input');
      await searchInput.fill('zzz_nonexistent_query');
      await delay(200);

      // Should show the "no results" empty state
      const emptyEl = page.locator('.chat-outline-empty');
      expect(await emptyEl.isVisible()).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
