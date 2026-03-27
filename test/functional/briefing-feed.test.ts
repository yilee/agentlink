/**
 * Daily Briefing Feed functional tests
 *
 * Verifies the WebSocket protocol relay for briefing messages.
 * Tests agent→server→web relay and round-trip message integrity.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import WebSocket from 'ws';
import tweetnacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, encryptMsg, decryptMsg, delay,
} from './e2e-helpers';

const { decodeBase64 } = tweetnaclUtil;

const PORT = 19889;

let serverProc: ChildProcess;

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
}, 15000);

afterAll(async () => {
  await stopServer(serverProc);
});

/** Connect a mock web client to a session. */
function connectMockWebClient(port: number, sessionId: string): Promise<{
  ws: WebSocket;
  sessionKey: Uint8Array;
  waitForMessage: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  sendEncrypted: (msg: unknown) => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/?type=web&sessionId=${sessionId}`);
    const messageQueue: Record<string, unknown>[] = [];
    const messageListeners: Array<(msg: Record<string, unknown>) => void> = [];
    let sessionKey: Uint8Array;

    function dispatchMessage(msg: Record<string, unknown>) {
      for (const listener of messageListeners) listener(msg);
      messageQueue.push(msg);
    }

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'connected') {
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
              if (predicate(msg)) { clearTimeout(timer); res(msg); }
            });
          });
        };
        resolve({ ws, sessionKey, waitForMessage, sendEncrypted });
      } else if (parsed.n && parsed.c && sessionKey) {
        const msg = decryptMsg(parsed, sessionKey) as Record<string, unknown>;
        if (msg) dispatchMessage(msg);
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Mock web client connect timeout')), 5000);
  });
}

describe('Briefing Protocol', () => {
  it('TC-1: agent can send briefings_list without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefAgent1', '/briefing-test');
    try {
      agent.sendEncrypted({
        type: 'briefings_list',
        briefings: [
          {
            date: '2026-03-27',
            title: 'Daily Briefing — 2026-03-27 Thursday',
            tldr: 'Quick summary of today',
            action_today: 3,
            action_week: 2,
            fyi_count: 1,
            file_size: 5000,
          },
        ],
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-2: agent can send briefing_detail without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefAgent2', '/briefing-test');
    try {
      agent.sendEncrypted({
        type: 'briefing_detail',
        date: '2026-03-27',
        content: '# Daily Briefing — 2026-03-27\n\n## TL;DR\nSummary here.\n',
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-3: agent can send empty briefings and null content without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefAgent3', '/briefing-test');
    try {
      agent.sendEncrypted({ type: 'briefings_list', briefings: [] });
      await delay(100);
      agent.sendEncrypted({ type: 'briefing_detail', date: '2026-03-27', content: null });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });
});

describe('Briefing Relay (agent → server → web)', () => {
  it('TC-4: web client receives briefings_list relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefRelay1', '/briefing-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'briefings_list',
        briefings: [
          {
            date: '2026-03-27',
            title: 'Daily Briefing — Thursday',
            tldr: 'Test relay',
            action_today: 1,
            action_week: 0,
            fyi_count: 0,
            file_size: 3000,
          },
        ],
      });

      const received = await webClient.waitForMessage((m) => m.type === 'briefings_list');
      expect(received.type).toBe('briefings_list');
      const briefings = received.briefings as Array<Record<string, unknown>>;
      expect(briefings).toHaveLength(1);
      expect(briefings[0].date).toBe('2026-03-27');
      expect(briefings[0].title).toBe('Daily Briefing — Thursday');
      expect(briefings[0].action_today).toBe(1);
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-5: web client receives briefing_detail relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefRelay2', '/briefing-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'briefing_detail',
        date: '2026-03-27',
        content: '# Full briefing content here',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'briefing_detail');
      expect(received.date).toBe('2026-03-27');
      expect(received.content).toBe('# Full briefing content here');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-6: web client list_briefings request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefRelay3', '/briefing-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({ type: 'list_briefings' });

      const received = await agent.waitForMessage((m) => m.type === 'list_briefings');
      expect(received.type).toBe('list_briefings');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-7: web client get_briefing_detail request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefRelay4', '/briefing-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({ type: 'get_briefing_detail', date: '2026-03-27' });

      const received = await agent.waitForMessage((m) => m.type === 'get_briefing_detail');
      expect(received.date).toBe('2026-03-27');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-8: multiple briefing messages relay in order', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'BriefRelay5', '/briefing-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'briefings_list',
        briefings: [{ date: '2026-03-27', title: 'Order Test' }],
      });
      agent.sendEncrypted({
        type: 'briefing_detail',
        date: '2026-03-27',
        content: '# Order Test Detail',
      });

      const list = await webClient.waitForMessage((m) => m.type === 'briefings_list');
      const detail = await webClient.waitForMessage((m) => m.type === 'briefing_detail');
      expect((list.briefings as Array<Record<string, unknown>>)[0].date).toBe('2026-03-27');
      expect(detail.content).toBe('# Order Test Detail');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });
});
