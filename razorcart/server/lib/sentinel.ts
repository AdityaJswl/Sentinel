import crypto from 'node:crypto';
import type { PrismaClient, AgentDelegation, Product } from '@prisma/client';
import { z } from 'zod';
import { parseJson } from './serialize.js';

export const proposalSchema = z.object({
  request_id: z.string().min(6),
  agent_id: z.string().min(3),
  merchant: z.string().min(2),
  product_name: z.string().min(1),
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative(),
  currency: z.literal('INR'),
  category: z.string().min(1),
  delivery_address: z.string().min(8),
  quoted_total: z.number().nonnegative(),
  created_at: z.string().datetime(),
  items: z
    .array(
      z.object({
        product_name: z.string(),
        sku: z.string(),
        quantity: z.number().int().positive(),
        unit_price: z.number().nonnegative(),
        category: z.string(),
      }),
    )
    .min(1)
    .optional(),
});

export type PurchaseProposal = z.infer<typeof proposalSchema>;
export type Verdict = 'APPROVE' | 'DENY' | 'ESCALATE';
export type Scenario =
  'normal' | 'price_tampering' | 'replay' | 'budget_breach' | 'merchant_mismatch';
type Check = { rule: string; passed: boolean; actual?: string | number; limit?: string | number };

function fingerprint(proposal: PurchaseProposal) {
  return crypto.createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
}

function windowStart(unit: string) {
  const now = new Date();
  if (unit === 'week') return new Date(now.getTime() - 7 * 86_400_000);
  if (unit === 'month') return new Date(now.getTime() - 30 * 86_400_000);
  return new Date(now.getTime() - 86_400_000);
}

