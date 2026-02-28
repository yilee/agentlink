import tweetnacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tweetnaclUtil;

const COMPRESS_THRESHOLD = 512;

export async function encrypt(data: unknown, key: Uint8Array): Promise<{ n: string; c: string; z?: boolean }> {
  const nonce = tweetnacl.randomBytes(24);
  const jsonStr = JSON.stringify(data);

  let message: Uint8Array;
  let compressed = false;

  if (jsonStr.length > COMPRESS_THRESHOLD) {
    const compressedBuf = await gzip(Buffer.from(jsonStr, 'utf8'));
    message = new Uint8Array(compressedBuf);
    compressed = true;
  } else {
    message = decodeUTF8(jsonStr);
  }

  const encrypted = tweetnacl.secretbox(message, nonce, key);
  const result: { n: string; c: string; z?: boolean } = {
    n: encodeBase64(nonce),
    c: encodeBase64(encrypted),
  };
  if (compressed) result.z = true;
  return result;
}

export async function decrypt(encrypted: { n: string; c: string; z?: boolean }, key: Uint8Array): Promise<unknown | null> {
  try {
    const nonce = decodeBase64(encrypted.n);
    const ciphertext = decodeBase64(encrypted.c);
    const decrypted = tweetnacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) return null;

    if (encrypted.z) {
      const decompressed = await gunzip(Buffer.from(decrypted));
      return JSON.parse(decompressed.toString('utf8'));
    } else {
      return JSON.parse(encodeUTF8(decrypted));
    }
  } catch {
    return null;
  }
}

export function isEncrypted(msg: unknown): msg is { n: string; c: string; z?: boolean } {
  return msg !== null && typeof msg === 'object' && typeof (msg as Record<string, unknown>).n === 'string' && typeof (msg as Record<string, unknown>).c === 'string';
}

export function decodeKey(encodedKey: string): Uint8Array {
  return decodeBase64(encodedKey);
}

export async function parseMessage(data: string, sessionKey: Uint8Array | null): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(data);
    if (sessionKey && isEncrypted(parsed)) {
      return await decrypt(parsed, sessionKey) as Record<string, unknown> | null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function encryptAndSend(ws: { send: (data: string) => void; readyState: number }, msg: unknown, sessionKey: Uint8Array | null): Promise<void> {
  if (sessionKey) {
    const encrypted = await encrypt(msg, sessionKey);
    ws.send(JSON.stringify(encrypted));
  } else {
    ws.send(JSON.stringify(msg));
  }
}
