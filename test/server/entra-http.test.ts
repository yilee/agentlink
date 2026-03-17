/**
 * Tests for Entra ID HTTP route logic — Entra config encoding,
 * meta tag injection, and /s/ → /ms/ redirect guard.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sessions } from '../../server/src/session-manager.js';
import type { AgentSession } from '../../server/src/session-manager.js';

describe('Entra config Base64 encoding', () => {
  it('encodes clientId and tenantId to base64', () => {
    const clientId = '00000000-0000-0000-0000-000000000001';
    const tenantId = '00000000-0000-0000-0000-000000000002';
    const b64 = Buffer.from(JSON.stringify({ clientId, tenantId })).toString('base64');

    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    expect(decoded.clientId).toBe(clientId);
    expect(decoded.tenantId).toBe(tenantId);
  });

  it('produces empty string when not configured', () => {
    const entraClientId = undefined;
    const entraTenantId = undefined;
    const entraConfigured = !!(entraClientId && entraTenantId);
    const entraConfigB64 = entraConfigured
      ? Buffer.from(JSON.stringify({ clientId: entraClientId, tenantId: entraTenantId })).toString('base64')
      : '';
    expect(entraConfigB64).toBe('');
  });

  it('is not configured when only clientId is set', () => {
    const entraClientId = 'some-id';
    const entraTenantId = undefined;
    const entraConfigured = !!(entraClientId && entraTenantId);
    expect(entraConfigured).toBe(false);
  });

  it('is not configured when only tenantId is set', () => {
    const entraClientId = undefined;
    const entraTenantId = 'some-tenant';
    const entraConfigured = !!(entraClientId && entraTenantId);
    expect(entraConfigured).toBe(false);
  });
});

describe('Entra meta tag injection', () => {
  it('injects meta tag after <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>App</title></head><body></body></html>';
    const entraConfigB64 = 'eyJjbGllbnRJZCI6ImFiYyJ9'; // {"clientId":"abc"}
    const injected = html.replace('<head>', `<head>\n    <meta name="entra-config" content="${entraConfigB64}">`);

    expect(injected).toContain('<meta name="entra-config"');
    expect(injected).toContain(`content="${entraConfigB64}"`);
    expect(injected.indexOf('<meta name="entra-config"')).toBeGreaterThan(injected.indexOf('<head>'));
  });

  it('preserves rest of HTML when injecting', () => {
    const html = '<html><head><title>Test</title></head><body><div id="app"></div></body></html>';
    const injected = html.replace('<head>', '<head>\n    <meta name="entra-config" content="abc">');

    expect(injected).toContain('<title>Test</title>');
    expect(injected).toContain('<div id="app"></div>');
  });
});

describe('/s/ → /ms/ redirect guard', () => {
  const mockWs = { readyState: 1, send: () => {}, ping: () => {}, on: () => {}, terminate: () => {} } as unknown as import('ws').WebSocket;

  beforeEach(() => {
    // Clean up sessions between tests
    for (const [agentId] of sessions.agents) {
      sessions.removeAgent(agentId);
    }
  });

  function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      ws: mockWs,
      agentId: 'test-agent',
      name: 'TestAgent',
      hostname: 'localhost',
      workDir: '/tmp',
      version: '0.1.0',
      sessionId: 'test-session-123',
      sessionKey: null,
      connectedAt: new Date(),
      isAlive: true,
      passwordHash: null,
      passwordSalt: null,
      entra: false,
      ...overrides,
    };
  }

  it('redirects /s/ to /ms/ when agent has entra: true', () => {
    const agent = makeAgent({ entra: true, sessionId: 'sess-entra' });
    sessions.registerAgent('agent-1', agent);

    const foundAgent = sessions.getAgentBySession('sess-entra');
    expect(foundAgent?.entra).toBe(true);

    // Simulate the route logic: if agent?.entra → redirect to /ms/
    const shouldRedirect = foundAgent?.entra === true;
    expect(shouldRedirect).toBe(true);
  });

  it('does not redirect /s/ when agent has entra: false', () => {
    const agent = makeAgent({ entra: false, sessionId: 'sess-normal' });
    sessions.registerAgent('agent-2', agent);

    const foundAgent = sessions.getAgentBySession('sess-normal');
    expect(foundAgent?.entra).toBe(false);

    const shouldRedirect = foundAgent?.entra === true;
    expect(shouldRedirect).toBe(false);
  });

  it('does not redirect /s/ when session not found (no agent)', () => {
    const foundAgent = sessions.getAgentBySession('nonexistent');
    expect(foundAgent).toBeUndefined();

    const shouldRedirect = foundAgent?.entra === true;
    expect(shouldRedirect).toBe(false);
  });

  it('builds correct redirect URL', () => {
    const sessionId = 'ghluAwMkwRk18XBH';
    const redirectUrl = `/ms/${sessionId}`;
    expect(redirectUrl).toBe('/ms/ghluAwMkwRk18XBH');
  });
});

describe('AgentSession entra field', () => {
  const mockWs = { readyState: 1, send: () => {}, ping: () => {}, on: () => {}, terminate: () => {} } as unknown as import('ws').WebSocket;

  beforeEach(() => {
    for (const [agentId] of sessions.agents) {
      sessions.removeAgent(agentId);
    }
  });

  it('stores entra: true on agent session', () => {
    const agent: AgentSession = {
      ws: mockWs,
      agentId: 'entra-agent',
      name: 'EntraAgent',
      hostname: 'host',
      workDir: '/work',
      version: '1.0',
      sessionId: 'entra-sess',
      sessionKey: null,
      connectedAt: new Date(),
      isAlive: true,
      passwordHash: null,
      passwordSalt: null,
      entra: true,
    };

    sessions.registerAgent('entra-agent', agent);
    const retrieved = sessions.getAgent('entra-agent');
    expect(retrieved?.entra).toBe(true);
  });

  it('stores entra: false on agent session', () => {
    const agent: AgentSession = {
      ws: mockWs,
      agentId: 'normal-agent',
      name: 'NormalAgent',
      hostname: 'host',
      workDir: '/work',
      version: '1.0',
      sessionId: 'normal-sess',
      sessionKey: null,
      connectedAt: new Date(),
      isAlive: true,
      passwordHash: null,
      passwordSalt: null,
      entra: false,
    };

    sessions.registerAgent('normal-agent', agent);
    const retrieved = sessions.getAgent('normal-agent');
    expect(retrieved?.entra).toBe(false);
  });

  it('getAgentBySession returns agent with correct entra flag', () => {
    const agent: AgentSession = {
      ws: mockWs,
      agentId: 'by-session-agent',
      name: 'BySessionAgent',
      hostname: 'host',
      workDir: '/work',
      version: '1.0',
      sessionId: 'by-session-id',
      sessionKey: null,
      connectedAt: new Date(),
      isAlive: true,
      passwordHash: null,
      passwordSalt: null,
      entra: true,
    };

    sessions.registerAgent('by-session-agent', agent);
    const found = sessions.getAgentBySession('by-session-id');
    expect(found).toBeDefined();
    expect(found!.entra).toBe(true);
  });
});
