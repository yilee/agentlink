/**
 * Functional tests for AgentLink server + web UI.
 *
 * Spawns a real server process, connects a mock agent via raw WebSocket,
 * and uses Playwright to verify the web UI. No Claude CLI needed.
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
const PORT = 19876; // High port unlikely to conflict
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

/** Wait until the server health endpoint responds */
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

/** Connect a mock agent via WebSocket. Returns { ws, sessionId, sessionKey }. */
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
  // Start server as child process
  serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });

  await waitForServer();

  // Launch headless browser
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  if (serverProc) {
    serverProc.kill();
    // On Windows, ensure child tree is killed
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        execSync(`taskkill /pid ${serverProc.pid} /f /t`, { stdio: 'ignore', windowsHide: true });
      } catch { /* already dead */ }
    }
  }
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

  it('GET /api/session/:id returns agent info', async () => {
    const { ws, sessionId } = await connectMockAgent('InfoAgent', '/info');
    const res = await fetch(`${BASE_URL}/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { agent: { name: string; workDir: string } };
    expect(body.agent.name).toBe('InfoAgent');
    expect(body.agent.workDir).toBe('/info');
    ws.close();
  });

  it('GET /api/session/invalid returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/session/nonexistent`);
    expect(res.status).toBe(404);
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
      expect(title.toLowerCase()).toContain('agentlink');
    } finally {
      await page.close();
    }
  });
});

// ── Encryption helpers for mock agent ──

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

/** Connect a mock agent with encryption support */
function connectMockAgentEncrypted(name = 'TestAgent', workDir = '/test'): Promise<{
  ws: WebSocket;
  sessionId: string;
  sessionKey: Uint8Array;
  sendEncrypted: (msg: unknown) => void;
  waitForMessage: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ type: 'agent', id: name, name, workDir, hostname: 'test-host' });
    const ws = new WebSocket(`ws://localhost:${PORT}/?${params}`);
    let sessionKey: Uint8Array;

    // Queue decrypted messages from the moment the key is available
    const messageQueue: Record<string, unknown>[] = [];
    const messageListeners: Array<(msg: Record<string, unknown>) => void> = [];

    function dispatchMessage(msg: Record<string, unknown>) {
      // Check existing listeners first
      let handled = false;
      for (let i = messageListeners.length - 1; i >= 0; i--) {
        messageListeners[i](msg);
      }
      // Always queue for future waitForMessage calls that search history
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
          // Check already-queued messages first
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
        resolve({ ws, sessionId: parsed.sessionId, sessionKey, sendEncrypted, waitForMessage });
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

describe('Functional: Delete Session', () => {
  it('delete button appears on non-active session and confirmation dialog works', async () => {
    const agent = await connectMockAgentEncrypted('DeleteAgent', '/delete-test');
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
      await page.waitForSelector('.delete-confirm-dialog', { timeout: 3000 });
      const dialogText = await page.textContent('.delete-confirm-dialog');
      expect(dialogText).toContain('Old Session To Delete');
      expect(dialogText).toContain('cannot be undone');

      // Click cancel - dialog should close
      await page.click('.delete-confirm-footer .folder-picker-cancel');
      await page.waitForSelector('.delete-confirm-dialog', { state: 'detached', timeout: 3000 });

      // Hover and click delete again, this time confirm
      await secondSession.hover();
      await deleteBtn.click();
      await page.waitForSelector('.delete-confirm-dialog', { timeout: 3000 });

      // Set up listener for the delete_session message before clicking confirm
      const deleteReqPromise = agent.waitForMessage((m) => m.type === 'delete_session');
      await page.click('.delete-confirm-btn');

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
