export type Product = {
  id: string;
  remoteId: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  price: number;
  pricePaise: number;
  discountPercentage: number | null;
  rating: number;
  stock: number;
  brand: string | null;
  sku: string;
  imageUrl: string;
  images: string[];
  tags: string[];
  attributes: Record<string, unknown>;
};

export type Cart = {
  id: string;
  items: Array<{
    id: string;
    quantity: number;
    lineTotal: number;
    product: Product;
  }>;
  itemCount: number;
  total: number;
  updatedAt: string;
};

export type AgentDelegation = {
  id: string;
  agentId: string;
  name: string;
  totalLimit: number;
  perTransactionLimit: number;
  transactionCountLimit: number;
  frequencyCount: number;
  frequencyUnit: 'day' | 'week' | 'month';
  allowedCategories: string[];
  allowedMerchants: string[];
  currency: string;
  expiresAt: string;
  createdAt: string;
  spent?: number;
  approvedTransactions?: number;
  sentinelRegistered?: boolean;
};

export type Recommendation = {
  product: Product;
  relevance: number;
  explanation: string;
};

export type AssistantResponse = {
  message: string;
  intent: {
    category: string | null;
    minPrice: number | null;
    maxPrice: number | null;
    attributes: string[];
    useCase: string;
    sortPreference: string;
    confidence: number;
  };
  results: Recommendation[];
  isFallback: boolean;
  needsClarification: boolean;
  mode: 'groq' | 'local';
};

export type SentinelCheck = {
  rule: string;
  passed: boolean;
  actual?: string | number;
  limit?: string | number;
};

export type SentinelVerdict = {
  authorization_id: string;
  request_id: string;
  agent_id: string;
  verdict: 'APPROVE' | 'DENY' | 'ESCALATE';
  reason_code: string;
  reason: string;
  checks: SentinelCheck[];
  evaluated_amount: number;
  remaining_budget: number;
  authorized_at?: string;
};

export type CheckoutResponse = {
  proposal: Record<string, unknown>;
  originalProposal: Record<string, unknown>;
  scenario: string;
  verdict: SentinelVerdict;
};

export type AuditEvent = {
  id: string;
  kind: 'ai_action' | 'authorization';
  action: string;
  status: string;
  input: string;
  output: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};
