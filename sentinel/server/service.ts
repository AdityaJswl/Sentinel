import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canonical, decryptSecret, encryptSecret, verifySignature } from './auth.js';
import { makeArtifact } from './artifacts.js';
import { proposalSchema, type Proposal, type Check } from './contracts.js';
import { evaluateHardChecks, type Evidence } from './limits.js';
import { assessRisk, runLayers, type RiskResult } from './reasoning.js';
import { appendAudit } from './audit.js';

export const registrationSchema = z
  .object({
    agent_id: z.string().regex(/^[a-zA-Z0-9_-]{3,100}$/),
    name: z.string().trim().min(3).max(100),
    totalLimit: z.number().positive().max(20_000_000),
    perTransactionLimit: z.number().positive().max(20_000_000),
    transactionCountLimit: z.number().int().positive().max(100_000),
    frequencyCount: z.number().int().positive().max(10_000),
    frequencyUnit: z.enum(['day', 'week', 'month']),
    allowedCategories: z.array(z.string().min(1).max(100)).min(1).max(100),
    allowedMerchants: z.array(z.string().min(1).max(100)).min(1).max(100),
    expiresAt: z.string().datetime(),
    currency: z.literal('INR').default('INR'),
  })
  .refine((v) => v.perTransactionLimit <= v.totalLimit, 'Per-transaction cap exceeds total limit.')
  .refine((v) => new Date(v.expiresAt).getTime() > Date.now(), 'Expiry must be in the future.');

export type CatalogProduct = Evidence['catalog'][number];
type Options = {
  master: string;
  catalog: (proposal: Proposal) => Promise<CatalogProduct[]>;
  reason?: (proposal: Proposal, context: { history: any[]; catalog: any[] }) => Promise<RiskResult>;
};
const failed = (rule: string, code: string, text: string): Check => ({
  rule,
  passed: false,
  reason_code: code,
  reason_text: text,
});
const passed = (rule: string): Check => ({
  rule,
  passed: true,
  reason_code: 'PASSED',
  reason_text: `${rule} verified.`,
});

export class SentinelService {
  constructor(
    readonly db: PrismaClient,
    readonly options: Options,
  ) {}

  async register(input: unknown, actor: string) {
    const body = registrationSchema.parse(input);
    return this.db.$transaction(
      async (tx) => {
        // Serialize creation even when no agent row exists yet. Row locking also
        // coordinates policy edits with authorization and revocation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${body.agent_id}, 0))`;
        await tx.$queryRaw`SELECT "id" FROM "agents" WHERE "id" = ${body.agent_id} FOR UPDATE`;
        const existing = await tx.agent.findUnique({ where: { id: body.agent_id } });
        const secret = existing ? undefined : randomBytes(32).toString('hex');
        if (existing?.status === 'revoked')
          throw new Error('AGENT_REVOKED: create a new delegation after revocation.');
        await tx.agent.upsert({
          where: { id: body.agent_id },
          create: {
            id: body.agent_id,
            name: body.name,
            secretEncrypted:
              existing?.secretEncrypted ?? encryptSecret(secret!, this.options.master),
          },
          update: { name: body.name, revision: { increment: 1 } },
        });
        const data = {
          totalLimitPaise: Math.round(body.totalLimit * 100),
          perTransactionLimitPaise: Math.round(body.perTransactionLimit * 100),
          transactionCountLimit: body.transactionCountLimit,
          frequencyCount: body.frequencyCount,
          frequencyUnit: body.frequencyUnit,
          allowedCategoriesJson: JSON.stringify(body.allowedCategories),
          allowedMerchantsJson: JSON.stringify(body.allowedMerchants),
          expiresAt: new Date(body.expiresAt),
          currency: body.currency,
        };
        const prior = await tx.delegation.findUnique({ where: { agentId: body.agent_id } });
        const policyChanged =
          prior &&
          Object.entries(data).some(([key, value]) =>
            value instanceof Date
              ? value.getTime() !== prior.expiresAt.getTime()
              : (prior as any)[key] !== value,
          );
        await tx.delegation.upsert({
          where: { agentId: body.agent_id },
          create: { agentId: body.agent_id, ...data },
          update: data,
        });
        await tx.budgetUsage.upsert({
          where: { agentId: body.agent_id },
          create: { agentId: body.agent_id },
          update: {},
        });
        if (policyChanged) {
          const issued = await tx.authorizationArtifact.findMany({
            where: { agentId: body.agent_id, status: 'issued' },
          });
          await tx.authorizationArtifact.updateMany({
            where: { agentId: body.agent_id, status: 'issued' },
            data: { status: 'revoked' },
          });
          await tx.budgetUsage.update({
            where: { agentId: body.agent_id },
            data: {
              reservedPaise: { decrement: issued.reduce((sum, a) => sum + a.amountPaise, 0) },
            },
          });
          await appendAudit(
            tx,
            'approval_scope_invalidated',
            actor,
            { invalidatedArtifacts: issued.length },
            body.agent_id,
          );
        }
        await appendAudit(
          tx,
          existing ? 'delegation_updated' : 'agent_registered',
          actor,
          body,
          body.agent_id,
        );
        return {
          agent_id: body.agent_id,
          ...(secret ? { signing_secret: secret } : {}),
          updated: Boolean(existing),
        };
      },
      { timeout: 10_000 },
    );
  }

