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
