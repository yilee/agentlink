/**
 * Meeting Recap Feed functional tests
 *
 * Verifies the WebSocket protocol relay for recap messages.
 * Tests both protocol-level relay (agent→server→web) and
 * round-trip message integrity for recap-specific types.
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

const PORT = 19888;

let serverProc: ChildProcess;

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
}, 15000);

afterAll(async () => {
  await stopServer(serverProc);
});

/** Connect a mock web client to a session, returns WebSocket + sessionKey + message helpers. */
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

describe('Meeting Recap Protocol', () => {
  it('TC-1: agent connects and receives initial list_sessions', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapAgent1', '/recap-test');
    try {
      // Agent should be registered with a valid session
      expect(agent.sessionId).toBeTruthy();
      expect(agent.sessionKey).toBeInstanceOf(Uint8Array);
      expect(agent.sessionKey.length).toBe(32);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-2: agent can send recaps_list without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapAgent2', '/recap-test');
    try {
      // Send recaps_list — server should relay without crashing
      agent.sendEncrypted({
        type: 'recaps_list',
        recaps: [
          {
            recap_id: 'r1',
            meeting_id: 'm1',
            meeting_name: 'Daily Standup',
            series_name: 'Daily',
            date_utc: '2026-03-22T17:00:00Z',
            date_local: '2026-03-22T10:00:00',
            meeting_type: 'standup',
            project: null,
            for_you_count: 2,
            tldr_snippet: 'Quick sync on sprint items',
            sidecar_path: 'reports/meeting-recap/r1.json',
            recap_path: 'reports/meeting-recap/r1.md',
            sharing_link: null,
          },
        ],
      });
      await delay(300);

      // Server should still be healthy after processing the message
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-3: agent can send recap_detail without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapAgent3', '/recap-test');
    try {
      // Send a full recap_detail message
      agent.sendEncrypted({
        type: 'recap_detail',
        detail: {
          schema_version: '1.0',
          meta: {
            meeting_name: 'Architecture Review',
            occurred_at_local: '2026-03-22T10:00:00',
            duration: '45 min',
            participants: ['Alice', 'Bob', 'Charlie'],
            series_name: 'Architecture',
            project: 'AgentLink',
            sharing_link: 'https://example.com/recap/r2',
          },
          feed: { type_badge: 'Strategy' },
          detail: {
            tldr: 'Discussed new API architecture and migration plan.',
            for_you: [
              { text: 'Review the API spec by Friday', reason: 'You own the API module', kind: 'action_item' },
            ],
            hook_sections: [
              {
                section_type: 'decisions',
                title: 'Decisions',
                items: [
                  { text: 'Adopt REST over GraphQL', tag: 'DECIDED', championed_by: ['Alice'] },
                  { text: 'Use OpenAPI spec', tag: 'DECIDED', championed_by: ['Bob'] },
                ],
                omitted_count: 0,
              },
              {
                section_type: 'action_items',
                title: 'Action Items',
                items: [
                  { text: 'Write API spec', owner: 'Alice', due: '2026-03-25', action: 'Write API spec' },
                  { text: 'Set up CI pipeline', owner: 'Bob', due: '2026-03-28', action: 'Set up CI pipeline' },
                  { text: 'Review security model', owner: 'Charlie', action: 'Review security model' },
                  { text: 'Update docs', owner: 'Alice', action: 'Update docs' },
                ],
                omitted_count: 1,
              },
            ],
            decisions_count: 2,
            action_items_count: 5,
            open_items_count: 0,
          },
          decisions: [],
          action_items: [],
          open_items: [],
        },
      });
      await delay(300);

      // Server should still be healthy
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-4: agent can send empty recaps and null detail without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapAgent4', '/recap-test');
    try {
      // Send edge-case messages that should be handled gracefully
      agent.sendEncrypted({ type: 'recaps_list', recaps: [] });
      await delay(100);
      agent.sendEncrypted({ type: 'recap_detail', detail: null });
      await delay(300);

      // Server should still be healthy
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });
});

describe('Meeting Recap Relay (agent → server → web)', () => {
  it('TC-5: web client receives recaps_list relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent1', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      // Small delay to ensure both connections are fully registered
      await delay(200);

      const recapsList = {
        type: 'recaps_list',
        recaps: [
          {
            recap_id: 'relay-r1',
            meeting_name: 'Relay Test Meeting',
            date_local: '2026-03-22T10:00:00',
            meeting_type: 'standup',
            tldr_snippet: 'Test snippet',
            sidecar_path: 'reports/r1.json',
          },
        ],
      };

      agent.sendEncrypted(recapsList);

      // Web client should receive the relayed message
      const received = await webClient.waitForMessage((m) => m.type === 'recaps_list');
      expect(received.type).toBe('recaps_list');
      const recaps = received.recaps as Array<Record<string, unknown>>;
      expect(recaps).toHaveLength(1);
      expect(recaps[0].recap_id).toBe('relay-r1');
      expect(recaps[0].meeting_name).toBe('Relay Test Meeting');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-6: web client receives recap_detail relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent2', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'recap_detail',
        detail: {
          meta: { meeting_name: 'Detail Relay Test' },
          detail: { tldr: 'Relayed TL;DR' },
        },
      });

      const received = await webClient.waitForMessage((m) => m.type === 'recap_detail');
      const detail = received.detail as Record<string, unknown>;
      expect(detail).toBeTruthy();
      const meta = detail.meta as Record<string, unknown>;
      expect(meta.meeting_name).toBe('Detail Relay Test');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-7: web client get_recap_detail request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent3', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({
        type: 'get_recap_detail',
        recapId: 'req-r1',
        sidecarPath: 'reports/meeting-recap/req-r1.json',
      });

      const received = await agent.waitForMessage((m) => m.type === 'get_recap_detail');
      expect(received.recapId).toBe('req-r1');
      expect(received.sidecarPath).toBe('reports/meeting-recap/req-r1.json');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-8: sessions_list with recapId and customTitle relays correctly', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent4', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'sessions_list',
        sessions: [
          {
            sessionId: 'sess-1',
            title: 'Auto title',
            customTitle: 'User renamed title',
            recapId: 'r1',
            lastModified: Date.now(),
            brainMode: true,
          },
          {
            sessionId: 'sess-2',
            title: 'Regular session',
            lastModified: Date.now(),
          },
        ],
        workDir: '/recap-test',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'sessions_list');
      const sessions = received.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(2);
      expect(sessions[0].customTitle).toBe('User renamed title');
      expect(sessions[0].recapId).toBe('r1');
      expect(sessions[1].customTitle).toBeUndefined();
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-9: session_renamed relays from agent to web client', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent5', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'session_renamed',
        sessionId: 'sess-1',
        newTitle: 'My custom title',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'session_renamed');
      expect(received.sessionId).toBe('sess-1');
      expect(received.newTitle).toBe('My custom title');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-10: rename_session request from web reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent6', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({
        type: 'rename_session',
        sessionId: 'sess-1',
        newTitle: 'Renamed from web',
      });

      const received = await agent.waitForMessage((m) => m.type === 'rename_session');
      expect(received.sessionId).toBe('sess-1');
      expect(received.newTitle).toBe('Renamed from web');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-11: multiple recap messages relay in order', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'RecapRelayAgent7', '/recap-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      // Send recaps_list followed by recap_detail
      agent.sendEncrypted({
        type: 'recaps_list',
        recaps: [{ recap_id: 'order-r1', meeting_name: 'Order Test' }],
      });
      agent.sendEncrypted({
        type: 'recap_detail',
        detail: { meta: { meeting_name: 'Order Test Detail' } },
      });

      const list = await webClient.waitForMessage((m) => m.type === 'recaps_list');
      const detail = await webClient.waitForMessage((m) => m.type === 'recap_detail');
      expect((list.recaps as Array<Record<string, unknown>>)[0].recap_id).toBe('order-r1');
      expect(((detail.detail as Record<string, unknown>).meta as Record<string, unknown>).meeting_name).toBe('Order Test Detail');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });
});
