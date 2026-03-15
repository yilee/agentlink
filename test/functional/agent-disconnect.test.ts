/**
 * Agent Disconnect edge-case E2E tests
 *
 * Extends existing reconnect tests with more edge cases:
 * - Disconnect during streaming
 * - Multiple rapid disconnects
 * - Chat history persistence
 * - Disconnect during AskUserQuestion
 *
 * Protocol:
 *   Server → Web: agent_disconnected, agent_reconnected
 *   Web → Agent: query_active_conversations
 *   Agent → Web: active_conversations
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19885;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/disconnect-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/disconnect-test' });

  return { agent, page };
}

/** Reconnect a new agent to the same session. */
async function reconnectAgent(sessionId: string, name: string): Promise<MockAgent> {
  return connectMockAgentEncrypted(PORT, name, '/disconnect-test', undefined, sessionId);
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

describe('Agent Disconnect Edge Cases', () => {
  it('TC-1: disconnect during streaming → reconnect → active_conversations restores state', async () => {
    const { agent, page } = await setupTest('Disconnect1');
    try {
      // Send a chat message
      await page.fill('textarea', 'hello streaming');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat', 3000);
      const conversationId = (chatMsg.conversationId as string) || 'conv-1';

      // Start streaming some output
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Partial response...' },
      });
      await delay(200);

      // Disconnect mid-stream
      const sessionId = agent.sessionId;
      agent.ws.close();

      // Wait for UI to show non-Connected status
      await page.waitForFunction(
        () => {
          const badge = document.querySelector('.badge');
          return badge && !badge.classList.contains('connected');
        },
        { timeout: 5000 },
      );

      // Reconnect with same sessionId
      const agent2 = await reconnectAgent(sessionId, 'Disconnect1-Reconnect');

      // Wait for Connected status
      await page.waitForSelector('.badge.connected', { timeout: 5000 });

      // Agent should receive query_active_conversations
      const queryMsg = await agent2.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        3000,
      );
      expect(queryMsg).not.toBeNull();

      // Respond with active conversation (still processing)
      agent2.sendEncrypted({
        type: 'active_conversations',
        conversations: [{
          conversationId,
          claudeSessionId: 'claude-123',
          isProcessing: true,
          isCompacting: false,
        }],
      });
      await delay(300);

      // Stop button should be visible (processing indicator restored)
      const stopBtn = await page.locator('.stop-btn').count();
      expect(stopBtn).toBeGreaterThanOrEqual(1);

      // Complete the turn
      agent2.sendEncrypted({ type: 'turn_completed' });
      await delay(300);

      agent2.ws.close();
    } finally {
      await page.close();
    }
  });

  it('TC-2: multiple rapid disconnect/reconnect cycles → UI settles to Connected', async () => {
    const { agent, page } = await setupTest('Disconnect2');
    const sessionId = agent.sessionId;

    try {
      // Rapid disconnect/reconnect 3 times
      let currentAgent = agent;
      for (let i = 0; i < 3; i++) {
        currentAgent.ws.close();
        await delay(300);
        currentAgent = await reconnectAgent(sessionId, `Disconnect2-R${i}`);

        // Consume query_active_conversations
        await currentAgent.waitForMessage(
          (m) => m.type === 'query_active_conversations',
          3000,
        ).catch(() => null);
        currentAgent.sendEncrypted({ type: 'active_conversations', conversations: [] });
      }

      // Final state: should be Connected
      await page.waitForSelector('.badge.connected', { timeout: 5000 });
      const badgeText = await page.locator('.badge').textContent();
      expect(badgeText?.toLowerCase()).toContain('connected');

      currentAgent.ws.close();
    } finally {
      await page.close();
    }
  });

  it('TC-3: chat history persists through disconnect/reconnect cycle', async () => {
    const { agent, page } = await setupTest('Disconnect3');

    try {
      // Send a message
      await page.fill('textarea', 'remember me');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      // Agent responds with text
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'I will remember you!' },
      });
      agent.sendEncrypted({ type: 'turn_completed' });
      await delay(500);

      // Verify message is visible
      const userBubble = await page.locator('.user-bubble').count();
      expect(userBubble).toBeGreaterThanOrEqual(1);

      // Disconnect
      const sessionId = agent.sessionId;
      agent.ws.close();
      await delay(500);

      // Reconnect
      const agent2 = await reconnectAgent(sessionId, 'Disconnect3-R');
      await page.waitForSelector('.badge.connected', { timeout: 5000 });

      // Consume query
      await agent2.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        3000,
      ).catch(() => null);
      agent2.sendEncrypted({ type: 'active_conversations', conversations: [] });
      await delay(300);

      // Messages should still be visible after reconnect
      const userBubbleAfter = await page.locator('.user-bubble').count();
      expect(userBubbleAfter).toBeGreaterThanOrEqual(1);

      // Check the message content survived
      const userText = await page.locator('.user-bubble').first().textContent();
      expect(userText).toContain('remember me');

      agent2.ws.close();
    } finally {
      await page.close();
    }
  });

  it('TC-4: disconnect during AskUserQuestion → reconnect → card still visible', async () => {
    const { agent, page } = await setupTest('Disconnect4');

    try {
      // Send ask_user_question
      agent.sendEncrypted({
        type: 'ask_user_question',
        requestId: 'req-disc-1',
        questions: [{
          header: 'Choice',
          question: 'Pick one?',
          options: [
            { label: 'Option A', description: 'First choice' },
            { label: 'Option B', description: 'Second choice' },
          ],
          multiSelect: false,
        }],
      });

      // Wait for card to appear
      await page.waitForSelector('.ask-question-card', { timeout: 3000 });
      const cardCount = await page.locator('.ask-question-card').count();
      expect(cardCount).toBe(1);

      // Disconnect
      const sessionId = agent.sessionId;
      agent.ws.close();
      await delay(500);

      // Reconnect
      const agent2 = await reconnectAgent(sessionId, 'Disconnect4-R');
      await page.waitForSelector('.badge.connected', { timeout: 5000 });

      // Consume query
      await agent2.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        3000,
      ).catch(() => null);
      agent2.sendEncrypted({ type: 'active_conversations', conversations: [] });
      await delay(300);

      // Ask question card should still be visible
      const cardCountAfter = await page.locator('.ask-question-card').count();
      expect(cardCountAfter).toBe(1);

      // User can still click an option and submit
      await page.locator('.ask-question-option').first().click();
      await page.click('.ask-question-submit');

      // The reconnected agent should receive the answer
      const answerMsg = await agent2.waitForMessage(
        (m) => m.type === 'ask_user_answer',
        3000,
      );
      expect(answerMsg.requestId).toBe('req-disc-1');

      agent2.ws.close();
    } finally {
      await page.close();
    }
  });

  it('TC-5: sidebar processing dot appears from active_conversations and clears on turn_completed', async () => {
    const { agent, page } = await setupTest('Disconnect5');

    try {
      // Send a chat message to establish a conversation
      await page.fill('textarea', 'test processing dot');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat', 3000);
      const conversationId = (chatMsg.conversationId as string) || 'conv-dot';
      const claudeSessionId = 'claude-dot-test';

      // Provide a sessions_list with our session so the sidebar has an item to show
      agent.sendEncrypted({
        type: 'sessions_list',
        sessions: [{ sessionId: claudeSessionId, title: 'Dot Test Session', lastModified: new Date().toISOString(), preview: 'test' }],
        workDir: '/disconnect-test',
      });
      await delay(300);

      // Disconnect
      const sessionId = agent.sessionId;
      agent.ws.close();
      await delay(500);

      // Reconnect
      const agent2 = await reconnectAgent(sessionId, 'Disconnect5-R');
      await page.waitForSelector('.badge.connected', { timeout: 5000 });

      // Consume query_active_conversations
      await agent2.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        3000,
      );

      // Respond with active conversation — this session is processing
      agent2.sendEncrypted({
        type: 'active_conversations',
        conversations: [{
          conversationId,
          claudeSessionId,
          isProcessing: true,
          isCompacting: false,
        }],
      });

      // Respond to sessions_list request with the same session
      await agent2.waitForMessage((m) => m.type === 'list_sessions', 3000).catch(() => null);
      agent2.sendEncrypted({
        type: 'sessions_list',
        sessions: [{ sessionId: claudeSessionId, title: 'Dot Test Session', lastModified: new Date().toISOString(), preview: 'test' }],
        workDir: '/disconnect-test',
      });
      await delay(500);

      // Sidebar should show .processing class on the session item
      const processingItems = await page.locator('.session-item.processing').count();
      expect(processingItems).toBeGreaterThanOrEqual(1);

      // Now complete the turn
      agent2.sendEncrypted({ type: 'turn_completed', conversationId });
      await delay(500);

      // Re-query will be sent since cache may not exist for this convId
      // Respond with empty active_conversations
      const reQuery = await agent2.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        3000,
      ).catch(() => null);
      if (reQuery) {
        agent2.sendEncrypted({ type: 'active_conversations', conversations: [] });
        await delay(500);
      }

      // Processing class should be gone from sidebar
      const processingAfter = await page.locator('.session-item.processing').count();
      expect(processingAfter).toBe(0);

      agent2.ws.close();
    } finally {
      await page.close();
    }
  });
});
