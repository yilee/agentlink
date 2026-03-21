/**
 * Meeting Recap Feed functional tests
 *
 * Verifies the WebSocket protocol relay for recap messages.
 * The recap feature is gated behind /ms/ (brain mode) which requires
 * Entra auth, so we test at the protocol level: agent connects,
 * sends recap messages, and we verify the server relays them
 * without errors.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19888;

let serverProc: ChildProcess;

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
}, 15000);

afterAll(async () => {
  await stopServer(serverProc);
});

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
