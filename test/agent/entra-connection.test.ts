/**
 * Tests for Entra ID flag in agent connection — WebSocket URL construction
 * and session URL path prefix (/s/ vs /ms/).
 */

import { describe, it, expect } from 'vitest';

describe('buildWsUrl entra flag', () => {
  // Inline the URL-building logic from connection.ts for isolated testing
  function buildWsUrl(config: { server: string; name: string; password?: string; entra?: boolean }, workDir: string, sessionId?: string | null): string {
    const base = config.server.replace(/\/$/, '');
    const params = new URLSearchParams({
      type: 'agent',
      id: config.name,
      name: config.name,
      workDir,
      hostname: 'test-host',
      version: '0.1.0',
    });
    if (sessionId) {
      params.set('sessionId', sessionId);
    }
    if (config.password) {
      params.set('password', config.password);
    }
    if (config.entra) {
      params.set('entra', '1');
    }
    return `${base}/?${params}`;
  }

  it('includes entra=1 when entra is true', () => {
    const url = buildWsUrl({ server: 'ws://localhost:3456', name: 'Agent1', entra: true }, '/home/user');
    expect(url).toContain('entra=1');
  });

  it('does not include entra param when entra is false', () => {
    const url = buildWsUrl({ server: 'ws://localhost:3456', name: 'Agent1', entra: false }, '/home/user');
    expect(url).not.toContain('entra=');
  });

  it('does not include entra param when entra is undefined', () => {
    const url = buildWsUrl({ server: 'ws://localhost:3456', name: 'Agent1' }, '/home/user');
    expect(url).not.toContain('entra=');
  });

  it('includes other params alongside entra', () => {
    const url = buildWsUrl(
      { server: 'wss://msclaude.ai', name: 'MyAgent', password: 'secret', entra: true },
      '/work/dir',
      'existing-session'
    );
    expect(url).toContain('entra=1');
    expect(url).toContain('password=secret');
    expect(url).toContain('sessionId=existing-session');
    expect(url).toContain('name=MyAgent');
    expect(url).toContain('type=agent');
  });
});

describe('session URL path prefix', () => {
  function buildSessionUrl(httpBase: string, entra: boolean, sessionId: string): string {
    return `${httpBase}/${entra ? 'ms' : 's'}/${sessionId}`;
  }

  it('uses /ms/ prefix when entra is true', () => {
    const url = buildSessionUrl('https://msclaude.ai', true, 'abc123');
    expect(url).toBe('https://msclaude.ai/ms/abc123');
  });

  it('uses /s/ prefix when entra is false', () => {
    const url = buildSessionUrl('https://msclaude.ai', false, 'abc123');
    expect(url).toBe('https://msclaude.ai/s/abc123');
  });

  it('works with localhost', () => {
    const url = buildSessionUrl('http://localhost:3456', true, 'XYZ789');
    expect(url).toBe('http://localhost:3456/ms/XYZ789');
  });
});

describe('ws-agent entra param parsing', () => {
  // Inline the parsing logic from ws-agent.ts
  function parseEntraParam(urlString: string, host: string): boolean {
    const url = new URL(urlString, `http://${host}`);
    return url.searchParams.get('entra') === '1';
  }

  it('parses entra=1 as true', () => {
    expect(parseEntraParam('/?type=agent&entra=1', 'localhost:3456')).toBe(true);
  });

  it('parses entra=0 as false', () => {
    expect(parseEntraParam('/?type=agent&entra=0', 'localhost:3456')).toBe(false);
  });

  it('parses missing entra as false', () => {
    expect(parseEntraParam('/?type=agent', 'localhost:3456')).toBe(false);
  });

  it('parses entra=true as false (only "1" is accepted)', () => {
    expect(parseEntraParam('/?type=agent&entra=true', 'localhost:3456')).toBe(false);
  });

  it('parses empty entra as false', () => {
    expect(parseEntraParam('/?type=agent&entra=', 'localhost:3456')).toBe(false);
  });
});
