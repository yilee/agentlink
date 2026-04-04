/**
 * Fork Conversation functional tests
 *
 * Verifies the fork conversation flow:
 * - Fork button appears on assistant messages
 * - Clicking fork button instantly creates new conversation with collapsible context
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19892;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/fork-test');
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/fork-test' });

  return { agent, page };
}

/** Helper: send a user message and have the agent respond with text */
async function sendAndRespond(agent: MockAgent, page: Page, userText: string, assistantText: string): Promise<void> {
  // Type message and send
  await page.fill('textarea', userText);
  await page.click('button[type="submit"], .send-btn');

  // Wait for chat message from agent side
  await agent.waitForMessage((m) => m.type === 'chat');

  // Send session_started so currentClaudeSessionId is set
  agent.sendEncrypted({ type: 'session_started', claudeSessionId: 'test-session-' + Date.now() });

  // Send assistant response
  agent.sendEncrypted({
    type: 'claude_output',
    data: { type: 'content_block_delta', delta: assistantText },
  });
  agent.sendEncrypted({ type: 'turn_completed' });

  // Wait for the assistant bubble to appear with the text
  await page.waitForSelector('.assistant-bubble', { timeout: 5000 });
  await delay(300);
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

describe('Fork Conversation', () => {
  it('TC-1: fork button appears on assistant messages', async () => {
    const { agent, page } = await setupTest('Fork1');
    try {
      await sendAndRespond(agent, page, 'Hello', 'Hi there!');

      // Hover over assistant bubble to show actions
      await page.hover('.assistant-bubble');
      await delay(200);

      // Fork button should exist in message-actions
      const forkBtns = await page.locator('.message-actions .icon-btn').count();
      // Should have at least 2 buttons (fork + copy)
      expect(forkBtns).toBeGreaterThanOrEqual(2);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: clicking fork button instantly creates new conversation', async () => {
    const { agent, page } = await setupTest('Fork2');
    try {
      await sendAndRespond(agent, page, 'Hello', 'Hi there!');

      // Drain ALL earlier messages so we start clean
      agent.drainMessages(() => true);

      // Set up a listener BEFORE clicking fork to catch messages as they arrive
      const forkChatPromise = agent.waitForMessage((m) => {
        return m.type === 'chat';
      }, 8000);

      // Click the fork button
      await page.hover('.assistant-bubble');
      await delay(200);
      await page.click('.message-actions .icon-btn:first-child');

      // Wait for the fork-context-wrapper to confirm fork code ran
      await page.waitForSelector('.fork-context-wrapper', { timeout: 5000 });

      // Now wait for the chat message
      const chatMsg = await forkChatPromise;
      expect(chatMsg).toBeDefined();
      const prompt = chatMsg.prompt as string;
      expect(prompt).toContain('[Fork Context]');
      expect(prompt).toContain('conversation history from a previous session');
      expect(prompt).toContain('[User]\nHello');
      expect(prompt).toContain('[Assistant]\nHi there!');

      const forkCtx = await page.locator('.fork-context-wrapper').count();
      expect(forkCtx).toBe(1);

      const bodyVisible = await page.locator('.fork-context-wrapper .context-summary-body').count();
      expect(bodyVisible).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: fork-context block can be expanded and collapsed', async () => {
    const { agent, page } = await setupTest('Fork3');
    try {
      await sendAndRespond(agent, page, 'Hello', 'Hi there!');

      // Click fork button to instantly fork
      await page.hover('.assistant-bubble');
      await delay(200);
      agent.drainMessages((m) => m.type === 'chat');
      await page.click('.message-actions .icon-btn:first-child');

      await page.waitForSelector('.fork-context-wrapper', { timeout: 5000 });
      await delay(300);

      // Click to expand
      await page.click('.fork-context-bar');
      await delay(300);

      // Body should now be visible
      const bodyExpanded = await page.locator('.fork-context-wrapper .context-summary-body').count();
      expect(bodyExpanded).toBe(1);

      // Click to collapse again
      await page.click('.fork-context-bar');
      await delay(300);

      const bodyCollapsed = await page.locator('.fork-context-wrapper .context-summary-body').count();
      expect(bodyCollapsed).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-4: fork includes tool messages in context', async () => {
    const { agent, page } = await setupTest('Fork4');
    try {
      // Send user message
      await page.fill('textarea', 'Edit the file');
      await page.click('button[type="submit"], .send-btn');
      await agent.waitForMessage((m) => m.type === 'chat');
      agent.sendEncrypted({ type: 'session_started', claudeSessionId: 'test-session-tools' });

      // Send tool_use (Edit tool)
      agent.sendEncrypted({
        type: 'claude_output',
        data: {
          type: 'tool_use',
          tools: [{ id: 'tool-1', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'foo', new_string: 'bar' } }],
        },
      });

      // Send tool result
      agent.sendEncrypted({
        type: 'claude_output',
        data: {
          type: 'user',
          tool_use_result: { tool_use_id: 'tool-1', content: 'File edited successfully' },
        },
      });

      // Send assistant text after tool
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Done editing.' },
      });
      agent.sendEncrypted({ type: 'turn_completed' });
      await page.waitForSelector('.assistant-bubble', { timeout: 5000 });
      await delay(300);

      // Fork from the assistant message
      agent.drainMessages((m) => m.type === 'chat');
      await page.hover('.assistant-bubble');
      await delay(200);
      await page.click('.message-actions .icon-btn:first-child');

      // Verify the fork chat includes tool info
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat', 5000);
      const prompt = chatMsg.prompt as string;
      expect(prompt).toContain('[Tool: Edit]');
      expect(prompt).toContain('/src/app.ts');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
