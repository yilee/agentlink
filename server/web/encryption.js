/**
 * Browser-compatible encryption utilities using TweetNaCl and Pako from CDN.
 * Requires: nacl, nacl.util (tweetnacl-util), and pako globals.
 */

const COMPRESS_THRESHOLD = 512;

export function encrypt(data, key) {
  const nonce = nacl.randomBytes(24);
  const jsonStr = JSON.stringify(data);

  let message;
  let compressed = false;

  if (jsonStr.length > COMPRESS_THRESHOLD) {
    message = pako.gzip(jsonStr);
    compressed = true;
  } else {
    message = nacl.util.decodeUTF8(jsonStr);
  }

  const encrypted = nacl.secretbox(message, nonce, key);
  const result = {
    n: nacl.util.encodeBase64(nonce),
    c: nacl.util.encodeBase64(encrypted),
  };
  if (compressed) result.z = true;
  return result;
}

export function decrypt(encrypted, key) {
  try {
    const nonce = nacl.util.decodeBase64(encrypted.n);
    const ciphertext = nacl.util.decodeBase64(encrypted.c);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) return null;

    if (encrypted.z) {
      const decompressed = pako.ungzip(decrypted, { to: 'string' });
      return JSON.parse(decompressed);
    } else {
      return JSON.parse(nacl.util.encodeUTF8(decrypted));
    }
  } catch (err) {
    console.error('[Decrypt] Failed:', err.message);
    return null;
  }
}

export function isEncrypted(msg) {
  return msg && typeof msg === 'object' && typeof msg.n === 'string' && typeof msg.c === 'string';
}

export function decodeKey(encodedKey) {
  return nacl.util.decodeBase64(encodedKey);
}
