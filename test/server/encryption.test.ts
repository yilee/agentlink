import { describe, it, expect } from 'vitest';
import {
  generateSessionKey,
  encrypt,
  decrypt,
  isEncrypted,
  encodeKey,
  decodeKey,
  parseMessage,
  encryptAndSend,
} from '../../server/src/encryption.js';

describe('Server Encryption', () => {
  describe('generateSessionKey', () => {
    it('returns a 32-byte Uint8Array', () => {
      const key = generateSessionKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('generates unique keys', () => {
      const a = generateSessionKey();
      const b = generateSessionKey();
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    const key = generateSessionKey();

    it('round-trips a simple object', async () => {
      const data = { type: 'chat', prompt: 'hello' };
      const encrypted = await encrypt(data, key);
      expect(encrypted).toHaveProperty('n');
      expect(encrypted).toHaveProperty('c');
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual(data);
    });

    it('round-trips unicode text', async () => {
      const data = { text: '你好世界 🌍 émojis' };
      const encrypted = await encrypt(data, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual(data);
    });

    it('compresses large payloads (z flag)', async () => {
      const data = { payload: 'x'.repeat(1000) };
      const encrypted = await encrypt(data, key);
      expect(encrypted.z).toBe(true);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual(data);
    });

    it('does not compress small payloads', async () => {
      const data = { a: 1 };
      const encrypted = await encrypt(data, key);
      expect(encrypted.z).toBeUndefined();
    });

    it('returns null for wrong key', async () => {
      const wrongKey = generateSessionKey();
      const encrypted = await encrypt({ secret: true }, key);
      const result = await decrypt(encrypted, wrongKey);
      expect(result).toBeNull();
    });

    it('returns null for tampered ciphertext', async () => {
      const encrypted = await encrypt({ data: 'test' }, key);
      encrypted.c = encrypted.c.slice(0, -4) + 'XXXX';
      const result = await decrypt(encrypted, key);
      expect(result).toBeNull();
    });
  });

  describe('isEncrypted', () => {
    it('returns true for encrypted envelope', () => {
      expect(isEncrypted({ n: 'abc', c: 'def' })).toBe(true);
      expect(isEncrypted({ n: 'abc', c: 'def', z: true })).toBe(true);
    });

    it('returns false for plain objects', () => {
      expect(isEncrypted({ type: 'chat' })).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted('string')).toBe(false);
      expect(isEncrypted({ n: 123, c: 'def' })).toBe(false);
    });
  });

  describe('encodeKey / decodeKey', () => {
    it('round-trips a session key', () => {
      const key = generateSessionKey();
      const encoded = encodeKey(key);
      expect(typeof encoded).toBe('string');
      const decoded = decodeKey(encoded);
      expect(Buffer.from(decoded).equals(Buffer.from(key))).toBe(true);
    });
  });

  describe('parseMessage', () => {
    it('decrypts an encrypted message', async () => {
      const key = generateSessionKey();
      const msg = { type: 'chat', prompt: 'hi' };
      const encrypted = await encrypt(msg, key);
      const result = await parseMessage(JSON.stringify(encrypted), key);
      expect(result).toEqual(msg);
    });

    it('parses plain JSON when no key', async () => {
      const msg = { type: 'registered', sessionId: 'abc' };
      const result = await parseMessage(JSON.stringify(msg), null);
      expect(result).toEqual(msg);
    });

    it('returns null for invalid JSON', async () => {
      const result = await parseMessage('not json', null);
      expect(result).toBeNull();
    });
  });

  describe('encryptAndSend', () => {
    it('sends encrypted data when key provided', async () => {
      const key = generateSessionKey();
      const sent: string[] = [];
      const ws = { send: (d: string) => sent.push(d), readyState: 1 };
      await encryptAndSend(ws, { type: 'test' }, key);
      expect(sent.length).toBe(1);
      const parsed = JSON.parse(sent[0]);
      expect(isEncrypted(parsed)).toBe(true);
    });

    it('sends plain JSON when no key', async () => {
      const sent: string[] = [];
      const ws = { send: (d: string) => sent.push(d), readyState: 1 };
      await encryptAndSend(ws, { type: 'test' }, null);
      expect(sent.length).toBe(1);
      expect(JSON.parse(sent[0])).toEqual({ type: 'test' });
    });
  });
});
