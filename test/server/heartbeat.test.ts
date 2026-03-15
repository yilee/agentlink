import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessions } from '../../server/src/session-manager.js';
import type { AgentSession, WebClient } from '../../server/src/session-manager.js';

function mockWs(isAlive: boolean, readyState = 1 /* OPEN */) {
  return {
    terminate: vi.fn(),
    ping: vi.fn(),
    readyState,
    isAlive,
  } as unknown;
}

function makeAgent(id: string, sessionId: string, isAlive: boolean): AgentSession {
  return {
    ws: mockWs(isAlive) as any,
    agentId: id,
    name: `Agent-${id}`,
    hostname: 'localhost',
    workDir: '/tmp',
    version: '0.1.0',
    sessionId,
    sessionKey: null,
    connectedAt: new Date(),
    isAlive,
    passwordHash: null,
    passwordSalt: null,
  };
}

function makeClient(id: string, sessionId: string, isAlive: boolean): WebClient {
  return {
    ws: mockWs(isAlive) as any,
    clientId: id,
    sessionId,
    sessionKey: null,
    connectedAt: new Date(),
    isAlive,
  };
}

describe('cleanupDeadConnections', () => {
  beforeEach(() => {
    sessions.agents.clear();
    sessions.webClients.clear();
    sessions.sessionToAgent.clear();
  });

  it('removes all dead agents, not just the first', () => {
    const a1 = makeAgent('a1', 's1', false);
    const a2 = makeAgent('a2', 's2', false);
    const a3 = makeAgent('a3', 's3', true);

    sessions.agents.set('a1', a1);
    sessions.agents.set('a2', a2);
    sessions.agents.set('a3', a3);
    sessions.sessionToAgent.set('s1', 'a1');
    sessions.sessionToAgent.set('s2', 'a2');
    sessions.sessionToAgent.set('s3', 'a3');

    const notifyFn = vi.fn();
    const result = sessions.cleanupDeadConnections(notifyFn);

    expect(result.removedAgents).toEqual(['a1', 'a2']);
    expect(sessions.agents.size).toBe(1);
    expect(sessions.agents.has('a3')).toBe(true);
    expect(sessions.sessionToAgent.has('s1')).toBe(false);
    expect(sessions.sessionToAgent.has('s2')).toBe(false);
    expect(sessions.sessionToAgent.has('s3')).toBe(true);
    expect(a1.ws.terminate).toHaveBeenCalled();
    expect(a2.ws.terminate).toHaveBeenCalled();
    expect(a3.ws.terminate).not.toHaveBeenCalled();
  });

  it('removes all dead web clients, not just the first', () => {
    const c1 = makeClient('c1', 's1', false);
    const c2 = makeClient('c2', 's1', false);
    const c3 = makeClient('c3', 's1', true);

    sessions.webClients.set('c1', c1);
    sessions.webClients.set('c2', c2);
    sessions.webClients.set('c3', c3);

    const notifyFn = vi.fn();
    const result = sessions.cleanupDeadConnections(notifyFn);

    expect(result.removedClients).toEqual(['c1', 'c2']);
    expect(sessions.webClients.size).toBe(1);
    expect(sessions.webClients.has('c3')).toBe(true);
    expect(c1.ws.terminate).toHaveBeenCalled();
    expect(c2.ws.terminate).toHaveBeenCalled();
    expect(c3.ws.terminate).not.toHaveBeenCalled();
  });

  it('pings alive connections', () => {
    const a1 = makeAgent('a1', 's1', true);
    const c1 = makeClient('c1', 's1', true);

    sessions.agents.set('a1', a1);
    sessions.webClients.set('c1', c1);

    const notifyFn = vi.fn();
    sessions.cleanupDeadConnections(notifyFn);

    expect(a1.ws.ping).toHaveBeenCalled();
    expect(c1.ws.ping).toHaveBeenCalled();
    expect(a1.isAlive).toBe(false);
    expect(c1.isAlive).toBe(false);
  });

  it('notifies web clients when their agent is removed', () => {
    const a1 = makeAgent('a1', 's1', false);
    const c1 = makeClient('c1', 's1', true);
    const c2 = makeClient('c2', 's2', true); // different session

    sessions.agents.set('a1', a1);
    sessions.sessionToAgent.set('s1', 'a1');
    sessions.webClients.set('c1', c1);
    sessions.webClients.set('c2', c2);

    const notifyFn = vi.fn();
    sessions.cleanupDeadConnections(notifyFn);

    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(notifyFn).toHaveBeenCalledWith(c1, { type: 'agent_disconnected' });
  });

  it('handles empty maps without errors', () => {
    const notifyFn = vi.fn();
    const result = sessions.cleanupDeadConnections(notifyFn);

    expect(result.removedAgents).toEqual([]);
    expect(result.removedClients).toEqual([]);
    expect(notifyFn).not.toHaveBeenCalled();
  });

  it('cleans up sessionToAgent for dead agents', () => {
    const a1 = makeAgent('a1', 's1', false);
    sessions.agents.set('a1', a1);
    sessions.sessionToAgent.set('s1', 'a1');

    const notifyFn = vi.fn();
    sessions.cleanupDeadConnections(notifyFn);

    expect(sessions.sessionToAgent.size).toBe(0);
  });
});
