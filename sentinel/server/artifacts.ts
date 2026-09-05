import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sign, verifySignature } from './auth.js';
import { lineItems, proposalItemSchema, toPaise, type Proposal } from './contracts.js';

export const artifactSchema = z
  .object({
    request_id: z.string().min(6).max(160),
    agent_id: z.string().min(3).max(160),
    approved_merchant: z.string().min(1).max(300),
    approved_order_details: z
      .object({
        product_name: z.string(),
        sku: z.string(),
        quantity: z.number().int().positive(),
        category: z.string(),
        delivery_address: z.string().min(8).max(2000),
        items: z.array(proposalItemSchema).min(1).max(100),
      })
      .strict(),
    max_amount: z.number().finite().nonnegative(),
    currency: z.literal('INR'),
    expiry_time: z.string().datetime(),
    nonce: z.string().uuid(),
    approval_id: z.string().min(1).max(160),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export type AuthorizationArtifact = z.infer<typeof artifactSchema>;

export function makeArtifact(
  proposal: Proposal,
  approvalId: string,
  secret: string,
  now = new Date(),
): AuthorizationArtifact {
  if (proposal.currency !== 'INR') throw new Error('Only INR approvals are supported');
  const payload = {
    request_id: proposal.request_id,
    agent_id: proposal.agent_id,
    approved_merchant: proposal.merchant,
    approved_order_details: {
      product_name: proposal.product_name,
      sku: proposal.sku,
      quantity: proposal.quantity,
      category: proposal.category,
      delivery_address: proposal.delivery_address,
      items: lineItems(proposal),
    },
    max_amount: toPaise(proposal.price) / 100,
    currency: 'INR' as const,
    expiry_time: new Date(now.getTime() + 5 * 60_000).toISOString(),
    nonce: randomUUID(),
    approval_id: approvalId,
  };
  return { ...payload, signature: sign(payload, secret) };
}

/** Signature and time only. The service must also atomically claim the database artifact. */
export function verifyArtifact(
  artifact: unknown,
  secret: string,
  now = new Date(),
): { valid: boolean; reason: string } {
  const parsed = artifactSchema.safeParse(artifact);
  if (!parsed.success) return { valid: false, reason: 'INVALID_ARTIFACT' };
  const { signature, ...payload } = parsed.data;
  if (!verifySignature(payload, signature, secret))
    return { valid: false, reason: 'INVALID_ARTIFACT_SIGNATURE' };
  if (new Date(payload.expiry_time).getTime() <= now.getTime())
    return { valid: false, reason: 'ARTIFACT_EXPIRED' };
  return { valid: true, reason: 'VALID' };
}
