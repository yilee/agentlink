/**
 * Project Knowledge Base functional tests
 *
 * Verifies the WebSocket protocol relay for project messages.
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

const PORT = 19891;

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

const sampleProject1 = {
  name: 'ads-relevance',
  title: 'Ads Relevance',
  description: 'ML pipeline for ad relevance scoring',
  workstreamCount: 3,
  blockerCount: 1,
  pendingDecisionCount: 2,
  staleItemCount: 0,
  lastModified: '2026-03-28T10:00:00Z',
};

const sampleProject2 = {
  name: 'search-ranking',
  title: 'Search Ranking',
  description: 'Core search ranking algorithm improvements',
  workstreamCount: 5,
  blockerCount: 0,
  pendingDecisionCount: 1,
  staleItemCount: 3,
  lastModified: '2026-03-27T15:30:00Z',
};

const sampleDetail = {
  name: 'ads-relevance',
  overview: '# Ads Relevance\n\nML pipeline for ad relevance scoring.\n\n## Goals\n- Improve CTR prediction\n- Reduce latency',
  team: '## Team\n- Kailun Shi (Lead)\n- Wei Zhang (ML)\n- Trupti Kulkarni (Infra)',
  timeline: '## Timeline\n\n| Phase | Date | Status |\n|-------|------|--------|\n| Design | Mar 15 | Done |\n| Impl | Mar 25 | In Progress |',
  decisions: '## Decisions\n\n## 1. Use TensorFlow for model serving\n## 2. Adopt A/B testing framework',
  codePaths: '## Code Paths\n- `src/ml/relevance/`\n- `src/serving/model_server.py`',
  missingInfo: '## Missing Info\n- Production traffic patterns\n- Baseline metrics',
  gapAnalysis: '',
  schema: '',
  workstreams: [
    { name: 'model-training', filename: 'model-training.md', content: '# Model Training\n\nTraining pipeline for relevance models.' },
    { name: 'serving-infra', filename: 'serving-infra.md', content: '# Serving Infra\n\nModel serving infrastructure.' },
  ],
  blockers: '## Blockers\n\n## 1. GPU quota not approved',
  pendingDecisions: '## Pending Decisions\n\n## 1. Model architecture (BERT vs T5)\n## 2. Deployment region',
  staleItems: '',
};

describe('Project Protocol', () => {
  it('TC-1: agent can send projects_list without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectAgent1', '/project-test');
    try {
      agent.sendEncrypted({
        type: 'projects_list',
        projects: [sampleProject1, sampleProject2],
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-2: agent can send project_detail without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectAgent2', '/project-test');
    try {
      agent.sendEncrypted({
        type: 'project_detail',
        ...sampleDetail,
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-3: agent can send empty project list without server errors', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectAgent3', '/project-test');
    try {
      agent.sendEncrypted({ type: 'projects_list', projects: [] });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });

  it('TC-4: agent can send project_detail with empty sections', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectAgent4', '/project-test');
    try {
      agent.sendEncrypted({
        type: 'project_detail',
        name: 'empty-project',
        overview: '',
        team: '',
        timeline: '',
        decisions: '',
        codePaths: '',
        missingInfo: '',
        gapAnalysis: '',
        schema: '',
        workstreams: [],
        blockers: '',
        pendingDecisions: '',
        staleItems: '',
      });
      await delay(300);

      const res = await fetch(`http://localhost:${PORT}/api/health`);
      expect(res.ok).toBe(true);
    } finally {
      agent.ws.close();
    }
  });
});

describe('Project Relay (agent → server → web)', () => {
  it('TC-5: web client receives projects_list relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay1', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'projects_list',
        projects: [sampleProject1],
      });

      const received = await webClient.waitForMessage((m) => m.type === 'projects_list');
      expect(received.type).toBe('projects_list');

      const projects = received.projects as Array<Record<string, unknown>>;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('ads-relevance');
      expect(projects[0].title).toBe('Ads Relevance');
      expect(projects[0].description).toBe('ML pipeline for ad relevance scoring');
      expect(projects[0].workstreamCount).toBe(3);
      expect(projects[0].blockerCount).toBe(1);
      expect(projects[0].pendingDecisionCount).toBe(2);
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-6: web client receives project_detail relayed from agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay2', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      // Use a minimal detail payload to keep within relay size limits
      const minDetail = {
        type: 'project_detail',
        name: 'ads-relevance',
        overview: '# Ads Relevance\n\nML pipeline.',
        team: '## Team\n- Kailun Shi',
        timeline: '',
        decisions: '## Decisions\n- Use TensorFlow',
        codePaths: '',
        missingInfo: '',
        gapAnalysis: '',
        schema: '',
        workstreams: [{ name: 'model-training', filename: 'model-training.md', content: '# MT' }],
        blockers: '## Blockers\n- GPU quota',
        pendingDecisions: '## Pending\n- BERT vs T5',
        staleItems: '',
      };

      agent.sendEncrypted(minDetail);

      const received = await webClient.waitForMessage((m) => m.type === 'project_detail');
      expect(received.name).toBe('ads-relevance');
      expect(received.overview).toContain('ML pipeline');
      expect(received.team).toContain('Kailun Shi');
      expect(received.decisions).toContain('TensorFlow');

      const workstreams = received.workstreams as Array<Record<string, unknown>>;
      expect(workstreams).toHaveLength(1);
      expect(workstreams[0].name).toBe('model-training');

      expect(received.blockers).toContain('GPU quota');
      expect(received.pendingDecisions).toContain('BERT vs T5');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-7: web client list_projects request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay3', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({ type: 'list_projects' });

      const received = await agent.waitForMessage((m) => m.type === 'list_projects');
      expect(received.type).toBe('list_projects');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-8: web client get_project_detail request reaches agent', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay4', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      webClient.sendEncrypted({
        type: 'get_project_detail',
        projectName: 'ads-relevance',
      });

      const received = await agent.waitForMessage((m) => m.type === 'get_project_detail');
      expect(received.projectName).toBe('ads-relevance');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-9: multiple project messages relay in order', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay5', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'projects_list',
        projects: [sampleProject1, sampleProject2],
      });
      agent.sendEncrypted({
        type: 'project_detail',
        name: 'ads-relevance',
        overview: '# Ads Relevance Detail',
        team: '',
        timeline: '',
        decisions: '',
        codePaths: '',
        missingInfo: '',
        gapAnalysis: '',
        schema: '',
        workstreams: [],
        blockers: '',
        pendingDecisions: '',
        staleItems: '',
      });

      const list = await webClient.waitForMessage((m) => m.type === 'projects_list');
      const detail = await webClient.waitForMessage((m) => m.type === 'project_detail');

      const projects = list.projects as Array<Record<string, unknown>>;
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('ads-relevance');
      expect(projects[1].name).toBe('search-ranking');
      expect(detail.overview).toBe('# Ads Relevance Detail');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-10: projects_list with error field relays correctly', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay6', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'projects_list',
        projects: [],
        error: 'BrainData directory not found',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'projects_list');
      expect(received.projects).toEqual([]);
      expect(received.error).toBe('BrainData directory not found');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });

  it('TC-11: project_detail with error field relays correctly', async () => {
    const agent = await connectMockAgentEncrypted(PORT, 'ProjectRelay7', '/project-test');
    const webClient = await connectMockWebClient(PORT, agent.sessionId);
    try {
      await delay(200);

      agent.sendEncrypted({
        type: 'project_detail',
        name: 'nonexistent',
        error: 'Project not found',
      });

      const received = await webClient.waitForMessage((m) => m.type === 'project_detail');
      expect(received.name).toBe('nonexistent');
      expect(received.error).toBe('Project not found');
    } finally {
      webClient.ws.close();
      agent.ws.close();
    }
  });
});
