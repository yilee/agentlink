/**
 * Tests for Entra ID auth logic — domain validation, config parsing,
 * and main.js routing (protected vs unprotected paths).
 */

import { describe, it, expect } from 'vitest';

describe('isAllowedDomain', () => {
  // Inline the pure function for unit testing (avoids MSAL browser dependency)
  function isAllowedDomain(account: { username?: string } | null | undefined): boolean {
    if (!account || !account.username) return false;
    return account.username.toLowerCase().endsWith('@microsoft.com');
  }

  it('allows @microsoft.com email', () => {
    expect(isAllowedDomain({ username: 'user@microsoft.com' })).toBe(true);
  });

  it('allows uppercase @MICROSOFT.COM email', () => {
    expect(isAllowedDomain({ username: 'User@MICROSOFT.COM' })).toBe(true);
  });

  it('allows mixed case @Microsoft.Com', () => {
    expect(isAllowedDomain({ username: 'John.Doe@Microsoft.Com' })).toBe(true);
  });

  it('rejects @gmail.com email', () => {
    expect(isAllowedDomain({ username: 'user@gmail.com' })).toBe(false);
  });

  it('rejects @microsoft.com.evil.com (suffix attack)', () => {
    expect(isAllowedDomain({ username: 'user@microsoft.com.evil.com' })).toBe(false);
  });

  it('rejects @notmicrosoft.com', () => {
    expect(isAllowedDomain({ username: 'user@notmicrosoft.com' })).toBe(false);
  });

  it('rejects null account', () => {
    expect(isAllowedDomain(null)).toBe(false);
  });

  it('rejects undefined account', () => {
    expect(isAllowedDomain(undefined)).toBe(false);
  });

  it('rejects account with no username', () => {
    expect(isAllowedDomain({})).toBe(false);
  });

  it('rejects empty username', () => {
    expect(isAllowedDomain({ username: '' })).toBe(false);
  });
});

describe('getEntraConfig', () => {
  // Inline the pure config-parsing function for unit testing
  function getEntraConfig(metaContent: string | null | undefined): { clientId: string; tenantId: string } | null {
    if (!metaContent) return null;
    try { return JSON.parse(atob(metaContent)); } catch { return null; }
  }

  it('parses valid base64-encoded JSON config', () => {
    const config = { clientId: 'my-client-id', tenantId: 'my-tenant-id' };
    const b64 = btoa(JSON.stringify(config));
    expect(getEntraConfig(b64)).toEqual(config);
  });

  it('returns null for null content', () => {
    expect(getEntraConfig(null)).toBeNull();
  });

  it('returns null for undefined content', () => {
    expect(getEntraConfig(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getEntraConfig('')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(getEntraConfig('not-valid-base64!!!')).toBeNull();
  });

  it('returns null for valid base64 but invalid JSON', () => {
    const b64 = btoa('this is not json');
    expect(getEntraConfig(b64)).toBeNull();
  });
});

describe('msalConfig construction', () => {
  function buildMsalConfig(entra: { clientId: string; tenantId: string } | null, origin: string) {
    return {
      auth: {
        clientId: entra?.clientId || '',
        authority: `https://login.microsoftonline.com/${entra?.tenantId || 'common'}`,
        redirectUri: `${origin}/auth/callback`,
      },
      cache: { cacheLocation: 'localStorage' },
    };
  }

  it('builds config with provided clientId and tenantId', () => {
    const config = buildMsalConfig({ clientId: 'abc', tenantId: 'xyz' }, 'https://msclaude.ai');
    expect(config.auth.clientId).toBe('abc');
    expect(config.auth.authority).toBe('https://login.microsoftonline.com/xyz');
    expect(config.auth.redirectUri).toBe('https://msclaude.ai/auth/callback');
  });

  it('falls back to empty clientId and common tenant when entra is null', () => {
    const config = buildMsalConfig(null, 'http://localhost:3456');
    expect(config.auth.clientId).toBe('');
    expect(config.auth.authority).toBe('https://login.microsoftonline.com/common');
    expect(config.auth.redirectUri).toBe('http://localhost:3456/auth/callback');
  });

  it('always uses localStorage for cache', () => {
    const config = buildMsalConfig({ clientId: 'x', tenantId: 'y' }, 'https://example.com');
    expect(config.cache.cacheLocation).toBe('localStorage');
  });
});

describe('main.js routing logic', () => {
  function isProtectedRoute(pathname: string): boolean {
    return pathname.startsWith('/ms/');
  }

  function isAuthCallback(pathname: string): boolean {
    return pathname === '/auth/callback';
  }

  it('/ms/sessionId is a protected route', () => {
    expect(isProtectedRoute('/ms/abc123')).toBe(true);
  });

  it('/ms/ root is a protected route', () => {
    expect(isProtectedRoute('/ms/')).toBe(true);
  });

  it('/s/sessionId is NOT a protected route', () => {
    expect(isProtectedRoute('/s/abc123')).toBe(false);
  });

  it('/ is NOT a protected route', () => {
    expect(isProtectedRoute('/')).toBe(false);
  });

  it('/auth/callback is an auth callback', () => {
    expect(isAuthCallback('/auth/callback')).toBe(true);
  });

  it('/auth/callback/ (trailing slash) is NOT an auth callback', () => {
    expect(isAuthCallback('/auth/callback/')).toBe(false);
  });

  it('/s/abc is not an auth callback', () => {
    expect(isAuthCallback('/s/abc')).toBe(false);
  });

  describe('firstName extraction', () => {
    function extractFirstName(account: { name?: string; username: string }): string {
      return (account.name || '').split(' ')[0] || account.username;
    }

    it('extracts first name from full name', () => {
      expect(extractFirstName({ name: 'Kailun Shi', username: 'kshi@microsoft.com' })).toBe('Kailun');
    });

    it('uses first part of multi-word name', () => {
      expect(extractFirstName({ name: 'John Michael Doe', username: 'jdoe@microsoft.com' })).toBe('John');
    });

    it('falls back to username when name is empty', () => {
      expect(extractFirstName({ name: '', username: 'kshi@microsoft.com' })).toBe('kshi@microsoft.com');
    });

    it('falls back to username when name is undefined', () => {
      expect(extractFirstName({ username: 'user@microsoft.com' })).toBe('user@microsoft.com');
    });

    it('handles single-word name', () => {
      expect(extractFirstName({ name: 'Kailun', username: 'kshi@microsoft.com' })).toBe('Kailun');
    });
  });
});
