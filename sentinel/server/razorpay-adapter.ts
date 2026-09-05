import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { artifactSchema, verifyArtifact, type AuthorizationArtifact } from './artifacts.js';
import { lineItems, proposalSchema } from './contracts.js';
import { sameOrder } from './service.js';
import { appendAudit } from './audit.js';

type PaymentOptions = {
  master: string;
  mode: 'mock' | 'test';
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

// The sole provider boundary. Mock orders never contact Razorpay or move money.
export async function createProviderOrder(
  artifact: AuthorizationArtifact,
  options: PaymentOptions,
) {
  if (options.mode === 'mock') return { id: `mock_order_${randomUUID()}`, status: 'mock_created' };
  if (!options.keyId.startsWith('rzp_test_') || !options.keySecret)
    throw new Error('RAZORPAY_TEST_KEYS_REQUIRED');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({
      amount: Math.round(artifact.max_amount * 100),
      currency: artifact.currency,
      receipt: artifact.approval_id,
      notes: { sentinel_approval_id: artifact.approval_id },
    }),
  });
  if (!response.ok) throw new Error('RAZORPAY_ORDER_FAILED');
  const order = (await response.json()) as { id?: string; amount?: number; currency?: string };
  if (
    !order.id ||
    order.amount !== Math.round(artifact.max_amount * 100) ||
    order.currency !== artifact.currency
  )
    throw new Error('RAZORPAY_ORDER_MISMATCH');
  return { id: order.id, status: 'created' };
}

