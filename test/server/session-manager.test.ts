import { describe, it, expect } from 'vitest';
import { sessions } from '../../server/src/session-manager.js';

describe('SessionManager', () => {
  describe('generateSessionId', () => {
    it('returns a base64url string', () => {
      const id = sessions.generateSessionId();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(16); // 12 bytes → 16 base64url chars
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => sessions.generateSessionId()));
      expect(ids.size).toBe(100);
    });
  });
});
