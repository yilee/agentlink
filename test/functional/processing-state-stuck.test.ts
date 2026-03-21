/**
 * Processing state stuck — functional tests
 *
 * Verifies that `isProcessing` correctly resets to false after various
 * edge-case scenarios where `turn_completed` is lost or delayed.
 *
 * Bug 1: context_compaction(completed) doesn't reset the idle check timer.
 *   If the idle check fires and gets answered during compaction (agent says
 *   "yes, still active"), then compaction completes, and turn_completed is
 *   lost afterwards, NO new idle check is ever scheduled — UI stuck forever.
 *
 * Bug 2: lost turn_completed with no retry on idle check. If the single
 *   query_active_conversations gets no response, there is no retry.
 *
 * Protocol messages used:
 *   Agent → Web: claude_output, context_compaction, turn_completed, active_conversations
 *   Web → Agent: chat, query_active_conversations
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19887;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/stuck-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  // Consume initial list_sessions + query_active_conversations
  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/stuck-test' });

  const activeQuery = await agent.waitForMessage(
    (m) => m.type === 'query_active_conversations', 3000,
  ).catch(() => null);
  if (activeQuery) {
    agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
  }

  return { agent, page };
}

/** Check if the UI is in processing state (stop button visible). */
async function isUIProcessing(page: Page): Promise<boolean> {
  return (await page.locator('.stop-btn').count()) > 0;
}

/** Check if the UI is idle (no stop button, textarea enabled). */
async function isUIIdle(page: Page): Promise<boolean> {
  const stopBtnCount = await page.locator('.stop-btn').count();
  if (stopBtnCount > 0) return false;
  const placeholder = await page.locator('textarea').getAttribute('placeholder');
  return placeholder != null && placeholder.includes('Send a message');
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

describe('Bug 1: idle check consumed during compaction → no recovery after', () => {
  it('TC-1: idle check fires during compaction, answered "active" → compaction completes → turn_completed lost → UI stuck forever', async () => {
    // This is the KEY bug scenario:
    // 1. claude_output arrives → idle check timer starts (15s)
    // 2. Compaction starts during processing
    // 3. 15s passes, idle check fires, agent says "yes still active" (compacting)
    // 4. handleActiveConversations sets isProcessing=true and calls resetIdleCheck()
    //    which starts another 15s timer
    // 5. Compaction completes (context_compaction completed), but does NOT
    //    resetIdleCheck — the timer from step 4 keeps counting
    // 6. turn_completed is lost
    // 7. The 15s timer from step 4 fires, sends another query, agent says "not active"
    // 8. UI recovers — BUT ONLY after waiting the full 15s from step 4
    //
    // After fix: context_compaction(completed) should reset the idle check
    // with a SHORTER timeout (e.g. 3s) so recovery is faster.
    //
    // This test asserts the fix: after compaction completes (no turn_completed),
    // a new idle check should fire quickly (within 5s), not after 15s.
    const { agent, page } = await setupTest('Stuck1');
    try {
      await page.fill('textarea', 'test compaction idle race');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat', 3000);
      const conversationId = (chatMsg.conversationId as string) || 'conv-1';

      // Agent sends output → idle check timer starts (15s)
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Working...' },
      });
      await delay(200);
      expect(await isUIProcessing(page)).toBe(true);

      // Compaction starts
      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });
      await delay(200);

      // Wait for idle check to fire (15s from last claude_output)
      const firstQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations', 18000,
      );
      expect(firstQuery).not.toBeNull();

      // Agent responds: still active (compacting)
      agent.sendEncrypted({
        type: 'active_conversations',
        conversations: [{
          conversationId,
          claudeSessionId: 'claude-compacting',
          isProcessing: true,
          isCompacting: true,
        }],
      });
      await delay(500);

      // Compaction completes — but NO turn_completed follows
      // Drain any queued query_active_conversations from before
      agent.drainMessages((m) => m.type === 'query_active_conversations');
      agent.sendEncrypted({ type: 'context_compaction', status: 'completed' });

      // KEY ASSERTION: After the fix, context_compaction(completed) should
      // trigger a new idle check quickly. We check if a new
      // query_active_conversations arrives within 5 seconds.
      // With the bug, no query arrives until 15s later.
      const quickQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        5000,
      ).catch(() => null);

      // BUG: quickQuery is null — no fast idle check after compaction completed.
      // FIX: quickQuery should not be null — fast idle check should fire.
      expect(quickQuery).not.toBeNull();

      // If we get here (after fix), respond with "not active"
      if (quickQuery) {
        agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
        await delay(500);
        expect(await isUIIdle(page)).toBe(true);
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  }, 30000);

  it('TC-2: compaction completes, turn_completed lost — new idle check fires quickly (after fix)', async () => {
    // Simpler version of TC-1: short compaction within the 15s window.
    // After compaction completes without turn_completed, context_compaction(completed)
    // should schedule a new idle check with a short timeout.
    //
    // With the bug: the existing 15s timer (from last claude_output) will
    // eventually fire, but context_compaction(completed) doesn't help at all.
    //
    // After fix: context_compaction(completed) resets idle check with ~3s
    // timeout, so recovery is fast.
    const { agent, page } = await setupTest('Stuck2');
    try {
      await page.fill('textarea', 'test short compaction');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      // Agent sends output, then immediately starts compaction
      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Processing...' },
      });
      await delay(100);

      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });
      await delay(100);
      agent.sendEncrypted({ type: 'context_compaction', status: 'completed' });

      // No turn_completed sent.
      // Drain any stale query_active_conversations from before
      agent.drainMessages((m) => m.type === 'query_active_conversations');

      // After fix: compaction(completed) should trigger a fast idle check.
      // We wait up to 5s for a query_active_conversations.
      const queryMsg = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        5000,
      ).catch(() => null);

      // BUG: queryMsg is null — idle check won't fire for ~15s
      // FIX: queryMsg should arrive quickly
      expect(queryMsg).not.toBeNull();

      if (queryMsg) {
        agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
        await delay(500);
        expect(await isUIIdle(page)).toBe(true);
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  }, 12000);
});

