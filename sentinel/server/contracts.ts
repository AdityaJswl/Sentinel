import { z } from 'zod';

// The external price is an INR order total. All comparisons use integer paise.
const money = z
  .number()
  .finite()
  .nonnegative()
  .max(100_000_000_000)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    'Amounts must have at most two decimal places.',
  );
const label = z.string().min(1).max(300);
export const proposalItemSchema = z
  .object({
    product_name: label,
    sku: label,
    quantity: z.number().int().positive().max(10_000),
    unit_price: money,
    category: label,
  })
  .strict();

export const proposalSchema = z
  .object({
    request_id: z.string().min(6).max(160),
    agent_id: z.string().min(3).max(160),
    merchant: label,
    product_name: label,
    sku: label,
    quantity: z.number().int().positive().max(1_000_000),
    price: money,
    currency: z.string().length(3),
    category: label,
    delivery_address: z.string().min(8).max(2000),
    items: z.array(proposalItemSchema).min(1).max(100).optional(),
    product_description: z.string().max(6000).optional(),
    quoted_total: money.optional(),
    created_at: z.string().datetime().optional(),
  })
  .strict();

export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalItem = z.infer<typeof proposalItemSchema>;
export type Verdict = 'APPROVE' | 'DENY' | 'ESCALATE';
export type Check = {
  rule: string;
  passed: boolean;
  reason_code: string;
  reason_text: string;
  actual?: string | number | boolean;
  limit?: string | number | boolean;
};

export function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid monetary amount');
  const paise = Math.round(amount * 100);
  if (!Number.isSafeInteger(paise) || Math.abs(amount * 100 - paise) > 0.00001) {
    throw new Error('Monetary amount must have at most two decimal places');
  }
  return paise;
}

export function lineItems(proposal: Proposal): ProposalItem[] {
  return (
    proposal.items ?? [
      {
        product_name: proposal.product_name,
        sku: proposal.sku,
        quantity: proposal.quantity,
        unit_price: proposal.price / proposal.quantity,
        category: proposal.category,
      },
    ]
  );
}
