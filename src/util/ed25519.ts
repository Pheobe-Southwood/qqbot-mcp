import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface Ed25519Keys {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/**
 * QQ derives the Ed25519 key pair deterministically from the bot secret:
 * repeat the secret until 32 bytes, use them as the private seed.
 */
export function ed25519KeysFromSecret(secret: string): Ed25519Keys {
  const secretBytes = Buffer.from(secret, 'utf8');
  if (secretBytes.length === 0) throw new Error('Bot secret must not be empty.');
  const seed = Buffer.alloc(32);
  let offset = 0;
  while (offset < seed.length) {
    const take = Math.min(secretBytes.length, seed.length - offset);
    secretBytes.copy(seed, offset, 0, take);
    offset += take;
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function signWebhookValidation(secret: string, eventTs: string, plainToken: string): string {
  const { privateKey } = ed25519KeysFromSecret(secret);
  return sign(null, Buffer.from(`${eventTs}${plainToken}`, 'utf8'), privateKey).toString('hex');
}

export function verifyWebhookSignature(
  secret: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  const { publicKey } = ed25519KeysFromSecret(secret);
  try {
    return verify(
      null,
      Buffer.from(`${timestamp}${rawBody}`, 'utf8'),
      publicKey,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}