describe('Bug 2: lost turn_completed — idle check retry', () => {
  it('TC-3: idle check fires but gets no response — should retry', async () => {
    // When idle check fires and agent doesn't respond, there should be a retry.
    // Current code: no retry, UI stays stuck forever.
    // After fix: idle check should retry after a shorter interval.
    const { agent, page } = await setupTest('Stuck3');
    try {
      await page.fill('textarea', 'test retry');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Going silent...' },
      });
      await delay(200);

      // Wait for first idle check
      const firstQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        18000,
      );
      expect(firstQuery).not.toBeNull();

      // DON'T respond — simulate lost/undelivered response

      // Drain any stale messages before waiting for retry
      agent.drainMessages((m) => m.type === 'query_active_conversations');

      // Wait for a retry query (should come within 10s if retry is implemented)
      const retryQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations',
        10000,
      ).catch(() => null);

      // BUG: retryQuery is null — no retry mechanism
      // FIX: retryQuery should arrive
      expect(retryQuery).not.toBeNull();

      // After fix: respond to retry
      if (retryQuery) {
        agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
        await delay(500);
        expect(await isUIIdle(page)).toBe(true);
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  }, 35000);

  it('TC-4: idle check fires, agent says "still active", then goes silent — should re-check', async () => {
    // Idle check fires, agent says "active" → resetIdleCheck is called.
    // But then agent goes silent (no more claude_output or turn_completed).
    // Current: another idle check fires 15s later — this DOES work eventually.
    // This test just verifies the existing behavior works as expected.
    const { agent, page } = await setupTest('Stuck4');
    try {
      await page.fill('textarea', 'test recheck');
      await page.click('.send-btn');
      const chatMsg = await agent.waitForMessage((m) => m.type === 'chat', 3000);
      const conversationId = (chatMsg.conversationId as string) || 'conv-4';

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Working...' },
      });
      await delay(200);

      // First idle check
      const firstQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations', 18000,
      );
      expect(firstQuery).not.toBeNull();

      // Agent says "still active" → handleActiveConversations calls resetIdleCheck()
      agent.sendEncrypted({
        type: 'active_conversations',
        conversations: [{
          conversationId,
          claudeSessionId: 'claude-slow',
          isProcessing: true,
          isCompacting: false,
        }],
      });

      // Second idle check should fire 15s later
      const secondQuery = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations', 18000,
      );
      expect(secondQuery).not.toBeNull();

      // Now agent says "done"
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
      await delay(500);

      expect(await isUIIdle(page)).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  }, 40000);
});

describe('Baseline: normal turn lifecycle (should always pass)', () => {
  it('TC-5: normal send → output → turn_completed → idle', async () => {
    const { agent, page } = await setupTest('Baseline1');
    try {
      await page.fill('textarea', 'hello');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Hello there!' },
      });
      await delay(200);

      agent.sendEncrypted({ type: 'turn_completed' });
      await delay(500);

      expect(await isUIIdle(page)).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-6: normal compaction + turn_completed → idle', async () => {
    const { agent, page } = await setupTest('Baseline2');
    try {
      await page.fill('textarea', 'test normal compaction');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Thinking...' },
      });
      await delay(200);

      agent.sendEncrypted({ type: 'context_compaction', status: 'started' });
      await delay(200);
      agent.sendEncrypted({ type: 'context_compaction', status: 'completed' });
      await delay(200);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Here is the answer.' },
      });
      await delay(200);

      agent.sendEncrypted({ type: 'turn_completed' });
      await delay(500);

      expect(await isUIIdle(page)).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-7: send → cancel → execution_cancelled → idle', async () => {
    const { agent, page } = await setupTest('Baseline3');
    try {
      await page.fill('textarea', 'cancel me');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Working...' },
      });
      await delay(200);

      expect(await isUIProcessing(page)).toBe(true);

      await page.click('.stop-btn');
      const cancelMsg = await agent.waitForMessage(
        (m) => m.type === 'cancel_execution', 3000,
      );
      expect(cancelMsg).not.toBeNull();

      agent.sendEncrypted({ type: 'execution_cancelled' });
      await delay(500);

      expect(await isUIIdle(page)).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-8: turn_completed lost — existing 15s idle check recovers (slow but works)', async () => {
    // Verifies the current recovery mechanism works, albeit slowly.
    const { agent, page } = await setupTest('Baseline4');
    try {
      await page.fill('textarea', 'test slow recovery');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'chat', 3000);

      agent.sendEncrypted({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Output then silence...' },
      });
      await delay(200);

      expect(await isUIProcessing(page)).toBe(true);

      // Wait for idle check (15s)
      const queryMsg = await agent.waitForMessage(
        (m) => m.type === 'query_active_conversations', 18000,
      );
      expect(queryMsg).not.toBeNull();

      // Respond: not active
      agent.sendEncrypted({ type: 'active_conversations', conversations: [] });
      await delay(500);

      expect(await isUIIdle(page)).toBe(true);
    } finally {
      await page.close();
      agent.ws.close();
    }
  }, 25000);
});
