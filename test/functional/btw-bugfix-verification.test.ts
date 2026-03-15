/**
 * Targeted verification tests for two /btw bug fixes:
 *
 * TC-48 (Fixed): Empty /btw question does nothing
 *   - "/btw " (with trailing space only) should NOT send a message or open overlay
 *   - "/btw" (no trailing space) should NOT send a message or open overlay
 *   - "/btw    " (multiple spaces) should NOT send a message or open overlay
 *
 * TC-55 (Fixed): Escape key priority - slash menu closes before btw overlay
 *   - When both slash menu and btw overlay are visible, first Escape closes slash menu
 *   - Second Escape closes btw overlay
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19879; // Unique port for this test file
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

// ── Test-specific helpers ──

async function setupTest(agentName: string, workDir = '/btw-bugfix-test'): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, workDir);
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir });

  return { agent, page };
}

function sendBtwFullAnswer(agent: MockAgent, text: string) {
  agent.sendEncrypted({ type: 'btw_answer', delta: text, done: false });
  agent.sendEncrypted({ type: 'btw_answer', delta: '', done: true });
}

// ── Lifecycle ──

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  await stopServer(serverProc);
});

// ── TC-48: Empty /btw question does nothing ──

describe('TC-48 (Fixed): Empty /btw question does nothing', () => {
  it('"/btw " (space only after /btw) should not open overlay or send message', async () => {
    const { agent, page } = await setupTest('TC48Fix1');
    try {
      // Type "/btw " (slash-btw with trailing space, empty question)
      await page.click('textarea');
      await page.fill('textarea', '/btw ');
      await page.click('.send-btn');

      // Wait a bit to see if anything happens
      await delay(500);

      // No btw overlay should appear
      const overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(0);

      // No btw_question message should have been sent to the agent
      const btwMsg = await agent.waitForMessage(
        (m) => m.type === 'btw_question',
        800
      ).catch(() => null);
      expect(btwMsg).toBeNull();

      // No chat message should have been sent either (it should not fall through)
      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat',
        800
      ).catch(() => null);
      expect(chatMsg).toBeNull();

      // No user message bubble should appear in the chat
      const userBubbles = await page.locator('.msg.user').count();
      expect(userBubbles).toBe(0);

      // Input is NOT cleared (the early return at line 465 happens before the
      // inputText = '' assignment at line 468). This is intentional -- the user
      // can still edit their /btw input and add a question.
      // The key verification is that no overlay opened and no message was sent.
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('"/btw" (no trailing space, no question) should not open overlay or send message', async () => {
    const { agent, page } = await setupTest('TC48Fix2');
    try {
      await page.click('textarea');
      await page.fill('textarea', '/btw');
      await page.click('.send-btn');

      await delay(500);

      // No btw overlay
      const overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(0);

      // No btw_question sent
      const btwMsg = await agent.waitForMessage(
        (m) => m.type === 'btw_question',
        800
      ).catch(() => null);
      expect(btwMsg).toBeNull();

      // No chat message sent (should not fall through to regular chat)
      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat',
        800
      ).catch(() => null);
      expect(chatMsg).toBeNull();

      // No user message bubble
      const userBubbles = await page.locator('.msg.user').count();
      expect(userBubbles).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('"/btw    " (multiple trailing spaces, no question text) should not open overlay or send message', async () => {
    const { agent, page } = await setupTest('TC48Fix3');
    try {
      await page.click('textarea');
      await page.fill('textarea', '/btw    ');
      await page.click('.send-btn');

      await delay(500);

      // No btw overlay
      const overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(0);

      // No messages sent
      const btwMsg = await agent.waitForMessage(
        (m) => m.type === 'btw_question',
        800
      ).catch(() => null);
      expect(btwMsg).toBeNull();

      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat',
        800
      ).catch(() => null);
      expect(chatMsg).toBeNull();

      // No user bubble
      const userBubbles = await page.locator('.msg.user').count();
      expect(userBubbles).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('"/btw real question" still works correctly (sanity check)', async () => {
    const { agent, page } = await setupTest('TC48Fix4');
    try {
      await page.click('textarea');
      await page.fill('textarea', '/btw what is 3+3?');
      await page.click('.send-btn');

      // Agent should receive btw_question
      const btwMsg = await agent.waitForMessage(
        (m) => m.type === 'btw_question' && m.question === 'what is 3+3?',
        3000
      );
      expect(btwMsg).not.toBeNull();
      expect(btwMsg.question).toBe('what is 3+3?');

      // Overlay should appear
      await page.waitForSelector('.btw-overlay', { timeout: 3000 });
      const overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(1);

      // Question text should be displayed
      const questionText = await page.textContent('.btw-question');
      expect(questionText).toContain('what is 3+3?');

      // Send answer and verify it appears
      sendBtwFullAnswer(agent, 'The answer is 6.');
      await page.waitForSelector('.btw-answer', { timeout: 3000 });
      const answerText = await page.textContent('.btw-answer');
      expect(answerText).toContain('6');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});

// ── TC-55: Escape key priority ──

describe('TC-55 (Fixed): Escape key priority -- slash menu closes before btw overlay', () => {
  it('First Escape closes slash menu, second Escape closes btw overlay', async () => {
    const { agent, page } = await setupTest('TC55Fix1');
    try {
      // Step 1: Send a /btw question and get an answer (leaving overlay open)
      await page.fill('textarea', '/btw what is 2+2?');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'btw_question');
      await page.waitForSelector('.btw-overlay', { timeout: 3000 });

      sendBtwFullAnswer(agent, 'The answer is 4.');
      await page.waitForSelector('.btw-answer', { timeout: 3000 });

      // Verify overlay is visible
      let overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(1);

      // Step 2: Type /c to open the slash command menu
      // The overlay covers the textarea, so use page.evaluate to set value
      await page.evaluate(() => {
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        if (!ta) throw new Error('No textarea found');
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )!.set!;
        nativeInputValueSetter.call(ta, '/c');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
      });
      await page.waitForSelector('.slash-menu', { timeout: 3000 });

      // Step 3: BOTH should be visible
      let slashMenuCount = await page.locator('.slash-menu').count();
      overlayCount = await page.locator('.btw-overlay').count();
      expect(slashMenuCount).toBe(1);
      expect(overlayCount).toBe(1);

      // Step 4: Press Escape once -- should close slash menu ONLY
      await page.locator('textarea').focus();
      await page.keyboard.press('Escape');
      await delay(200);

      slashMenuCount = await page.locator('.slash-menu').count();
      overlayCount = await page.locator('.btw-overlay').count();

      // FIXED BEHAVIOR: slash menu closed, btw overlay still open
      expect(slashMenuCount).toBe(0);
      expect(overlayCount).toBe(1);

      // Step 5: Press Escape again -- should close btw overlay
      // Ensure textarea has focus (first Escape may have shifted it)
      await page.evaluate(() => {
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        if (ta) ta.focus();
      });
      await delay(100);
      await page.keyboard.press('Escape');
      await delay(300);

      slashMenuCount = await page.locator('.slash-menu').count();
      overlayCount = await page.locator('.btw-overlay').count();

      // Both should now be gone
      expect(slashMenuCount).toBe(0);
      expect(overlayCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('Escape with only btw overlay (no slash menu) still closes btw overlay', async () => {
    const { agent, page } = await setupTest('TC55Fix2');
    try {
      // Send btw question and get answer
      await page.fill('textarea', '/btw what is 5+5?');
      await page.click('.send-btn');
      await agent.waitForMessage((m) => m.type === 'btw_question');
      await page.waitForSelector('.btw-overlay', { timeout: 3000 });

      sendBtwFullAnswer(agent, 'The answer is 10.');
      await page.waitForSelector('.btw-answer', { timeout: 3000 });

      // Verify overlay is visible, no slash menu
      let overlayCount = await page.locator('.btw-overlay').count();
      const slashMenuCount = await page.locator('.slash-menu').count();
      expect(overlayCount).toBe(1);
      expect(slashMenuCount).toBe(0);

      // Press Escape -- should close btw overlay directly
      await page.locator('textarea').focus();
      await page.keyboard.press('Escape');
      await delay(200);

      overlayCount = await page.locator('.btw-overlay').count();
      expect(overlayCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('Escape with only slash menu (no btw overlay) still closes slash menu', async () => {
    const { agent, page } = await setupTest('TC55Fix3');
    try {
      // Type /c to open slash menu (no btw overlay active)
      await page.click('textarea');
      await page.fill('textarea', '/c');
      await page.waitForSelector('.slash-menu', { timeout: 3000 });

      let slashMenuCount = await page.locator('.slash-menu').count();
      const overlayCount = await page.locator('.btw-overlay').count();
      expect(slashMenuCount).toBe(1);
      expect(overlayCount).toBe(0);

      // Press Escape -- should close slash menu
      await page.keyboard.press('Escape');
      await delay(200);

      slashMenuCount = await page.locator('.slash-menu').count();
      expect(slashMenuCount).toBe(0);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
