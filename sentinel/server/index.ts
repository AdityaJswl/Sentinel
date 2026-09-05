import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { verifySignature, decryptSecret } from './auth.js';
import { SentinelService } from './service.js';
import { PaymentAdapter } from './razorpay-adapter.js';

const db = new PrismaClient();
const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", config.VITE_SUPABASE_URL],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }),
);
const allowedOrigins = [
  ...config.CONSOLE_ORIGIN.split(','),
  ...config.RAZORCART_ALLOWED_ORIGIN.split(','),
].map((s) => s.trim());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    origin &&
    !allowedOrigins.includes(origin)
  )
    return res
      .status(403)
      .json({ code: 'ORIGIN_REJECTED', message: 'This origin cannot perform mutations.' });
  next();
});
const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res)).catch(next);
  };
const service = new SentinelService(db, {
  master: config.SIGNING_SECRET,
  catalog: async (proposal) => {
    const url = new URL(config.RAZORCART_CATALOG_URL);
    url.searchParams.set(
      'skus',
      (proposal.items?.map((item) => item.sku) ?? [proposal.sku]).join(','),
    );
    const response = await fetch(url, {
      headers: { 'x-catalog-key': config.SENTINEL_CATALOG_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('CATALOG_UNAVAILABLE');
    const schema = z.object({
      products: z
        .array(
          z.object({
            sku: z.string(),
            name: z.string(),
            category: z.string(),
            pricePaise: z.number().int().nonnegative(),
            stock: z.number().int().nonnegative(),
            description: z.string().optional(),
          }),
        )
        .max(100),
    });
    return schema.parse(await response.json()).products;
  },
});
const payments = new PaymentAdapter(db, {
  master: config.SIGNING_SECRET,
  mode: config.PAYMENT_MODE,
  keyId: config.RAZORPAY_KEY_ID,
  keySecret: config.RAZORPAY_KEY_SECRET,
  webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
});

// Raw bytes are required by Razorpay's HMAC validation; register before JSON parsing.
app.post(
  '/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '128kb' }),
  route(async (req, res) => {
    res.json(
      await payments.webhook(
        req.body,
        req.header('x-razorpay-signature'),
        req.header('x-razorpay-event-id'),
      ),
    );
  }),
);
app.use(express.json({ limit: '96kb' }));
app.get('/health', (_req, res) =>
  res.json({
    service: 'sentinel',
    status: 'ok',
    paymentMode: config.PAYMENT_MODE,
    reasoningConfigured: Boolean(process.env.GROQ_API_KEY),
  }),
);

const userSchema = z.object({
  username: z.string(),
  role: z.enum(['admin', 'standard']),
  agentId: z.string().optional(),
});
type User = z.infer<typeof userSchema>;
const equal = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const supabase = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
async function currentUser(req: Request): Promise<User | null> {
  const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const role = data.user.app_metadata.sentinel_role === 'admin' ? 'admin' : 'standard';
  const configuredAgentId = data.user.app_metadata.sentinel_agent_id;
  return userSchema.parse({
    username: data.user.email || data.user.id,
    role,
    agentId:
      role === 'standard'
        ? typeof configuredAgentId === 'string' && configuredAgentId
          ? configuredAgentId
          : data.user.id
        : undefined,
  });
}
async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user)
    return res
      .status(401)
      .json({ code: 'LOGIN_REQUIRED', message: 'Sign in to the Sentinel console.' });
  res.locals.user = user;
  next();
}
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (user?.role !== 'admin')
    return res
      .status(403)
      .json({ code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' });
  res.locals.user = user;
  next();
}
app.get('/api/auth/session', requireUser, (_req, res) => res.json({ user: res.locals.user }));

app.post(
  '/agents/register',
  route(async (req, res) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '') || '';
    const user = equal(token, config.REGISTRATION_API_KEY) ? null : await currentUser(req);
    if (!equal(token, config.REGISTRATION_API_KEY) && user?.role !== 'admin')
      return res.status(403).json({
        code: 'ADMIN_REQUIRED',
        message: 'A trusted registration credential is required.',
      });
    res.status(201).json(await service.register(req.body, user?.username || 'razorcart-admin'));
  }),
);
app.post(
  '/authorize',
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }),
  route(async (req, res) => {
    res.json(
      await service.authorize(
        req.body,
        req.header('x-sentinel-signature'),
        req.header('x-agent-id'),
      ),
    );
  }),
);
app.post(
  '/payments/orders',
  route(async (req, res) => {
    const agentId = req.body?.artifact?.agent_id;
    const agent =
      typeof agentId === 'string' ? await db.agent.findUnique({ where: { id: agentId } }) : null;
    if (
      !agent ||
      req.header('x-agent-id') !== agentId ||
      !verifySignature(
        req.body,
        req.header('x-sentinel-signature') || '',
        decryptSecret(agent.secretEncrypted, config.SIGNING_SECRET),
      )
    )
      return res.status(403).json({
        code: 'INVALID_SIGNATURE',
        message: 'The order request must be signed by its registered agent.',
      });
    res.json(await payments.createOrder(req.body.artifact, req.body.proposal));
  }),
);