function result(
  proposal: PurchaseProposal,
  verdict: Verdict,
  reasonCode: string,
  reason: string,
  checks: Check[],
  remainingBudgetPaise: number,
) {
  return {
    authorization_id: `auth_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
    request_id: proposal.request_id,
    agent_id: proposal.agent_id,
    verdict,
    reason_code: reasonCode,
    reason,
    checks,
    evaluated_amount: proposal.price,
    remaining_budget: Math.max(0, remainingBudgetPaise) / 100,
    ...(verdict === 'APPROVE' ? { authorized_at: new Date().toISOString() } : {}),
  };
}

async function storeResult(
  prisma: PrismaClient,
  proposal: PurchaseProposal,
  scenario: Scenario,
  response: ReturnType<typeof result>,
  delegation?: AgentDelegation | null,
) {
  await prisma.sentinelAuthorization.create({
    data: {
      authorizationId: response.authorization_id,
      requestId: proposal.request_id,
      agentDelegationId: delegation?.id ?? null,
      agentId: proposal.agent_id,
      proposalFingerprint: fingerprint(proposal),
      amountPaise: Math.round(proposal.price * 100),
      verdict: response.verdict,
      reasonCode: response.reason_code,
      reasonMessage: response.reason,
      proposalJson: JSON.stringify({ ...proposal, delivery_address: '[redacted]' }),
      checksJson: JSON.stringify(response.checks),
      scenario,
    },
  });
  return response;
}

export async function evaluateProposal(
  prisma: PrismaClient,
  rawProposal: unknown,
  scenario: Scenario = 'normal',
) {
  const parsed = proposalSchema.safeParse(rawProposal);
  if (!parsed.success) {
    const fallback = {
      request_id: (rawProposal as any)?.request_id || `req_invalid_${Date.now()}`,
      agent_id: (rawProposal as any)?.agent_id || 'unknown',
      merchant: (rawProposal as any)?.merchant || 'unknown',
      product_name: (rawProposal as any)?.product_name || 'Invalid proposal',
      sku: (rawProposal as any)?.sku || 'unknown',
      quantity: 1,
      price: Math.max(0, Number((rawProposal as any)?.price) || 0),
      currency: 'INR' as const,
      category: (rawProposal as any)?.category || 'unknown',
      delivery_address: '[invalid]',
      quoted_total: 0,
      created_at: new Date().toISOString(),
    };
    const response = result(
      fallback,
      'DENY',
      'INVALID_PROPOSAL',
      'The proposal is incomplete or contains invalid values.',
      [{ rule: 'proposal_schema', passed: false }],
      0,
    );
    return storeResult(prisma, fallback, scenario, response);
  }
  const proposal = parsed.data;
  const checks: Check[] = [{ rule: 'proposal_schema', passed: true }];
  const delegation = await prisma.agentDelegation.findUnique({
    where: { agentId: proposal.agent_id },
  });
  if (!delegation) {
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'AGENT_NOT_FOUND',
        'This buying agent has no registered delegation.',
        checks,
        0,
      ),
    );
  }

  const approved = await prisma.sentinelAuthorization.findMany({
    where: { agentId: proposal.agent_id, verdict: 'APPROVE' },
    select: { amountPaise: true, createdAt: true },
  });
  const spentPaise = approved.reduce((sum, authorization) => sum + authorization.amountPaise, 0);
  const remainingPaise = delegation.totalLimitPaise - spentPaise;

  const priorNonce = await prisma.requestNonce.findUnique({
    where: { requestId: proposal.request_id },
  });
  if (priorNonce) {
    checks.push({ rule: 'request_id_unique', passed: false, actual: proposal.request_id });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'REPLAY_DETECTED',
        'This request ID has already been evaluated. Replayed proposals are never authorized.',
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  await prisma.requestNonce.create({ data: { requestId: proposal.request_id } });
  checks.push({ rule: 'request_id_unique', passed: true });

  if (delegation.expiresAt <= new Date()) {
    checks.push({
      rule: 'delegation_active',
      passed: false,
      actual: delegation.expiresAt.toISOString(),
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'DELEGATION_EXPIRED',
        'This agent delegation has expired.',
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({
    rule: 'delegation_active',
    passed: true,
    limit: delegation.expiresAt.toISOString(),
  });

  const merchants = parseJson<string[]>(delegation.allowedMerchantsJson, []);
  if (!merchants.includes(proposal.merchant)) {
    checks.push({ rule: 'merchant_allowlist', passed: false, actual: proposal.merchant });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'MERCHANT_NOT_ALLOWED',
        `“${proposal.merchant}” is outside this agent’s merchant allowlist.`,
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({ rule: 'merchant_allowlist', passed: true, actual: proposal.merchant });

  const categories = parseJson<string[]>(delegation.allowedCategoriesJson, []);
  const proposalCategories = [
    ...new Set((proposal.items ?? [proposal]).map((item) => item.category)),
  ];
  const blockedCategory = proposalCategories.find((category) => !categories.includes(category));
  if (blockedCategory) {
    checks.push({ rule: 'category_scope', passed: false, actual: blockedCategory });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'CATEGORY_NOT_ALLOWED',
        `The ${blockedCategory.replace(/-/g, ' ')} category is outside this agent’s delegated scope.`,
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({ rule: 'category_scope', passed: true });

  const amountPaise = Math.round(proposal.price * 100);
  if (amountPaise > delegation.perTransactionLimitPaise) {
    checks.push({
      rule: 'per_transaction_limit',
      passed: false,
      actual: proposal.price,
      limit: delegation.perTransactionLimitPaise / 100,
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'PER_TRANSACTION_LIMIT_EXCEEDED',
        `The ₹${proposal.price.toLocaleString('en-IN')} proposal exceeds this agent’s ₹${(delegation.perTransactionLimitPaise / 100).toLocaleString('en-IN')} per-transaction limit.`,
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({
    rule: 'per_transaction_limit',
    passed: true,
    limit: delegation.perTransactionLimitPaise / 100,
  });
  if (amountPaise > remainingPaise) {
    checks.push({
      rule: 'total_spending_limit',
      passed: false,
      actual: proposal.price,
      limit: remainingPaise / 100,
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'BUDGET_EXCEEDED',
        `This proposal exceeds the agent’s remaining ₹${Math.max(0, remainingPaise / 100).toLocaleString('en-IN')} budget.`,
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({ rule: 'total_spending_limit', passed: true, limit: remainingPaise / 100 });

  const items = proposal.items ?? [
    {
      product_name: proposal.product_name,
      sku: proposal.sku,
      quantity: proposal.quantity,
      unit_price: proposal.price / proposal.quantity,
      category: proposal.category,
    },
  ];
  const products = await prisma.product.findMany({
    where: { sku: { in: items.map(({ sku }) => sku) } },
  });
  const bySku = new Map(products.map((product) => [product.sku, product]));
  let canonicalPaise = 0;
  let mismatch: { item: (typeof items)[number]; product?: Product } | undefined;
  for (const item of items) {
    const product = bySku.get(item.sku);
    if (
      !product ||
      product.name !== item.product_name ||
      product.category !== item.category ||
      product.pricePaise !== Math.round(item.unit_price * 100)
    ) {
      mismatch = { item, product };
      break;
    }
    canonicalPaise += product.pricePaise * item.quantity;
  }
  if (
    mismatch ||
    canonicalPaise !== amountPaise ||
    canonicalPaise !== Math.round(proposal.quoted_total * 100)
  ) {
    checks.push({
      rule: 'catalog_price_integrity',
      passed: false,
      actual: proposal.price,
      limit: canonicalPaise / 100,
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'PRICE_MISMATCH',
        'The submitted amount does not match the catalog price shown to the shopper.',
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({ rule: 'catalog_price_integrity', passed: true, actual: canonicalPaise / 100 });

  if (approved.length >= delegation.transactionCountLimit) {
    checks.push({
      rule: 'transaction_count',
      passed: false,
      actual: approved.length,
      limit: delegation.transactionCountLimit,
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'TRANSACTION_COUNT_LIMIT_REACHED',
        'This agent has reached its delegated transaction-count limit.',
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({
    rule: 'transaction_count',
    passed: true,
    actual: approved.length,
    limit: delegation.transactionCountLimit,
  });

  const recentCount = approved.filter(
    ({ createdAt }) => createdAt >= windowStart(delegation.frequencyUnit),
  ).length;
  if (recentCount >= delegation.frequencyCount) {
    checks.push({
      rule: 'frequency_limit',
      passed: false,
      actual: recentCount,
      limit: delegation.frequencyCount,
    });
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'DENY',
        'FREQUENCY_LIMIT_REACHED',
        `This agent has reached its ${delegation.frequencyCount}-per-${delegation.frequencyUnit} frequency limit.`,
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }
  checks.push({
    rule: 'frequency_limit',
    passed: true,
    actual: recentCount,
    limit: delegation.frequencyCount,
  });

  const thresholdReached =
    amountPaise >= delegation.perTransactionLimitPaise * 0.9 ||
    spentPaise + amountPaise >= delegation.totalLimitPaise * 0.9;
  if (thresholdReached) {
    return storeResult(
      prisma,
      proposal,
      scenario,
      result(
        proposal,
        'ESCALATE',
        'ADDITIONAL_CONFIRMATION_REQUIRED',
        'This purchase is valid but sits near the edge of the agent’s delegated budget. Human confirmation is required.',
        checks,
        remainingPaise,
      ),
      delegation,
    );
  }

  return storeResult(
    prisma,
    proposal,
    scenario,
    result(
      proposal,
      'APPROVE',
      'AUTHORIZED',
      'The proposal is within this agent’s merchant, category, timing, and spending limits.',
      checks,
      remainingPaise - amountPaise,
    ),
    delegation,
  );
}
