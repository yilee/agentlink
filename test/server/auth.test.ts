import { describe, it, expect, beforeEach } from 'vitest';
import { auth } from '../../server/src/auth-manager.js';

describe('auth — password hashing', () => {
  it('verifyPassword returns true for correct password', () => {
    const { hash, salt } = auth.hashPassword('secret123');
    expect(auth.verifyPassword('secret123', hash, salt)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', () => {
    const { hash, salt } = auth.hashPassword('secret123');
    expect(auth.verifyPassword('wrongpass', hash, salt)).toBe(false);
  });

  it('hashPassword generates different salts each time', () => {
    const a = auth.hashPassword('same');
    const b = auth.hashPassword('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('auth — auth tokens', () => {
  it('generates token that can be verified for the same sessionId', () => {
    const token = auth.generateAuthToken('sess-abc');
    expect(auth.verifyAuthToken(token, 'sess-abc')).toBe(true);
  });

  it('rejects token for different sessionId', () => {
    const token = auth.generateAuthToken('sess-abc');
    expect(auth.verifyAuthToken(token, 'sess-xyz')).toBe(false);
  });

  it('rejects tampered token', () => {
    const token = auth.generateAuthToken('sess-abc');
    const tampered = token.slice(0, -1) + 'X';
    expect(auth.verifyAuthToken(tampered, 'sess-abc')).toBe(false);
  });

  it('rejects malformed token', () => {
    expect(auth.verifyAuthToken('garbage', 'sess-abc')).toBe(false);
    expect(auth.verifyAuthToken('a:b', 'a')).toBe(false);
    expect(auth.verifyAuthToken('', '')).toBe(false);
  });
});

describe('auth — brute-force protection', () => {
  beforeEach(() => {
    auth.authAttempts.clear();
  });

  it('isLocked returns false for unknown session', () => {
    expect(auth.isLocked('unknown')).toBe(false);
  });

  it('records failures and locks after 5', () => {
    const sid = 'test-sess';
    for (let i = 0; i < 4; i++) {
      const r = auth.recordFailure(sid);
      expect(r.locked).toBe(false);
      expect(r.remaining).toBe(4 - i);
    }
    const final = auth.recordFailure(sid);
    expect(final.locked).toBe(true);
    expect(final.remaining).toBe(0);
    expect(auth.isLocked(sid)).toBe(true);
  });

  it('clearFailures resets the count', () => {
    const sid = 'test-sess';
    auth.recordFailure(sid);
    auth.recordFailure(sid);
    auth.clearFailures(sid);
    expect(auth.authAttempts.has(sid)).toBe(false);
    expect(auth.isLocked(sid)).toBe(false);
  });

  it('lockout expires after time passes', () => {
    const sid = 'test-sess';
    for (let i = 0; i < 5; i++) auth.recordFailure(sid);
    expect(auth.isLocked(sid)).toBe(true);

    // Manually set lockedUntil to the past
    const state = auth.authAttempts.get(sid)!;
    state.lockedUntil = new Date(Date.now() - 1000);
    expect(auth.isLocked(sid)).toBe(false);
  });
});