  // Lock the owning agent row before reading mutable policy and budget state.
  // This serializes authorization attempts for one agent across serverless
  // instances; the final approval transaction repeats every hard check after
  // asynchronous risk reasoning.
  async evidence(
    tx: Prisma.TransactionClient,
    proposal: Proposal,
    catalog: CatalogProduct[],
  ): Promise<Evidence> {
    await tx.$queryRaw`SELECT "id" FROM "agents" WHERE "id" = ${proposal.agent_id} FOR UPDATE`;
    const agent = await tx.agent.update({
      where: { id: proposal.agent_id },
      data: { revision: { increment: 1 } },
    });
    await this.releaseExpired(tx, proposal.agent_id);
    const delegation = await tx.delegation.findUniqueOrThrow({
      where: { agentId: proposal.agent_id },
    });
    const usage = await tx.budgetUsage.findUniqueOrThrow({ where: { agentId: proposal.agent_id } });
    const days =
      delegation.frequencyUnit === 'day' ? 1 : delegation.frequencyUnit === 'week' ? 7 : 30;
    const recentApprovalCount = await tx.approval.count({
      where: {
        agentId: proposal.agent_id,
        createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
      },
    });
    return {
      delegation: {
        active: agent.status === 'active',
        expiresAt: delegation.expiresAt,
        totalLimitPaise: delegation.totalLimitPaise,
        perTransactionLimitPaise: delegation.perTransactionLimitPaise,
        transactionCountLimit: delegation.transactionCountLimit,
        frequencyCount: delegation.frequencyCount,
        frequencyUnit: delegation.frequencyUnit as 'day' | 'week' | 'month',
        allowedCategories: JSON.parse(delegation.allowedCategoriesJson),
        allowedMerchants: JSON.parse(delegation.allowedMerchantsJson),
        currency: delegation.currency,
      },
      usage: {
        spentPaise: usage.spentPaise,
        reservedPaise: usage.reservedPaise,
        transactionCount: usage.transactionCount,
      },
      recentApprovalCount,
      catalog,
    };
  }

  async releaseExpired(tx: Prisma.TransactionClient, agentId: string) {
    const expired = await tx.authorizationArtifact.findMany({
      where: { agentId, status: 'issued', expiresAt: { lte: new Date() } },
    });
    for (const artifact of expired) {
      const changed = await tx.authorizationArtifact.updateMany({
        where: { approvalId: artifact.approvalId, status: 'issued' },
        data: { status: 'expired' },
      });
      if (changed.count) {
        await tx.budgetUsage.update({
          where: { agentId },
          data: { reservedPaise: { decrement: artifact.amountPaise } },
        });
        await appendAudit(
          tx,
          'artifact_expired',
          'sentinel',
          { approval_id: artifact.approvalId },
          agentId,
        );
      }
    }
  }

