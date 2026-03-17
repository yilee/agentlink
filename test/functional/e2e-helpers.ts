/**
 * Shared E2E test helpers for AgentLink functional tests.
 *
 * Provides encryption, mock agent connection, server lifecycle, and
 * page setup utilities used across all E2E test files.
 */
import { spawn, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import WebSocket from 'ws';
import { chromium, type Browser, type Page } from 'playwright';
import tweetnacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tweetnaclUtil;

export const SERVER_SCRIPT = resolve('server/dist/index.js');

// ── Encryption helpers ──

export function encryptMsg(data: unknown, key: Uint8Array): { n: string; c: string } {
  const nonce = tweetnacl.randomBytes(24);
  const jsonStr = JSON.stringify(data);
  const message = decodeUTF8(jsonStr);
  const encrypted = tweetnacl.secretbox(message, nonce, key);
  return { n: encodeBase64(nonce), c: encodeBase64(encrypted) };
}

export function decryptMsg(encrypted: { n: string; c: string }, key: Uint8Array): unknown | null {
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

// ── MockAgent type ──

export type MockAgent = {
  ws: WebSocket;
  sessionId: string;
  sessionKey: Uint8Array;
  sendEncrypted: (msg: unknown) => void;
  waitForMessage: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  drainMessages: (predicate: (msg: Record<string, unknown>) => boolean) => number;
};

// ── Server lifecycle ──

export async function waitForServer(port: number, maxMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

export function startServer(port: number): ChildProcess {
  return spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID || 'test-client-id',
      ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID || 'test-tenant-id',
    },
  });
}

export async function stopServer(serverProc: ChildProcess): Promise<void> {
  if (!serverProc) return;
  serverProc.kill();
  if (process.platform === 'win32') {
    try {
      const { execSync } = await import('child_process');
      execSync(`taskkill /pid ${serverProc.pid} /f /t`, { stdio: 'ignore', windowsHide: true });
    } catch { /* already dead */ }
  }
}

// ── Mock agent connection ──

export function connectMockAgentEncrypted(
  port: number,
  name = 'TestAgent',
  workDir = '/test',
  password?: string,
  sessionId?: string,
): Promise<MockAgent> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ type: 'agent', id: name, name, workDir, hostname: 'test-host' });
    if (password) params.set('password', password);
    if (sessionId) params.set('sessionId', sessionId);
    const ws = new WebSocket(`ws://localhost:${port}/?${params}`);
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

// ── Page setup ──

export async function setupPageWithAgent(
  browser: Browser,
  port: number,
  agentName: string,
  workDir = '/test',
): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(port, agentName, workDir);
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  // Consume the initial list_sessions request
  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir });

  return { agent, page };
}

// ── Utility ──

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
