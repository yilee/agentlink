import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { authAttempts, serverSecret } from './context.js';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;   // 15 minutes
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('base64');
  const hash = scryptSync(password, salt, 32).toString('base64');
  return { hash, salt };
}

export function verifyPassword(submitted: string, storedHash: string, storedSalt: string): boolean {
  const computed = scryptSync(submitted, storedSalt, 32);
  const expected = Buffer.from(storedHash, 'base64');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function generateAuthToken(sessionId: string): string {
  const ts = Date.now().toString();
  const hmac = createHmac('sha256', serverSecret).update(`${sessionId}:${ts}`).digest('base64url');
  return `${sessionId}:${ts}:${hmac}`;
}

export function verifyAuthToken(token: string, expectedSessionId: string): boolean {
  const idx1 = token.indexOf(':');
  const idx2 = token.indexOf(':', idx1 + 1);
  if (idx1 === -1 || idx2 === -1) return false;

  const sessionId = token.slice(0, idx1);
  const ts = token.slice(idx1 + 1, idx2);
  const hmac = token.slice(idx2 + 1);

  if (sessionId !== expectedSessionId) return false;

  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > TOKEN_TTL_MS) return false;

  const expected = createHmac('sha256', serverSecret).update(`${sessionId}:${ts}`).digest('base64url');
  return hmac === expected;
}

export function isSessionLocked(sessionId: string): boolean {
  const state = authAttempts.get(sessionId);
  if (!state?.lockedUntil) return false;
  if (Date.now() > state.lockedUntil.getTime()) {
    authAttempts.delete(sessionId);
    return false;
  }
  return true;
}

export function recordFailure(sessionId: string): { locked: boolean; remaining: number } {
  let state = authAttempts.get(sessionId);
  if (!state) {
    state = { failures: 0, lockedUntil: null };
    authAttempts.set(sessionId, state);
  }
  state.failures++;
  if (state.failures >= MAX_FAILURES) {
    state.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    return { locked: true, remaining: 0 };
  }
  return { locked: false, remaining: MAX_FAILURES - state.failures };
}

export function clearFailures(sessionId: string): void {
  authAttempts.delete(sessionId);
}
