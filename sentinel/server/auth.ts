import crypto from 'node:crypto';

/** Canonical JSON: recursive lexical object keys; arrays retain their order. */
export function canonical(value: unknown): string {
  const encode = (input: unknown): string => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean')
      return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(encode).join(',')}]`;
    if (
      typeof input === 'object' &&
      input !== null &&
      Object.getPrototypeOf(input) === Object.prototype
    ) {
      return `{${Object.entries(input)
        .filter(([, member]) => member !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, member]) => `${JSON.stringify(key)}:${encode(member)}`)
        .join(',')}}`;
    }
    throw new Error('Only JSON values may be signed');
  };
  return encode(value);
}

export function sign(value: unknown, secret: string): string {
  if (!secret) throw new Error('Signing secret is required');
  return crypto.createHmac('sha256', secret).update(canonical(value), 'utf8').digest('hex');
}

export function verifySignature(
  value: unknown,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-fA-F0-9]{64}$/.test(signature) || !secret) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sign(value, secret), 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}

function encryptionKey(master: string): Buffer {
  if (master.length < 32) throw new Error('SIGNING_SECRET must contain at least 32 characters');
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(master),
      Buffer.from('sentinel:v1'),
      Buffer.from('agent-secret-encryption'),
      32,
    ),
  );
}

export function encryptSecret(secret: string, master: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(master), iv);
  cipher.setAAD(Buffer.from('sentinel:agent-secret:v1'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(ciphertext: string, master: string): string {
  const [version, iv, tag, encrypted, extra] = ciphertext.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted || extra !== undefined)
    throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(master),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from('sentinel:agent-secret:v1'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
