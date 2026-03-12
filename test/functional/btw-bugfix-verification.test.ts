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
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import WebSocket from 'ws';
import { chromium, type Browser, type Page } from 'playwright';
import tweetnacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tweetnaclUtil;

const SERVER_SCRIPT = resolve('server/dist/index.js');
const PORT = 19879; // Unique port for this test file
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

// ── Helpers ──

async function waitForServer(maxMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

function encryptMsg(data: unknown, key: Uint8Array): { n: string; c: string } {
  const nonce = tweetnacl.randomBytes(24);
  const jsonStr = JSON.stringify(data);
  const message = decodeUTF8(jsonStr);
  const encrypted = tweetnacl.secretbox(message, nonce, key);
  return { n: encodeBase64(nonce), c: encodeBase64(encrypted) };
}

function decryptMsg(encrypted: { n: string; c: string }, key: Uint8Array): unknown | null {
  try {
    const nonce = decodeBase64(encrypted.n);
    const ciphertext = decodeBase64(encrypted.c);
    const decrypted = tweetnacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) return null;
    return JSON.parse(encodeUTF8(decrypted));
  } catch {
    return null;
  }
}

type MockAgent = {
  ws: WebSocket;
  sessionId: string;
  sessionKey: Uint8Array;
  sendEncrypted: (msg: unknown) => void;
  waitForMessage: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  /** Drain any queued messages matching predicate, returns count drained */
  drainMessages: (predicate: (msg: Record<string, unknown>) => boolean) => number;
};

function connectMockAgentEncrypted(name: string, workDir = '/test'): Promise<MockAgent> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ type: 'agent', id: name, name, workDir, hostname: 'test-host' });
    const ws = new WebSocket(`ws://localhost:${PORT}/?${params}`);
    let sessionKey: Uint8Array;

    const messageQueue: Record<string, unknown>[] = [];
    const messageListeners: Array<(msg: Record<string, unknown>) => void> = [];

    function dispatchMessage(msg: Record<string, unknown>) {
      for (let i = messageListeners.length - 1; i >= 0; i--) {
        messageListeners[i](msg);
      }
      messageQueue.push(msg);
    }

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'registered') {
        sessionKey = decodeBase64(parsed.sessionKey);
        const sendEncrypted = (msg: unknown) => {
          ws.send(JSON.stringify(encryptMsg(msg, sessionKey)));
        };
        const waitForMessage = (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 5000) => {
          for (const queued of messageQueue) {
            if (predicate(queued)) return Promise.resolve(queued);
          }
          return new Promise<Record<string, unknown>>((res, rej) => {
            const timer = setTimeout(() => rej(new Error('waitForMessage timeout')), timeoutMs);
            messageListeners.push((msg) => {
              if (predicate(msg)) {
                clearTimeout(timer);
                res(msg);
              }
            });
          });
        };
        const drainMessages = (predicate: (msg: Record<string, unknown>) => boolean): number => {
          let count = 0;
          for (let i = messageQueue.length - 1; i >= 0; i--) {
            if (predicate(messageQueue[i])) {
              messageQueue.splice(i, 1);
              count++;
            }
          }
          return count;
        };
        resolve({ ws, sessionId: parsed.sessionId, sessionKey, sendEncrypted, waitForMessage, drainMessages });
      } else if (parsed.n && parsed.c && sessionKey) {
        const msg = decryptMsg(parsed, sessionKey) as Record<string, unknown>;
        if (msg) {
          dispatchMessage(msg);
        }
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Mock agent connect timeout')), 5000);
  });
}

/** Setup page, connect agent, consume initial list_sessions */
async function setupTest(agentName: string, workDir = '/btw-bugfix-test'): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(agentName, workDir);
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  // Consume the initial list_sessions request
  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir });

  return { agent, page };
}

/** Simulate a complete btw answer (sends text then done) */
function sendBtwFullAnswer(agent: MockAgent, text: string) {
  agent.sendEncrypted({ type: 'btw_answer', delta: text, done: false });
  agent.sendEncrypted({ type: 'btw_answer', delta: '', done: true });
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Lifecycle ──

beforeAll(async () => {
  serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });

  await waitForServer();
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  if (serverProc) {
    serverProc.kill();
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        execSync(`taskkill /pid ${serverProc.pid} /f /t`, { stdio: 'ignore', windowsHide: true });
      } catch { /* already dead */ }
    }
  }
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
