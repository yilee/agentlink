import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';

export interface AuthAttemptState {
  failures: number;
  lockedUntil: Date | null;
}

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;   // 15 minutes
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AuthManager {
  readonly authAttempts = new Map<string, AuthAttemptState>();
  readonly pendingAuth = new Map<string, string>();
  readonly sessionAuth = new Map<string, { passwordHash: string; passwordSalt: string }>();
  private readonly serverSecret = randomBytes(32);

  // --- Password ---

  hashPassword(password: string): { hash: string; salt: string } {
    const salt = randomBytes(16).toString('base64');
    const hash = scryptSync(password, salt, 32).toString('base64');
    return { hash, salt };
  }

  verifyPassword(submitted: string, storedHash: string, storedSalt: string): boolean {
    const computed = scryptSync(submitted, storedSalt, 32);
    const expected = Buffer.from(storedHash, 'base64');
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  }

  // --- Session password ---

  setSessionPassword(sessionId: string, hash: string, salt: string): void {
    this.sessionAuth.set(sessionId, { passwordHash: hash, passwordSalt: salt });
  }

  getSessionAuth(sessionId: string): { passwordHash: string; passwordSalt: string } | undefined {
    return this.sessionAuth.get(sessionId);
  }

  requiresAuth(sessionId: string): boolean {
    const a = this.sessionAuth.get(sessionId);
    return !!(a?.passwordHash && a?.passwordSalt);
  }

  // --- Token ---

  generateAuthToken(sessionId: string): string {
    const ts = Date.now().toString();
    const hmac = createHmac('sha256', this.serverSecret).update(`${sessionId}:${ts}`).digest('base64url');
    return `${sessionId}:${ts}:${hmac}`;
  }

  verifyAuthToken(token: string, expectedSessionId: string): boolean {
    const idx1 = token.indexOf(':');
    const idx2 = token.indexOf(':', idx1 + 1);
    if (idx1 === -1 || idx2 === -1) return false;

    const sessionId = token.slice(0, idx1);
    const ts = token.slice(idx1 + 1, idx2);
    const hmac = token.slice(idx2 + 1);

    if (sessionId !== expectedSessionId) return false;

    const age = Date.now() - parseInt(ts, 10);
    if (isNaN(age) || age < 0 || age > TOKEN_TTL_MS) return false;

    const expected = createHmac('sha256', this.serverSecret).update(`${sessionId}:${ts}`).digest('base64url');
    return hmac === expected;
  }

  // --- Brute-force protection ---

  isLocked(sessionId: string): boolean {
    const state = this.authAttempts.get(sessionId);
    if (!state?.lockedUntil) return false;
    if (Date.now() > state.lockedUntil.getTime()) {
      this.authAttempts.delete(sessionId);
      return false;
    }
    return true;
  }

  recordFailure(sessionId: string): { locked: boolean; remaining: number } {
    let state = this.authAttempts.get(sessionId);
    if (!state) {
      state = { failures: 0, lockedUntil: null };
      this.authAttempts.set(sessionId, state);
    }
    state.failures++;
    if (state.failures >= MAX_FAILURES) {
      state.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: MAX_FAILURES - state.failures };
  }

  clearFailures(sessionId: string): void {
    this.authAttempts.delete(sessionId);
  }

  // --- Pending auth ---

  setPending(clientId: string, sessionId: string): void {
    this.pendingAuth.set(clientId, sessionId);
  }

  getPending(clientId: string): string | undefined {
    return this.pendingAuth.get(clientId);
  }

  removePending(clientId: string): void {
    this.pendingAuth.delete(clientId);
  }
}

// Singleton instance
export const auth = new AuthManager();