  async record(
    tx: Prisma.TransactionClient,
    raw: any,
    checks: Check[],
    risk: RiskResult | null,
    evidence: unknown = {},
  ) {
    const failure = checks.find((check) => !check.passed);
    const identityVerified = checks.some((check) => check.rule === 'signature' && check.passed);
    const verdict = failure ? 'DENY' : (risk?.verdict ?? 'ESCALATE');
    const reasonCode = failure?.reason_code ?? risk?.reason_code ?? 'EVIDENCE_UNAVAILABLE';
    const reasonText =
      failure?.reason_text ?? risk?.reason_text ?? 'Additional verification is required.';
    const agentId = String(raw.agent_id || 'unknown').slice(0, 100);
    const agent = await tx.agent.findUnique({ where: { id: agentId } });
    const amountPaise = Number.isFinite(raw.price)
      ? Math.max(0, Math.min(2_000_000_000, Math.round(raw.price * 100)))
      : 0;
    const decision = await tx.decision.create({
      data: {
        id: randomUUID(),
        requestId: String(raw.request_id || 'unknown').slice(0, 120),
        agentId,
        agentName: identityVerified ? agent?.name || agentId : `${agentId} (unverified)`,
        merchant: String(raw.merchant || 'unknown').slice(0, 100),
        amountPaise,
        currency: String(raw.currency || 'INR').slice(0, 10),
        verdict,
        reasonCode,
        reasonText,
        proposalJson: JSON.stringify(raw),
        checksJson: JSON.stringify(checks),
        riskJson: risk ? JSON.stringify(risk) : null,
        evidenceJson: JSON.stringify(evidence),
      },
    });
    for (const check of checks)
      await appendAudit(
        tx,
        'hard_check',
        'sentinel',
        check,
        agentId,
        check.passed ? undefined : 'DENY',
      );
    if (risk) await appendAudit(tx, 'risk_reasoned', 'sentinel', risk, agentId, risk.verdict);
    let artifact: ReturnType<typeof makeArtifact> | undefined;
    if (verdict === 'APPROVE') {
      const approvalId = randomUUID();
      artifact = makeArtifact(raw as Proposal, approvalId, this.options.master);
      await tx.approval.create({
        data: { id: approvalId, decisionId: decision.id, agentId, amountPaise },
      });
      await tx.authorizationArtifact.create({
        data: {
          approvalId,
          decisionId: decision.id,
          agentId,
          nonce: artifact.nonce,
          payloadJson: JSON.stringify(artifact),
          amountPaise,
          expiresAt: new Date(artifact.expiry_time),
        },
      });
      await tx.budgetUsage.update({
        where: { agentId },
        data: { reservedPaise: { increment: amountPaise }, transactionCount: { increment: 1 } },
      });
      await appendAudit(
        tx,
        'artifact_issued',
        'sentinel',
        { approval_id: approvalId, expiry_time: artifact.expiry_time, amount: raw.price },
        agentId,
        verdict,
      );
    } else if (verdict === 'DENY') {
      await tx.denial.create({ data: { decisionId: decision.id, agentId, reasonCode } });
    }
    await appendAudit(
      tx,
      'authorization_decided',
      'sentinel',
      { decisionId: decision.id, request_id: raw.request_id, reasonCode, reasonText },
      agentId,
      verdict,
    );
    const usage = await tx.budgetUsage.findUnique({ where: { agentId } });
    const delegation = await tx.delegation.findUnique({ where: { agentId } });
    return {
      authorization_id: decision.id,
      request_id: decision.requestId,
      agent_id: agentId,
      verdict,
      reason_code: reasonCode,
      reason_text: reasonText,
      reason: reasonText,
      checks,
      evaluated_amount: amountPaise / 100,
      remaining_budget: identityVerified
        ? Math.max(
            0,
            (delegation?.totalLimitPaise ?? 0) -
              (usage?.spentPaise ?? 0) -
              (usage?.reservedPaise ?? 0),
          ) / 100
        : 0,
      ...(artifact ? { artifact } : {}),
      risk,
      authorized_at: decision.createdAt.toISOString(),
    };
  }

