export type Verdict = 'APPROVE' | 'DENY' | 'ESCALATE';

export type SessionUser = {
  username: string;
  role: 'admin' | 'standard';
  agentId?: string;
};

export type Decision = {
  id: string;
  requestId: string;
  agentId: string;
  agentName: string;
  merchant: string;
  amount: number;
  currency: string;
  verdict: Verdict;
  reason_code: string;
  reason_text: string;
  createdAt: string;
};

export type Check = {
  rule: string;
  passed: boolean;
  reason_code: string;
  reason_text: string;
  actual?: unknown;
  limit?: unknown;
};

export type DecisionDetail = Decision & {
  proposal: Record<string, unknown>;
  checks: Check[];
  risk: Record<string, unknown> | null;
  artifact: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
};

export type Agent = {
  agentId: string;
  name: string;
  status: string;
  expiresAt: string;
  totalLimit: number;
  perTransactionLimit: number;
  spent: number;
  reserved: number;
  transactionCount: number;
  transactionCountLimit: number;
  allowedCategories: string[];
  allowedMerchants: string[];
};

export type AuditEvent = {
  id: string;
  createdAt: string;
  actor: string;
  agentId: string | null;
  eventType: string;
  verdict: Verdict | null;
  context: Record<string, unknown>;
};