export class PaymentAdapter {
  constructor(
    readonly db: PrismaClient,
    readonly options: PaymentOptions,
  ) {}
  async createOrder(rawArtifact: unknown, rawProposal: unknown) {
    const verification = verifyArtifact(rawArtifact, this.options.master);
    if (!verification.valid) throw new Error(verification.reason);
    const artifact = artifactSchema.parse(rawArtifact);
    const proposal = proposalSchema.parse(rawProposal);
    const checkout = {
      product_name: proposal.product_name,
      sku: proposal.sku,
      quantity: proposal.quantity,
      category: proposal.category,
      delivery_address: proposal.delivery_address,
      items: lineItems(proposal),
    };
    if (
      proposal.request_id !== artifact.request_id ||
      proposal.agent_id !== artifact.agent_id ||
      proposal.merchant !== artifact.approved_merchant ||
      proposal.price !== artifact.max_amount ||
      proposal.currency !== artifact.currency ||
      !sameOrder(checkout, artifact.approved_order_details)
    )
      throw new Error('CHECKOUT_MISMATCH');
    if (
      this.options.mode === 'test' &&
      (!this.options.keyId.startsWith('rzp_test_') || !this.options.keySecret)
    )
      throw new Error('RAZORPAY_TEST_KEYS_REQUIRED');

    const transaction = await this.db.$transaction(
      async (tx) => {
        const agent = await tx.agent.update({
          where: { id: artifact.agent_id },
          data: { revision: { increment: 1 } },
        });
        const delegation = await tx.delegation.findUniqueOrThrow({
          where: { agentId: artifact.agent_id },
        });
        if (agent.status !== 'active' || delegation.expiresAt <= new Date())
          throw new Error('DELEGATION_INACTIVE');
        const stored = await tx.authorizationArtifact.findUnique({
          where: { approvalId: artifact.approval_id },
        });
        if (!stored || !sameOrder(JSON.parse(stored.payloadJson), artifact))
          throw new Error('ARTIFACT_NOT_ISSUED');
        const claimed = await tx.authorizationArtifact.updateMany({
          where: {
            approvalId: artifact.approval_id,
            status: 'issued',
            expiresAt: { gt: new Date() },
          },
          data: { status: 'consumed', consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('ARTIFACT_ALREADY_USED_OR_EXPIRED');
        const transaction = await tx.transaction.create({
          data: {
            id: randomUUID(),
            approvalId: artifact.approval_id,
            agentId: artifact.agent_id,
            amountPaise: stored.amountPaise,
            currency: artifact.currency,
            merchant: artifact.approved_merchant,
            provider: this.options.mode === 'mock' ? 'mock' : 'razorpay-test',
          },
        });
        await appendAudit(
          tx,
          'artifact_consumed',
          artifact.agent_id,
          { approval_id: artifact.approval_id, transactionId: transaction.id },
          artifact.agent_id,
        );
        return transaction;
      },
      { timeout: 10_000 },
    );
    // Claim commits before external I/O: parallel/repeated calls cannot create a second order.
    try {
      const order = await createProviderOrder(artifact, this.options);
      await this.db.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { providerOrderId: order.id, status: order.status },
        });
        await appendAudit(
          tx,
          'payment_order_created',
          'sentinel',
          { transactionId: transaction.id, orderId: order.id, mode: this.options.mode },
          artifact.agent_id,
        );
      });
      return {
        transaction_id: transaction.id,
        order_id: order.id,
        status: order.status,
        mode: this.options.mode,
        amount: transaction.amountPaise,
        currency: transaction.currency,
      };
    } catch {
      await this.db.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'reconciliation_required' },
        });
        await appendAudit(
          tx,
          'payment_order_uncertain',
          'sentinel',
          {
            transactionId: transaction.id,
            reason:
              'Provider result unavailable; reservation retained and artifact cannot be reused.',
          },
          artifact.agent_id,
          'ESCALATE',
        );
      });
      throw new Error('PAYMENT_RECONCILIATION_REQUIRED');
    }
  }

  async webhook(raw: Buffer, signature: string | undefined, eventId: string | undefined) {
    if (!this.options.webhookSecret || !signature || !/^[a-f0-9]{64}$/i.test(signature))
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    const expected = createHmac('sha256', this.options.webhookSecret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    const event = JSON.parse(raw.toString('utf8'));
    const id =
      eventId || createHmac('sha256', this.options.webhookSecret).update(raw).digest('hex');
    if (event.event !== 'payment.captured' && event.event !== 'payment.failed')
      return { ignored: true };
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id || !payment.id) throw new Error('INVALID_WEBHOOK_PAYLOAD');
    return this.db
      .$transaction(
        async (tx) => {
          // A write serializes receipt and settlement before reading mutable totals.
          await tx.webhookReceipt.create({ data: { eventId: id } });
          const transaction = await tx.transaction.findUnique({
            where: { providerOrderId: payment.order_id },
          });
          if (!transaction || transaction.provider !== 'razorpay-test')
            throw new Error('UNKNOWN_PAYMENT_ORDER');
          if (
            payment.amount !== transaction.amountPaise ||
            payment.currency !== transaction.currency
          )
            throw new Error('PAYMENT_DETAILS_MISMATCH');
          const stored = await tx.authorizationArtifact.findUniqueOrThrow({
            where: { approvalId: transaction.approvalId },
          });
          if (stored.amountPaise !== transaction.amountPaise || stored.status !== 'consumed')
            throw new Error('PAYMENT_ARTIFACT_MISMATCH');
          if (event.event === 'payment.captured') {
            if (payment.status !== 'captured') throw new Error('PAYMENT_STATUS_MISMATCH');
            const changed = await tx.transaction.updateMany({
              where: { id: transaction.id, status: { not: 'paid' } },
              data: { status: 'paid', providerPaymentId: payment.id },
            });
            if (changed.count)
              await tx.budgetUsage.update({
                where: { agentId: transaction.agentId },
                data: {
                  reservedPaise: { decrement: transaction.amountPaise },
                  spentPaise: { increment: transaction.amountPaise },
                },
              });
          }
          // A failed attempt does not release the order reservation: a later retry may succeed.
          await appendAudit(
            tx,
            event.event === 'payment.captured' ? 'payment_settled' : 'payment_attempt_failed',
            'razorpay-webhook',
            {
              transactionId: transaction.id,
              paymentId: payment.id,
              orderId: payment.order_id,
              amount: payment.amount,
            },
            transaction.agentId,
          );
          return { accepted: true };
        },
        { timeout: 10_000 },
      )
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === 'P2002') return { duplicate: true };
        throw error;
      });
  }
}