  async authorize(raw: any, signature?: string, headerAgent?: string) {
    const agentId = typeof raw?.agent_id === 'string' ? raw.agent_id : '';
    const agent = agentId ? await this.db.agent.findUnique({ where: { id: agentId } }) : null;
    // Identity gate precedes nonce, catalog evidence, and all Groq calls.
    if (
      !agent ||
      headerAgent !== agentId ||
      !signature ||
      !verifySignature(raw, signature, decryptSecret(agent.secretEncrypted, this.options.master))
    ) {
      return this.db.$transaction((tx) =>
        this.record(
          tx,
          raw ?? {},
          [
            failed(
              'signature',
              'INVALID_SIGNATURE',
              'Registered agent identity and a valid request signature are required.',
            ),
          ],
          null,
        ),
      );
    }
    const parsed = proposalSchema.safeParse(raw);
    if (!parsed.success)
      return this.db.$transaction((tx) =>
        this.record(
          tx,
          raw,
          [
            passed('signature'),
            failed(
              'proposal_schema',
              'INVALID_PROPOSAL',
              'The proposal fields are incomplete or invalid.',
            ),
          ],
          null,
        ),
      );
    const proposal = parsed.data;
    const replay = await this.db.$transaction(
      async (tx) => {
        await tx.agent.update({ where: { id: agentId }, data: { revision: { increment: 1 } } });
        // ON CONFLICT keeps the transaction usable when different agents submit
        // the same global request ID concurrently.
        const claimed = await tx.nonce.createMany({
          data: [{ requestId: proposal.request_id, agentId }],
          skipDuplicates: true,
        });
        if (claimed.count === 0)
          return this.record(
            tx,
            proposal,
            [
              passed('signature'),
              failed('nonce', 'REPLAY_DETECTED', 'This request_id has already been used.'),
            ],
            null,
          );
        await appendAudit(tx, 'authorization_attempt', agentId, { proposal }, agentId);
        return null;
      },
      { timeout: 10_000 },
    );
    if (replay) return replay;
    const coreRejection = await this.db.$transaction(
      async (tx) => {
        const evidence = await this.evidence(tx, proposal, []);
        const catalogRules = new Set([
          'product_identity',
          'stock_availability',
          'catalog_price_integrity',
        ]);
        const checks = [
          passed('signature'),
          passed('nonce'),
          ...evaluateHardChecks(proposal, evidence).filter(
            (check) => !catalogRules.has(check.rule),
          ),
        ];
        return checks.some((check) => !check.passed)
          ? this.record(tx, proposal, checks, null, evidence)
          : null;
      },
      { timeout: 10_000 },
    );
    if (coreRejection) return coreRejection;
    let catalog: CatalogProduct[];
    try {
      catalog = await this.options.catalog(proposal);
    } catch {
      return this.db.$transaction((tx) =>
        this.record(tx, proposal, [passed('signature'), passed('nonce')], {
          verdict: 'ESCALATE',
          reason_code: 'CATALOG_UNAVAILABLE',
          reason_text:
            'The independent merchant catalog could not be verified. No approval has been issued.',
          signals: ['catalog_unavailable'],
          mode: 'unavailable',
        }),
      );
    }
    const initial = await this.db.$transaction(
      async (tx) => {
        const evidence = await this.evidence(tx, proposal, catalog);
        const checks = [
          passed('signature'),
          passed('nonce'),
          ...evaluateHardChecks(proposal, evidence),
        ];
        return {
          evidence,
          checks,
          rejection: checks.some((c) => !c.passed)
            ? await this.record(tx, proposal, checks, null, evidence)
            : null,
        };
      },
      { timeout: 10_000 },
    );
    if (initial.rejection) return initial.rejection;
    const history = await this.db.decision.findMany({
      where: { agentId, reasonCode: { not: 'INVALID_SIGNATURE' } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        verdict: true,
        reasonCode: true,
        amountPaise: true,
        merchant: true,
        createdAt: true,
      },
    });
    const risk = await runLayers(initial.checks, () =>
      (this.options.reason ?? assessRisk)(proposal, { history, catalog }),
    );
    return this.db.$transaction(
      async (tx) => {
        // Re-check after Groq: concurrent approvals, revocation, expiry, and policy
        // changes cannot exploit the time spent reasoning outside the transaction.
        const evidence = await this.evidence(tx, proposal, catalog);
        const checks = [
          passed('signature'),
          passed('nonce'),
          ...evaluateHardChecks(proposal, evidence),
        ];
        return this.record(tx, proposal, checks, risk, { ...evidence, history });
      },
      { timeout: 10_000 },
    );
  }

  async revoke(agentId: string, actor: string) {
    return this.db.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: { status: 'revoked', revision: { increment: 1 } },
      });
      const issued = await tx.authorizationArtifact.findMany({
        where: { agentId, status: 'issued' },
      });
      await tx.authorizationArtifact.updateMany({
        where: { agentId, status: 'issued' },
        data: { status: 'revoked' },
      });
      await tx.budgetUsage.update({
        where: { agentId },
        data: { reservedPaise: { decrement: issued.reduce((sum, a) => sum + a.amountPaise, 0) } },
      });
      await appendAudit(
        tx,
        'agent_revoked',
        actor,
        { invalidatedArtifacts: issued.length },
        agentId,
      );
      return { ok: true };
    });
  }
}

export function sameOrder(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
