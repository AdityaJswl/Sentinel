import { lineItems, proposalSchema, toPaise, type Check, type Proposal } from './contracts.js';

export type Evidence = {
  delegation: {
    active: boolean;
    expiresAt: Date;
    totalLimitPaise: number;
    perTransactionLimitPaise: number;
    transactionCountLimit: number;
    frequencyCount: number;
    frequencyUnit: string;
    allowedCategories: string[];
    allowedMerchants: string[];
    currency: string;
  };
  usage: { spentPaise: number; reservedPaise: number; transactionCount: number };
  recentApprovalCount: number;
  catalog: Array<{
    sku: string;
    name: string;
    category: string;
    pricePaise: number;
    stock: number;
    description?: string;
  }>;
  now?: Date;
};

export function evaluateHardChecks(proposal: Proposal, evidence: Evidence): Check[] {
  const parsed = proposalSchema.safeParse(proposal);
  if (!parsed.success)
    return [
      {
        rule: 'proposal_schema',
        passed: false,
        reason_code: 'INVALID_PROPOSAL',
        reason_text: 'The purchase proposal does not match the required contract.',
      },
    ];
  const checks: Check[] = [];
  const record = (
    rule: string,
    passed: boolean,
    reason_code: string,
    failure: string,
    actual?: Check['actual'],
    limit?: Check['limit'],
  ) => {
    checks.push({
      rule,
      passed,
      reason_code: passed ? 'PASS' : reason_code,
      reason_text: passed ? `${rule.replaceAll('_', ' ')} verified.` : failure,
      ...(actual !== undefined ? { actual } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
  };
  const { delegation, usage, catalog } = evidence;
  const amount = toPaise(proposal.price);
  const now = evidence.now ?? new Date();
  record(
    'delegation_active',
    delegation.active,
    'AGENT_REVOKED',
    'The agent delegation has been revoked.',
  );
  record(
    'delegation_expiry',
    Number.isFinite(delegation.expiresAt.getTime()) && delegation.expiresAt > now,
    'DELEGATION_EXPIRED',
    'The agent delegation has expired.',
    delegation.expiresAt.toString(),
  );
  record(
    'currency',
    proposal.currency === 'INR' && proposal.currency === delegation.currency,
    'CURRENCY_MISMATCH',
    'The requested currency is outside this delegation.',
    proposal.currency,
    delegation.currency,
  );
  record(
    'per_transaction_limit',
    amount <= delegation.perTransactionLimitPaise,
    'PER_TRANSACTION_LIMIT',
    'The purchase exceeds this agent’s per-transaction limit.',
    amount / 100,
    delegation.perTransactionLimitPaise / 100,
  );
  const remaining = delegation.totalLimitPaise - usage.spentPaise - usage.reservedPaise;
  record(
    'total_spending_limit',
    amount <= remaining,
    'TOTAL_BUDGET_EXCEEDED',
    'The purchase exceeds the remaining budget, including outstanding approvals.',
    amount / 100,
    Math.max(0, remaining) / 100,
  );
  record(
    'transaction_count_limit',
    usage.transactionCount < delegation.transactionCountLimit,
    'TRANSACTION_COUNT_LIMIT',
    'The agent has exhausted its transaction count allowance.',
    usage.transactionCount,
    delegation.transactionCountLimit,
  );
  record(
    'frequency_limit',
    evidence.recentApprovalCount < delegation.frequencyCount,
    'FREQUENCY_LIMIT',
    `The agent has reached its authorization allowance per ${delegation.frequencyUnit}.`,
    evidence.recentApprovalCount,
    delegation.frequencyCount,
  );
  record(
    'merchant_allowlist',
    delegation.allowedMerchants.includes(proposal.merchant),
    'MERCHANT_NOT_ALLOWED',
    'This merchant is not authorized by the agent delegation.',
    proposal.merchant,
    delegation.allowedMerchants.join(', '),
  );
  const items = lineItems(proposal);
  const categories = [...new Set(items.map((item) => item.category))];
  record(
    'category_allowlist',
    categories.every((category) => delegation.allowedCategories.includes(category)),
    'CATEGORY_NOT_ALLOWED',
    'One or more product categories are outside the agent delegation.',
    categories.join(', '),
    delegation.allowedCategories.join(', '),
  );

  const bySku = new Map(catalog.map((product) => [product.sku, product]));
  const quantities = new Map<string, number>();
  let total = 0;
  let identityValid = true;
  let pricesValid = true;
  for (const item of items) {
    const product = bySku.get(item.sku);
    quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
    if (!product) {
      identityValid = false;
      pricesValid = false;
      continue;
    }
    if (product.name !== item.product_name || product.category !== item.category)
      identityValid = false;
    try {
      if (product.pricePaise !== toPaise(item.unit_price)) pricesValid = false;
    } catch {
      pricesValid = false;
    }
    total += product.pricePaise * item.quantity;
  }
  const expectedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const expectedCategory = categories.length === 1 ? categories[0] : 'mixed';
  if (expectedQuantity !== proposal.quantity || expectedCategory !== proposal.category)
    identityValid = false;
  if (
    items.length === 1 &&
    (proposal.sku !== items[0].sku || proposal.product_name !== items[0].product_name)
  )
    identityValid = false;
  if (
    items.length > 1 &&
    (!proposal.sku.startsWith('CART-') ||
      proposal.product_name !== `${items[0].product_name} + ${items.length - 1} more`)
  )
    identityValid = false;
  record(
    'product_identity',
    identityValid,
    'PRODUCT_MISMATCH',
    'Product identity, category, or quantity does not match the trusted catalog and order lines.',
  );
  record(
    'stock_availability',
    [...quantities].every(([sku, quantity]) => {
      const product = bySku.get(sku);
      return product !== undefined && Number.isInteger(product.stock) && product.stock >= quantity;
    }),
    'INSUFFICIENT_STOCK',
    'The requested quantity exceeds trusted stock availability.',
  );
  record(
    'catalog_price_integrity',
    pricesValid &&
      Number.isSafeInteger(total) &&
      total === amount &&
      (proposal.quoted_total === undefined || toPaise(proposal.quoted_total) === total),
    'PRICE_MISMATCH',
    'The submitted amount or line price differs from the trusted catalog price.',
    proposal.price,
    total / 100,
  );
  record(
    'delivery_address',
    proposal.delivery_address.trim().length >= 8,
    'INVALID_DELIVERY_ADDRESS',
    'Provide a usable delivery address before requesting authorization.',
  );
  return checks;
}
