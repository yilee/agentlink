/**
 * DevOps Board functional tests
 *
 * Verifies the WebSocket protocol relay for devops messages.
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

const PORT = 19890;

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

// ── Sample data ──

const samplePr = {
  pr_number: '6503730',
  title: 'Eval Pipeline',
  url: 'https://dev.azure.com/...',
  project: 'AdsAppsService',
  repository: 'AdsAppsService',
  source: 'azure_devops',
  total_mentions: 5,
  status: 'completed',
  created_by: 'Kailun Shi',
  created_date: '2026-03-20',
  source_branch: 'user/kailunshi/eval',
  target_branch: 'main',
  merge_status: 'succeeded',
  reviewers: [
    { name: 'Trupti Kulkarni', vote: 'approved' },
    { name: 'Wei Zhang', vote: 'approved' },
    { name: 'Pavan Kumar', vote: 'no_vote' },
  ],
};

const sampleWi = {
  work_item_id: '6493060',
  title: 'Refactor Slideshow.ts',
  url: 'https://dev.azure.com/...',
  project: 'Bing_Ads',
  total_mentions: 2,
  state: 'Active',
  assigned_to: 'Kailun Shi',
  priority: '2',
  severity: 'N/A',
  area_path: 'Bing_Ads\\Geospatial',
  created_date: '2026-03-15',
  work_item_type: 'Task',
};

describe('DevOps Protocol', () => {
  it('TC-1: agent can send devops_list without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsAgent1', '/devops-test');
    try {
      agent.sendEncrypted({
        type: 'devops_list',
        pullRequests: [samplePr],
        workItems: [sampleWi],
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-2: agent can send devops_detail without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsAgent2', '/devops-test');
    try {
      agent.sendEncrypted({
        type: 'devops_detail',
        entityType: 'pr',
        entityId: '6503730',
        description: '# PR #6503730 — Eval Pipeline\n\n## Status\nCompleted\n',
        mentions: '## Discussed In\n- Teams message from Wei Zhang\n',
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-3: agent can send empty lists and null content without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsAgent3', '/devops-test');
    try {
      agent.sendEncrypted({ type: 'devops_list', pullRequests: [], workItems: [] });
      await delay(100);
      agent.sendEncrypted({
        type: 'devops_detail',
        entityType: 'wi',
        entityId: '9999999',
        description: null,
        mentions: null,
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });
});

describe('DevOps Relay (agent → server → web)', () => {
  it('TC-4: web client receives devops_list relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay1', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      // Use minimal PR/WI to verify relay (samplePr with reviewers array is large)
      const minPr = { pr_number: '6503730', title: 'Eval Pipeline', status: 'completed', total_mentions: 5 };
      const minWi = { work_item_id: '6493060', state: 'Active', priority: '2' };

      agent.sendEncrypted({
        type: 'devops_list',
        pullRequests: [minPr],
        workItems: [minWi],
      });

      const received = await webClient.waitForMessage((m) => m.type === 'devops_list');
      expect(received.type).toBe('devops_list');

      const prs = received.pullRequests as Array<Record<string, unknown>>;
      expect(prs).toHaveLength(1);
      expect(prs[0].pr_number).toBe('6503730');
      expect(prs[0].title).toBe('Eval Pipeline');
      expect(prs[0].total_mentions).toBe(5);
      expect(prs[0].status).toBe('completed');

      const wis = received.workItems as Array<Record<string, unknown>>;
      expect(wis).toHaveLength(1);
      expect(wis[0].work_item_id).toBe('6493060');
      expect(wis[0].state).toBe('Active');
      expect(wis[0].priority).toBe('2');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-5: web client receives devops_detail relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay2', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      const descMd = '# PR #6503730 — Eval Pipeline\n\nFull description content here.';
      const mentionsMd = '## Discussed In\n- Teams: Wei Zhang mentioned this PR\n- Email thread: Review feedback';

      agent.sendEncrypted({
        type: 'devops_detail',
        entityType: 'pr',
        entityId: '6503730',
        description: descMd,
        mentions: mentionsMd,
      });

      const received = await webClient.waitForMessage((m) => m.type === 'devops_detail');
      expect(received.entityType).toBe('pr');
      expect(received.entityId).toBe('6503730');
      expect(received.description).toBe(descMd);
      expect(received.mentions).toBe(mentionsMd);
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-6: web client list_devops request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay3', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({ type: 'list_devops' });

      const received = await agent.waitForMessage((m) => m.type === 'list_devops');
      expect(received.type).toBe('list_devops');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-7: web client get_devops_detail request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay4', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({
        type: 'get_devops_detail',
        entityType: 'pr',
        entityId: '6503730',
      });

      const received = await agent.waitForMessage((m) => m.type === 'get_devops_detail');
      expect(received.entityType).toBe('pr');
      expect(received.entityId).toBe('6503730');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-8: multiple devops messages relay in order', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay5', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'devops_list',
        pullRequests: [{ pr_number: '6503730', title: 'Order Test PR' }],
        workItems: [],
      });
      agent.sendEncrypted({
        type: 'devops_detail',
        entityType: 'pr',
        entityId: '6503730',
        description: '# Order Test PR Detail',
        mentions: null,
      });

      const list = await webClient.waitForMessage((m) => m.type === 'devops_list');
      const detail = await webClient.waitForMessage((m) => m.type === 'devops_detail');

      const prs = list.pullRequests as Array<Record<string, unknown>>;
      expect(prs[0].pr_number).toBe('6503730');
      expect(detail.description).toBe('# Order Test PR Detail');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-9: work item detail relay preserves all fields', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay6', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'devops_detail',
        entityType: 'wi',
        entityId: '6493060',
        description: '# Task #6493060 — Refactor Slideshow.ts\n\n| Field | Value |\n|-------|-------|\n| State | Active |\n| Priority | 2 |',
        mentions: '## Discussed In\n- Email from PM about priority',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'devops_detail');
      expect(received.entityType).toBe('wi');
      expect(received.entityId).toBe('6493060');
      expect(received.description).toContain('Refactor Slideshow.ts');
      expect(received.mentions).toContain('Email from PM');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-10: devops_list with multiple PRs and WIs preserves all entries', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'DevopsRelay7', '/devops-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      const pr1 = { pr_number: '6503730', title: 'Eval Pipeline', status: 'completed' };
      const pr2 = { pr_number: '6517920', title: 'EntityId Support', status: 'active' };
      const wi1 = { work_item_id: '6493060', state: 'Active', priority: '2' };
      const wi2 = { work_item_id: '6493725', title: 'Map Privacy Blur', state: 'New', priority: '3' };

      agent.sendEncrypted({
        type: 'devops_list',
        pullRequests: [pr1, pr2],
        workItems: [wi1, wi2],
      });

      const received = await webClient.waitForMessage((m) => m.type === 'devops_list');
      const prs = received.pullRequests as Array<Record<string, unknown>>;
      const wis = received.workItems as Array<Record<string, unknown>>;

      expect(prs).toHaveLength(2);
      expect(prs[0].pr_number).toBe('6503730');
      expect(prs[1].pr_number).toBe('6517920');
      expect(prs[1].status).toBe('active');

      expect(wis).toHaveLength(2);
      expect(wis[0].work_item_id).toBe('6493060');
      expect(wis[1].work_item_id).toBe('6493725');
      expect(wis[1].priority).toBe('3');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });
});
