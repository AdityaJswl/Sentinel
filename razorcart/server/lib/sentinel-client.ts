import crypto from 'node:crypto';
import type { AgentDelegation, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { PurchaseProposal, Scenario } from './sentinel.js';
import { parseJson } from './serialize.js';

export class SentinelBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'SentinelBridgeError';
  }
}

export function secretsMatch(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false;
  const actualHash = crypto.createHash('sha256').update(received).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

/** Same recursively sorted JSON contract as Sentinel's signature verifier. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('Cannot sign a non-JSON value.');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function credentialKey() {
  const raw = process.env.SENTINEL_CREDENTIAL_KEY ?? '';
  const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new SentinelBridgeError(
      'CREDENTIAL_KEY_MISSING',
      'Configure SENTINEL_CREDENTIAL_KEY with a 32-byte base64 or 64-character hex key on the RazorCart server.',
      503,
    );
  }
  return key;
}

export function encryptSigningSecret(secret: string) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSigningSecret(encrypted: string) {
  try {
    const [version, nonce, tag, ciphertext, extra] = encrypted.split('.');
    if (version !== 'v1' || !nonce || !tag || !ciphertext || extra)
      throw new Error('Invalid envelope');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      credentialKey(),
      Buffer.from(nonce, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof SentinelBridgeError) throw error;
    throw new SentinelBridgeError(
      'CREDENTIAL_UNREADABLE',
      'The saved Sentinel credential could not be unlocked. Check the server credential key.',
      503,
    );
  }
}

function sentinelUrl() {
  if (!process.env.SENTINEL_URL)
    throw new SentinelBridgeError(
      'SENTINEL_NOT_CONFIGURED',
      'Set SENTINEL_URL before synchronizing agents.',
      503,
    );
  const url = new URL(process.env.SENTINEL_URL);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new SentinelBridgeError(
      'SENTINEL_URL_INSECURE',
      'Sentinel must use HTTPS, except when running on localhost.',
      503,
    );
  }
  if (url.username || url.password)
    throw new SentinelBridgeError(
      'SENTINEL_URL_INVALID',
      'Credentials must not be embedded in SENTINEL_URL.',
      503,
    );
  return url;
}

export function validateBridgeConfiguration() {
  sentinelUrl();
  credentialKey();
  const registrationKey = process.env.SENTINEL_REGISTRATION_KEY;
  const adminKey = process.env.RAZORCART_ADMIN_KEY;
  if (!registrationKey || !adminKey) {
    throw new SentinelBridgeError(
      'SENTINEL_SETUP_INCOMPLETE',
      'Configure distinct SENTINEL_REGISTRATION_KEY and RAZORCART_ADMIN_KEY secrets on the RazorCart server.',
      503,
    );
  }
  if (
    secretsMatch(registrationKey, adminKey) ||
    secretsMatch(process.env.SENTINEL_CREDENTIAL_KEY, adminKey) ||
    secretsMatch(process.env.SENTINEL_CREDENTIAL_KEY, registrationKey)
  ) {
    throw new SentinelBridgeError(
      'SENTINEL_KEYS_NOT_DISTINCT',
      'The registration, human admin, and credential encryption keys must be different.',
      503,
    );
  }
}

export type AgentRegistration = {
  agent_id: string;
  name: string;
  totalLimit: number;
  perTransactionLimit: number;
  transactionCountLimit: number;
  frequencyCount: number;
  frequencyUnit: 'day' | 'week' | 'month';
  allowedCategories: string[];
  allowedMerchants: string[];
  expiresAt: string;
  currency: 'INR';
};

export function registrationFromDelegation(agent: AgentDelegation): AgentRegistration {
  return {
    agent_id: agent.agentId,
    name: agent.name,
    totalLimit: agent.totalLimitPaise / 100,
    perTransactionLimit: agent.perTransactionLimitPaise / 100,
    transactionCountLimit: agent.transactionCountLimit,
    frequencyCount: agent.frequencyCount,
    frequencyUnit: z.enum(['day', 'week', 'month']).parse(agent.frequencyUnit),
    allowedCategories: parseJson<string[]>(agent.allowedCategoriesJson, []),
    allowedMerchants: parseJson<string[]>(agent.allowedMerchantsJson, []),
    expiresAt: agent.expiresAt.toISOString(),
    currency: 'INR',
  };
}

async function sentinelRequest(url: URL, body: unknown, headers: Record<string, string>) {
  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
      redirect: 'error',
    });
  } catch {
    throw new SentinelBridgeError(
      'SENTINEL_UNAVAILABLE',
      'Sentinel could not be reached within 35 seconds. No local approval was substituted.',
    );
  }
  if (!response.ok) {
    // Never echo an upstream body: it may contain credentials or internal details.
    throw new SentinelBridgeError(
      'SENTINEL_REQUEST_FAILED',
      `Sentinel returned HTTP ${response.status}. Check its service configuration and logs.`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SentinelBridgeError(
      'SENTINEL_INVALID_RESPONSE',
      'Sentinel returned an unreadable response.',
    );
  }
}

export async function registerWithSentinel(
  registration: AgentRegistration,
  existingSecret: string | null = null,
) {
  validateBridgeConfiguration();
  const result = z
    .object({ agent_id: z.string(), signing_secret: z.string().min(16).optional() })
    .safeParse(
      await sentinelRequest(new URL('/agents/register', sentinelUrl()), registration, {
        authorization: `Bearer ${process.env.SENTINEL_REGISTRATION_KEY!}`,
      }),
    );
  if (!result.success || result.data.agent_id !== registration.agent_id) {
    throw new SentinelBridgeError(
      'SENTINEL_REGISTRATION_INVALID',
      'Sentinel did not confirm this agent registration.',
    );
  }
  if (result.data.signing_secret) return encryptSigningSecret(result.data.signing_secret);
  if (existingSecret) {
    decryptSigningSecret(existingSecret);
    return existingSecret;
  }
  throw new SentinelBridgeError(
    'SENTINEL_CREDENTIAL_MISSING',
    'This agent already exists in Sentinel, but RazorCart has no saved signing credential. Restore its encrypted credential or register a new agent ID.',
    409,
  );
}

const verdictSchema = z
  .object({
    authorization_id: z.string().min(1),
    request_id: z.string().min(1),
    agent_id: z.string().min(1),
    verdict: z.enum(['APPROVE', 'DENY', 'ESCALATE']),
    reason_code: z.string().min(1),
    reason: z.string().optional(),
    reason_text: z.string().optional(),
    checks: z.array(z.object({ rule: z.string(), passed: z.boolean() }).passthrough()),
    evaluated_amount: z.number().nonnegative(),
    remaining_budget: z.number().nonnegative(),
  })
  .passthrough()
  .refine((result) => Boolean(result.reason || result.reason_text));

export async function authorizeWithSentinel(
  prisma: PrismaClient,
  proposal: PurchaseProposal,
  scenario: Scenario,
) {
  const delegation = await prisma.agentDelegation.findUnique({
    where: { agentId: proposal.agent_id },
  });
  if (!delegation?.sentinelSecretEncrypted) {
    throw new SentinelBridgeError(
      'AGENT_NOT_REGISTERED_WITH_SENTINEL',
      'This agent needs to be registered with Sentinel by its owner before checkout. Use the agent setup page or the server-side sync command.',
      409,
    );
  }
  const signature = crypto
    .createHmac('sha256', decryptSigningSecret(delegation.sentinelSecretEncrypted))
    .update(canonicalJson(proposal))
    .digest('hex');
  const parsed = verdictSchema.safeParse(
    await sentinelRequest(sentinelUrl(), proposal, {
      'x-agent-id': proposal.agent_id,
      'x-sentinel-signature': signature,
    }),
  );
  if (
    !parsed.success ||
    parsed.data.request_id !== proposal.request_id ||
    parsed.data.agent_id !== proposal.agent_id
  ) {
    throw new SentinelBridgeError(
      'SENTINEL_VERDICT_INVALID',
      'Sentinel returned a verdict that does not match this purchase request.',
    );
  }
  const result = { ...parsed.data, reason: parsed.data.reason || parsed.data.reason_text! };
  await prisma.sentinelAuthorization.upsert({
    where: { authorizationId: result.authorization_id },
    update: {},
    create: {
      authorizationId: result.authorization_id,
      requestId: proposal.request_id,
      agentDelegationId: delegation.id,
      agentId: proposal.agent_id,
      proposalFingerprint: crypto
        .createHash('sha256')
        .update(canonicalJson(proposal))
        .digest('hex'),
      amountPaise: Math.round(result.evaluated_amount * 100),
      verdict: result.verdict,
      reasonCode: result.reason_code,
      reasonMessage: result.reason,
      proposalJson: JSON.stringify({ ...proposal, delivery_address: '[redacted]' }),
      checksJson: JSON.stringify(result.checks),
      scenario,
    },
  });
  return result;
}