function decisionSummary(row: any) {
  return {
    id: row.id,
    requestId: row.requestId,
    agentId: row.agentId,
    agentName: row.agentName,
    merchant: row.merchant,
    amount: row.amountPaise / 100,
    currency: row.currency,
    verdict: row.verdict,
    reason_code: row.reasonCode,
    reason_text: row.reasonText,
    createdAt: row.createdAt,
  };
}
app.get(
  '/api/decisions',
  requireUser,
  route(async (_req, res) => {
    const user = res.locals.user as User;
    const decisions = await db.decision.findMany({
      where: user.role === 'admin' ? {} : { agentId: user.agentId! },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
    res.json({ decisions: decisions.map(decisionSummary) });
  }),
);
app.get(
  '/api/decisions/:id',
  requireUser,
  route(async (req, res) => {
    const user = res.locals.user as User;
    const decision = await db.decision.findUnique({ where: { id: String(req.params.id) } });
    if (!decision || (user.role !== 'admin' && decision.agentId !== user.agentId))
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', message: 'This decision is not available.' });
    const artifact = await db.authorizationArtifact.findUnique({
      where: { decisionId: decision.id },
    });
    res.json({
      decision: {
        ...decisionSummary(decision),
        proposal: JSON.parse(decision.proposalJson),
        checks: JSON.parse(decision.checksJson),
        risk: decision.riskJson ? JSON.parse(decision.riskJson) : null,
        evidence: JSON.parse(decision.evidenceJson),
        artifact: artifact
          ? {
              ...JSON.parse(artifact.payloadJson),
              signature: '[redacted]',
              status: artifact.status,
            }
          : null,
      },
    });
  }),
);
app.get(
  '/api/agents',
  requireUser,
  route(async (_req, res) => {
    const user = res.locals.user as User;
    const agents = await db.agent.findMany({
      where: user.role === 'admin' ? {} : { id: user.agentId! },
      orderBy: { createdAt: 'asc' },
    });
    const list = await Promise.all(
      agents.map(async (agent) => {
        const delegation = await db.delegation.findUniqueOrThrow({ where: { agentId: agent.id } });
        const usage = await db.budgetUsage.findUniqueOrThrow({ where: { agentId: agent.id } });
        return {
          agentId: agent.id,
          name: agent.name,
          status: agent.status,
          expiresAt: delegation.expiresAt,
          totalLimit: delegation.totalLimitPaise / 100,
          perTransactionLimit: delegation.perTransactionLimitPaise / 100,
          spent: usage.spentPaise / 100,
          reserved: usage.reservedPaise / 100,
          transactionCount: usage.transactionCount,
          transactionCountLimit: delegation.transactionCountLimit,
          allowedCategories: JSON.parse(delegation.allowedCategoriesJson),
          allowedMerchants: JSON.parse(delegation.allowedMerchantsJson),
        };
      }),
    );
    res.json({ agents: list });
  }),
);
app.post(
  '/api/agents/:id/revoke',
  requireAdmin,
  route(async (req, res) => {
    res.json(await service.revoke(String(req.params.id), res.locals.user.username));
  }),
);
app.get(
  '/api/audit',
  requireUser,
  route(async (req, res) => {
    const user = res.locals.user as User;
    const filter = z
      .object({
        agentId: z.string().optional(),
        verdict: z.enum(['APPROVE', 'DENY', 'ESCALATE']).optional(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(req.query);
    const events = await db.auditEvent.findMany({
      where: {
        ...(user.role === 'admin'
          ? filter.agentId
            ? { agentId: filter.agentId }
            : {}
          : { agentId: user.agentId! }),
        ...(filter.verdict ? { verdict: filter.verdict } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}),
                ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 250,
    });
    res.json({
      events: events.map(({ contextJson, ...event }) => ({
        ...event,
        context: JSON.parse(contextJson),
      })),
    });
  }),
);

app.use('/api', (_req, res) =>
  res.status(404).json({ code: 'NOT_FOUND', message: 'No such API route.' }),
);
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError)
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Check the submitted fields.',
      issues: error.flatten(),
    });
  const code =
    error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
  res.status(code === 'REQUEST_FAILED' ? 500 : 409).json({
    code,
    message:
      code === 'REQUEST_FAILED'
        ? 'The request could not be completed. No additional authorization was issued.'
        : code.replaceAll('_', ' ').toLowerCase(),
  });
});
if (!process.env.VERCEL) {
  app.listen(config.PORT, '127.0.0.1', () =>
    console.log(`Sentinel API and built console: http://127.0.0.1:${config.PORT}`),
  );
}

export { app };
export default app;
