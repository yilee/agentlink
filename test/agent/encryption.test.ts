import { describe, it, expect } from 'vitest';
import tweetnacl from 'tweetnacl';
import {
  encrypt,
  decrypt,
  isEncrypted,
  decodeKey,
  parseMessage,
  encryptAndSend,
} from '../../agent/src/encryption.js';

function makeKey(): Uint8Array {
  return tweetnacl.randomBytes(32);
}

describe('Agent Encryption', () => {
  describe('encrypt / decrypt round-trip', () => {
    const key = makeKey();

    it('round-trips a simple object', async () => {
      const data = { type: 'chat', prompt: 'hello' };
      const encrypted = await encrypt(data, key);
      expect(encrypted).toHaveProperty('n');
      expect(encrypted).toHaveProperty('c');
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual(data);
    });

    it('round-trips unicode text', async () => {
      const data = { text: '你好世界 🌍' };
      const decrypted = await decrypt(await encrypt(data, key), key);
      expect(decrypted).toEqual(data);
    });

    it('compresses large payloads', async () => {
      const data = { payload: 'a'.repeat(1000) };
      const encrypted = await encrypt(data, key);
      expect(encrypted.z).toBe(true);
      expect(await decrypt(encrypted, key)).toEqual(data);
    });

    it('returns null for wrong key', async () => {
      const encrypted = await encrypt({ secret: true }, key);
      const result = await decrypt(encrypted, makeKey());
      expect(result).toBeNull();
    });
  });

  describe('isEncrypted', () => {
    it('detects encrypted envelopes', () => {
      expect(isEncrypted({ n: 'x', c: 'y' })).toBe(true);
      expect(isEncrypted({ n: 'x', c: 'y', z: true })).toBe(true);
    });

    it('rejects non-envelopes', () => {
      expect(isEncrypted({ type: 'chat' })).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(42)).toBe(false);
    });
  });

  describe('decodeKey', () => {
    it('decodes a base64 key', () => {
      const key = makeKey();
      const encoded = Buffer.from(key).toString('base64');
      const decoded = decodeKey(encoded);
      expect(Buffer.from(decoded).equals(Buffer.from(key))).toBe(true);
    });
  });

  describe('parseMessage', () => {
    it('decrypts an encrypted message', async () => {
      const key = makeKey();
      const msg = { type: 'chat', prompt: 'hi' };
      const encrypted = await encrypt(msg, key);
      const result = await parseMessage(JSON.stringify(encrypted), key);
      expect(result).toEqual(msg);
    });

    it('parses plain JSON when no key', async () => {
      const msg = { type: 'registered' };
      expect(await parseMessage(JSON.stringify(msg), null)).toEqual(msg);
    });

    it('returns null for invalid input', async () => {
      expect(await parseMessage('bad', null)).toBeNull();
    });
  });

  describe('encryptAndSend', () => {
    it('sends encrypted when key provided', async () => {
      const key = makeKey();
      const sent: string[] = [];
      const ws = { send: (d: string) => sent.push(d), readyState: 1 };
      await encryptAndSend(ws, { type: 'test' }, key);
      expect(isEncrypted(JSON.parse(sent[0]))).toBe(true);
    });

    it('sends plain when no key', async () => {
      const sent: string[] = [];
      const ws = { send: (d: string) => sent.push(d), readyState: 1 };
      await encryptAndSend(ws, { type: 'test' }, null);
      expect(JSON.parse(sent[0])).toEqual({ type: 'test' });
    });
  });
});
