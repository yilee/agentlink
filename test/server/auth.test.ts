import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateAuthToken,
  verifyAuthToken,
  isSessionLocked,
  recordFailure,
  clearFailures,
} from '../../server/src/auth.js';
import { authAttempts } from '../../server/src/context.js';

describe('auth — password hashing', () => {
  it('verifyPassword returns true for correct password', () => {
    const { hash, salt } = hashPassword('secret123');
    expect(verifyPassword('secret123', hash, salt)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', () => {
    const { hash, salt } = hashPassword('secret123');
    expect(verifyPassword('wrongpass', hash, salt)).toBe(false);
  });

  it('hashPassword generates different salts each time', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('auth — auth tokens', () => {
  it('generates token that can be verified for the same sessionId', () => {
    const token = generateAuthToken('sess-abc');
    expect(verifyAuthToken(token, 'sess-abc')).toBe(true);
  });

  it('rejects token for different sessionId', () => {
    const token = generateAuthToken('sess-abc');
    expect(verifyAuthToken(token, 'sess-xyz')).toBe(false);
  });

  it('rejects tampered token', () => {
    const token = generateAuthToken('sess-abc');
    const tampered = token.slice(0, -1) + 'X';
    expect(verifyAuthToken(tampered, 'sess-abc')).toBe(false);
  });

  it('rejects malformed token', () => {
    expect(verifyAuthToken('garbage', 'sess-abc')).toBe(false);
    expect(verifyAuthToken('a:b', 'a')).toBe(false);
    expect(verifyAuthToken('', '')).toBe(false);
  });
});

describe('auth — brute-force protection', () => {
  beforeEach(() => {
    authAttempts.clear();
  });

  it('isSessionLocked returns false for unknown session', () => {
    expect(isSessionLocked('unknown')).toBe(false);
  });

  it('records failures and locks after 5', () => {
    const sid = 'test-sess';
    for (let i = 0; i < 4; i++) {
      const r = recordFailure(sid);
      expect(r.locked).toBe(false);
      expect(r.remaining).toBe(4 - i);
    }
    const final = recordFailure(sid);
    expect(final.locked).toBe(true);
    expect(final.remaining).toBe(0);
    expect(isSessionLocked(sid)).toBe(true);
  });

  it('clearFailures resets the count', () => {
    const sid = 'test-sess';
    recordFailure(sid);
    recordFailure(sid);
    clearFailures(sid);
    expect(authAttempts.has(sid)).toBe(false);
    expect(isSessionLocked(sid)).toBe(false);
  });

  it('lockout expires after time passes', () => {
    const sid = 'test-sess';
    for (let i = 0; i < 5; i++) recordFailure(sid);
    expect(isSessionLocked(sid)).toBe(true);

    // Manually set lockedUntil to the past
    const state = authAttempts.get(sid)!;
    state.lockedUntil = new Date(Date.now() - 1000);
    expect(isSessionLocked(sid)).toBe(false);
  });
});
