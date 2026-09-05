import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { PrismaClient, type Product } from '@prisma/client';
import { z } from 'zod';
import { recommendProducts } from './lib/assistant.js';
import { evaluateProposal, type PurchaseProposal, type Scenario } from './lib/sentinel.js';
import { parseJson, safeSummary, serializeProduct } from './lib/serialize.js';
import {
  authorizeWithSentinel,
  registerWithSentinel,
  secretsMatch,
  SentinelBridgeError,
} from './lib/sentinel-client.js';

const env = z
  .object({
    PORT: z.coerce.number().int().positive().default(3002),
    WEB_ORIGIN: z.string().default('http://127.0.0.1:5174'),
    SENTINEL_URL: z.string().url().optional().or(z.literal('')),
    DEMO_MODE: z.enum(['true', 'false']).default('true'),
  })
  .parse(process.env);

function prepareVercelDatabase() {
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to RazorCart’s Supabase pooler URL in Vercel.');
  }
}

prepareVercelDatabase();

const prisma = new PrismaClient();
const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy:
      process.env.NODE_ENV === 'production'
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              fontSrc: ["'self'", 'data:'],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'"],
            },
          }
        : false,
  }),
);
app.use(cors({ origin: env.WEB_ORIGIN.split(',').map((origin) => origin.trim()) }));
app.use(express.json({ limit: '128kb' }));

const asyncRoute =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

function cartId(value: unknown) {
  return z
    .string()
    .min(8)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(value);
}

async function ensureCart(id: string) {
  return prisma.cartSession.upsert({ where: { id }, update: {}, create: { id } });
}

async function cartPayload(id: string) {
  await ensureCart(id);
  const cart = await prisma.cartSession.findUniqueOrThrow({
    where: { id },
    include: { items: { include: { product: true }, orderBy: { createdAt: 'asc' } } },
  });
  const items = cart.items.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    lineTotal: (item.product.pricePaise * item.quantity) / 100,
    product: serializeProduct(item.product),
  }));
  return {
    id: cart.id,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    updatedAt: cart.updatedAt,
  };
}

function publicAgent(agent: {
  id: string;
  agentId: string;
  name: string;
  totalLimitPaise: number;
  perTransactionLimitPaise: number;
  transactionCountLimit: number;
  frequencyCount: number;
  frequencyUnit: string;
  allowedCategoriesJson: string;
  allowedMerchantsJson: string;
  currency: string;
  expiresAt: Date;
  createdAt: Date;
  sentinelSecretEncrypted?: string | null;
}) {
  return {
    id: agent.id,
    agentId: agent.agentId,
    name: agent.name,
    totalLimit: agent.totalLimitPaise / 100,
    perTransactionLimit: agent.perTransactionLimitPaise / 100,
    transactionCountLimit: agent.transactionCountLimit,
    frequencyCount: agent.frequencyCount,
    frequencyUnit: agent.frequencyUnit,
    allowedCategories: parseJson<string[]>(agent.allowedCategoriesJson, []),
    allowedMerchants: parseJson<string[]>(agent.allowedMerchantsJson, []),
    currency: agent.currency,
    expiresAt: agent.expiresAt,
    createdAt: agent.createdAt,
    sentinelRegistered: Boolean(agent.sentinelSecretEncrypted),
  };
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'razorcart', demoMode: env.DEMO_MODE === 'true' });
});

app.get('/api/admin/config', (_request, response) => {
  response.json({
    sentinelConnected: Boolean(env.SENTINEL_URL),
    requiresAdminKey: Boolean(env.SENTINEL_URL || process.env.RAZORCART_ADMIN_KEY),
  });
});

function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!env.SENTINEL_URL && !process.env.RAZORCART_ADMIN_KEY) return next();
  if (!process.env.RAZORCART_ADMIN_KEY) {
    return response
      .status(503)
      .json({
        code: 'ADMIN_KEY_NOT_CONFIGURED',
        message:
          'The owner must configure RAZORCART_ADMIN_KEY on the server before changing delegations.',
      });
  }
  if (!secretsMatch(request.header('x-admin-key'), process.env.RAZORCART_ADMIN_KEY)) {
    return response
      .status(401)
      .json({
        code: 'ADMIN_AUTH_REQUIRED',
        message: 'Enter the RazorCart owner key to change an agent delegation.',
      });
  }
  next();
}

app.get(
  '/api/catalog/evidence',
  asyncRoute(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!secretsMatch(request.header('x-catalog-key'), process.env.SENTINEL_CATALOG_KEY)) {
      return response.status(401).json({ code: 'CATALOG_AUTH_REQUIRED' });
    }
    const skus = z
      .string()
      .min(1)
      .max(5000)
      .parse(request.query.skus)
      .split(',')
      .map((sku) => sku.trim());
    const requested = z
      .array(z.string().min(1).max(160))
      .min(1)
      .max(20)
      .parse([...new Set(skus)]);
    const products = await prisma.product.findMany({
      where: { sku: { in: requested } },
      select: {
        sku: true,
        name: true,
        category: true,
        pricePaise: true,
        stock: true,
        description: true,
      },
    });
    response.json({ products });
  }),
);

app.get(
  '/api/products',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        category: z.string().optional(),
        search: z.string().max(120).optional(),
        minPrice: z.coerce.number().nonnegative().optional(),
        maxPrice: z.coerce.number().positive().optional(),
        sort: z.enum(['featured', 'price-asc', 'price-desc', 'rating']).default('featured'),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(60).default(24),
      })
      .parse(request.query);
    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { description: { contains: query.search } },
              { brand: { contains: query.search } },
            ],
          }
        : {}),
      ...((query.minPrice || query.maxPrice) && {
        pricePaise: {
          ...(query.minPrice ? { gte: Math.round(query.minPrice * 100) } : {}),
          ...(query.maxPrice ? { lte: Math.round(query.maxPrice * 100) } : {}),
        },
      }),
    };
    const orderBy =
      query.sort === 'price-asc'
        ? { pricePaise: 'asc' as const }
        : query.sort === 'price-desc'
          ? { pricePaise: 'desc' as const }
          : query.sort === 'rating'
            ? { rating: 'desc' as const }
            : [{ rating: 'desc' as const }, { stock: 'desc' as const }];
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.product.count({ where }),
    ]);
    response.json({
      products: products.map(serializeProduct),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    });
  }),
);

app.get(
  '/api/products/:slug',
  asyncRoute(async (request, response) => {
    const product = await prisma.product.findUnique({
      where: { slug: z.string().parse(request.params.slug) },
    });
    if (!product) return response.status(404).json({ code: 'PRODUCT_NOT_FOUND' });
    response.json({ product: serializeProduct(product) });
  }),
);

app.get(
  '/api/categories',
  asyncRoute(async (_request, response) => {
    const rows = await prisma.product.groupBy({
      by: ['category'],
      _count: { category: true },
      orderBy: { category: 'asc' },
    });
    response.json({
      categories: rows.map((row) => ({ slug: row.category, count: row._count.category })),
    });
  }),
);

app.get(
  '/api/cart/:cartId',
  asyncRoute(async (request, response) =>
    response.json({ cart: await cartPayload(cartId(request.params.cartId)) }),
  ),
);

app.post(
  '/api/cart/:cartId/items',
  asyncRoute(async (request, response) => {
    const id = cartId(request.params.cartId);
    const body = z
      .object({
        productId: z.string().cuid(),
        quantity: z.number().int().min(1).max(20).default(1),
      })
      .parse(request.body);
    await ensureCart(id);
    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) return response.status(404).json({ code: 'PRODUCT_NOT_FOUND' });
    const current = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: id, productId: body.productId } },
    });
    const nextQuantity = Math.min(product.stock, (current?.quantity ?? 0) + body.quantity, 20);
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: id, productId: body.productId } },
      update: { quantity: nextQuantity },
      create: {
        cartId: id,
        productId: body.productId,
        quantity: Math.min(body.quantity, product.stock),
      },
    });
    response
      .status(201)
      .json({ cart: await cartPayload(id), message: `${product.name} is in your cart.` });
  }),
);

app.patch(
  '/api/cart/:cartId/items/:productId',
  asyncRoute(async (request, response) => {
    const id = cartId(request.params.cartId);
    const productId = z.string().cuid().parse(request.params.productId);
    const { quantity } = z
      .object({ quantity: z.number().int().min(0).max(20) })
      .parse(request.body);
    if (quantity === 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: id, productId } });
    } else {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      await prisma.cartItem.update({
        where: { cartId_productId: { cartId: id, productId } },
        data: { quantity: Math.min(quantity, product.stock) },
      });
    }
    response.json({ cart: await cartPayload(id) });
  }),
);

app.delete(
  '/api/cart/:cartId/items/:productId',
  asyncRoute(async (request, response) => {
    const id = cartId(request.params.cartId);
    const productId = z.string().cuid().parse(request.params.productId);
    await prisma.cartItem.deleteMany({ where: { cartId: id, productId } });
    response.json({ cart: await cartPayload(id) });
  }),
);

app.post(
  '/api/assistant/recommend',
  asyncRoute(async (request, response) => {
    const { query, history } = z
      .object({
        query: z.string().trim().min(2).max(600),
        history: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().trim().min(1).max(900),
            }),
          )
          .max(8)
          .default([]),
      })
      .parse(request.body);
    response.json(await recommendProducts(prisma, query, history));
  }),
);

app.get(
  '/api/agents',
  asyncRoute(async (_request, response) => {
    const agents = await prisma.agentDelegation.findMany({ orderBy: { createdAt: 'asc' } });
    const approvals = await prisma.sentinelAuthorization.groupBy({
      by: ['agentId'],
      where: { verdict: 'APPROVE' },
      _sum: { amountPaise: true },
      _count: { id: true },
    });
    const usage = new Map(approvals.map((row) => [row.agentId, row]));
    response.json({
      agents: agents.map((agent) => ({
        ...publicAgent(agent),
        spent: (usage.get(agent.agentId)?._sum.amountPaise ?? 0) / 100,
        approvedTransactions: usage.get(agent.agentId)?._count.id ?? 0,
      })),
    });
  }),
);

const agentSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    totalLimit: z.number().positive().max(100_000_000),
    perTransactionLimit: z.number().positive().max(100_000_000),
    transactionCountLimit: z.number().int().positive().max(10_000),
    frequencyCount: z.number().int().positive().max(1_000),
    frequencyUnit: z.enum(['day', 'week', 'month']),
    allowedCategories: z.array(z.string()).min(1),
    allowedMerchants: z.array(z.string()).min(1),
    expiresAt: z.string().datetime(),
  })
  .refine((value) => value.perTransactionLimit <= value.totalLimit, {
    message: 'Per-transaction limit cannot exceed the total limit.',
    path: ['perTransactionLimit'],
  })
  .refine((value) => new Date(value.expiresAt) > new Date(), {
    message: 'Delegation expiry must be in the future.',
    path: ['expiresAt'],
  });

app.post(
  '/api/agents',
  requireAdmin,
  asyncRoute(async (request, response) => {
    const body = agentSchema.parse(request.body);
    const availableCategories = new Set(
      (await prisma.product.findMany({ distinct: ['category'], select: { category: true } })).map(
        ({ category }) => category,
      ),
    );
    if (body.allowedCategories.some((category) => !availableCategories.has(category))) {
      return response
        .status(400)
        .json({ code: 'INVALID_CATEGORY', message: 'Choose categories from the live catalog.' });
    }
    const agentId = `razorcart-${body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 24)}-${crypto.randomUUID().slice(0, 6)}`;
    const sentinelSecretEncrypted = env.SENTINEL_URL
      ? await registerWithSentinel({ ...body, agent_id: agentId, currency: 'INR' })
      : null;
    const agent = await prisma.agentDelegation.create({
      data: {
        agentId,
        sentinelSecretEncrypted,
        name: body.name,
        totalLimitPaise: Math.round(body.totalLimit * 100),
        perTransactionLimitPaise: Math.round(body.perTransactionLimit * 100),
        transactionCountLimit: body.transactionCountLimit,
        frequencyCount: body.frequencyCount,
        frequencyUnit: body.frequencyUnit,
        allowedCategoriesJson: JSON.stringify([...new Set(body.allowedCategories)]),
        allowedMerchantsJson: JSON.stringify([...new Set(body.allowedMerchants)]),
        expiresAt: new Date(body.expiresAt),
      },
    });
    response.status(201).json({ agent: publicAgent(agent) });
  }),
);

app.patch(
  '/api/agents/:agentId',
  requireAdmin,
  asyncRoute(async (request, response) => {
    const agentId = z.string().min(3).max(100).parse(request.params.agentId);
    const body = agentSchema.parse(request.body);
    const agent = await prisma.agentDelegation.findUnique({ where: { agentId } });
    if (!agent) return response.status(404).json({ code: 'AGENT_NOT_FOUND' });
    const catalogCategories = new Set(
      (await prisma.product.findMany({ distinct: ['category'], select: { category: true } })).map(
        ({ category }) => category,
      ),
    );
    if (body.allowedCategories.some((category) => !catalogCategories.has(category))) {
      return response
        .status(400)
        .json({ code: 'INVALID_CATEGORY', message: 'Choose categories from the live catalog.' });
    }
    const sentinelSecretEncrypted = env.SENTINEL_URL
      ? await registerWithSentinel(
          { ...body, agent_id: agentId, currency: 'INR' },
          agent.sentinelSecretEncrypted,
        )
      : agent.sentinelSecretEncrypted;
    const updated = await prisma.agentDelegation.update({
      where: { agentId },
      data: {
        name: body.name,
        totalLimitPaise: Math.round(body.totalLimit * 100),
        perTransactionLimitPaise: Math.round(body.perTransactionLimit * 100),
        transactionCountLimit: body.transactionCountLimit,
        frequencyCount: body.frequencyCount,
        frequencyUnit: body.frequencyUnit,
        allowedCategoriesJson: JSON.stringify([...new Set(body.allowedCategories)]),
        allowedMerchantsJson: JSON.stringify([...new Set(body.allowedMerchants)]),
        expiresAt: new Date(body.expiresAt),
        sentinelSecretEncrypted,
      },
    });
    response.json({ agent: publicAgent(updated) });
  }),
);

app.post(
  '/api/mock-sentinel/authorize',
  asyncRoute(async (request, response) => {
    if (env.SENTINEL_URL) return response.status(404).json({ code: 'MOCK_SENTINEL_DISABLED' });
    const scenario = z
      .enum(['normal', 'price_tampering', 'replay', 'budget_breach', 'merchant_mismatch'])
      .catch('normal')
      .parse(request.header('x-demo-scenario'));
    const verdict = await evaluateProposal(prisma, request.body, scenario);
    response.json(verdict);
  }),
);

async function authorize(proposal: PurchaseProposal, scenario: Scenario) {
  if (!env.SENTINEL_URL) return evaluateProposal(prisma, proposal, scenario);
  return authorizeWithSentinel(prisma, proposal, scenario);
}

const checkoutSchema = z.object({
  cartId: z.string().min(8).max(80),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(20),
  agentId: z.string().min(3),
  deliveryAddress: z.string().trim().min(12).max(300),
  scenario: z
    .enum(['normal', 'price_tampering', 'replay', 'budget_breach', 'merchant_mismatch'])
    .default('normal'),
});

app.post(
  '/api/checkout/authorize',
  asyncRoute(async (request, response) => {
    const body = checkoutSchema.parse(request.body);
    if (env.DEMO_MODE !== 'true' && body.scenario !== 'normal') {
      return response.status(403).json({ code: 'DEMO_MODE_DISABLED' });
    }
    const cart = await prisma.cartSession.findUnique({
      where: { id: body.cartId },
      include: { items: { include: { product: true } } },
    });
    let resolvedItems: Array<{ product: Product; quantity: number }> = (cart?.items ?? []).map(
      (item) => ({ product: item.product, quantity: item.quantity }),
    );
    if (resolvedItems.length === 0) {
      const requested = new Map<string, number>();
      for (const item of body.items) {
        requested.set(item.productId, (requested.get(item.productId) ?? 0) + item.quantity);
      }
      const products = await prisma.product.findMany({
        where: { id: { in: [...requested.keys()] }, stock: { gt: 0 } },
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      if (byId.size === requested.size) {
        resolvedItems = [...requested].map(([productId, quantity]) => ({
          product: byId.get(productId)!,
          quantity,
        }));
      }
    }
    if (resolvedItems.length === 0)
      return response.status(400).json({
        code: 'CART_EMPTY',
        message: 'Add an available item before requesting authorization.',
      });
    const delegation = await prisma.agentDelegation.findUnique({
      where: { agentId: body.agentId },
    });
    if (!delegation) return response.status(404).json({ code: 'AGENT_NOT_FOUND' });

    const items = resolvedItems.map((item) => ({
      product_name: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity,
      unit_price: item.product.pricePaise / 100,
      category: item.product.category,
    }));
    const total =
      resolvedItems.reduce((sum, item) => sum + item.product.pricePaise * item.quantity, 0) / 100;
    const primary = resolvedItems[0];
    const originalProposal: PurchaseProposal = {
      request_id: `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 13)}`,
      agent_id: body.agentId,
      merchant: 'razorcart-demo-store',
      product_name:
        resolvedItems.length === 1
          ? primary.product.name
          : `${primary.product.name} + ${resolvedItems.length - 1} more`,
      sku:
        resolvedItems.length === 1
          ? primary.product.sku
          : `CART-${body.cartId.slice(0, 12).toUpperCase()}`,
      quantity: resolvedItems.reduce((sum, item) => sum + item.quantity, 0),
      price: total,
      currency: 'INR',
      category: resolvedItems.every((item) => item.product.category === primary.product.category)
        ? primary.product.category
        : 'mixed',
      delivery_address: body.deliveryAddress,
      quoted_total: total,
      created_at: new Date().toISOString(),
      items,
    };
    const sentProposal: PurchaseProposal = structuredClone(originalProposal);
    if (body.scenario === 'price_tampering') sentProposal.price = Number((total + 1).toFixed(2));
    if (body.scenario === 'budget_breach') {
      sentProposal.price =
        Math.max(delegation.perTransactionLimitPaise, delegation.totalLimitPaise) / 100 + 1;
    }
    if (body.scenario === 'merchant_mismatch') sentProposal.merchant = 'untrusted-demo-merchant';
    if (body.scenario === 'replay') {
      const previous = await prisma.sentinelAuthorization.findFirst({
        where: { agentId: body.agentId },
        orderBy: { createdAt: 'desc' },
      });
      if (previous) {
        sentProposal.request_id = previous.requestId;
      } else {
        await authorize(originalProposal, 'normal');
        sentProposal.request_id = originalProposal.request_id;
      }
    }

    await prisma.aiAction.create({
      data: {
        actionType: 'purchase_proposal_generated',
        inputSummary: safeSummary(
          `Cart ${body.cartId}; agent ${body.agentId}; ${resolvedItems.length} line item(s)`,
        ),
        outputSummary: safeSummary(
          `Request ${sentProposal.request_id}; ₹${sentProposal.price}; scenario ${body.scenario}`,
        ),
        metadataJson: JSON.stringify({ scenario: body.scenario, address: '[redacted]' }),
      },
    });
    const verdict = await authorize(sentProposal, body.scenario);
    response.json({
      proposal: { ...sentProposal, delivery_address: '[redacted in response]' },
      originalProposal: { ...originalProposal, delivery_address: '[redacted in response]' },
      scenario: body.scenario,
      verdict,
    });
  }),
);

app.get(
  '/api/audit',
  asyncRoute(async (request, response) => {
    const query = z
      .object({
        type: z.enum(['all', 'ai', 'authorization']).default('all'),
        limit: z.coerce.number().int().positive().max(200).default(100),
      })
      .parse(request.query);
    const [aiActions, authorizations] = await Promise.all([
      query.type === 'authorization'
        ? Promise.resolve([])
        : prisma.aiAction.findMany({ orderBy: { createdAt: 'desc' }, take: query.limit }),
      query.type === 'ai'
        ? Promise.resolve([])
        : prisma.sentinelAuthorization.findMany({
            orderBy: { createdAt: 'desc' },
            take: query.limit,
          }),
    ]);
    const events = [
      ...aiActions.map((action) => ({
        id: action.id,
        kind: 'ai_action' as const,
        action: action.actionType,
        status: 'RECORDED',
        input: action.inputSummary,
        output: action.outputSummary,
        metadata: action.metadataJson ? parseJson(action.metadataJson, {}) : null,
        createdAt: action.createdAt,
      })),
      ...authorizations.map((authorization) => ({
        id: authorization.id,
        kind: 'authorization' as const,
        action: 'sentinel_authorization',
        status: authorization.verdict,
        input: `Request ${authorization.requestId} · ${authorization.agentId} · ₹${authorization.amountPaise / 100}`,
        output: `${authorization.reasonCode}: ${authorization.reasonMessage}`,
        metadata: {
          authorizationId: authorization.authorizationId,
          scenario: authorization.scenario,
          checks: parseJson(authorization.checksJson, []),
        },
        createdAt: authorization.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, query.limit);
    response.json({ events });
  }),
);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(dirname, '../dist');
app.use(express.static(dist));
app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) return next();
  response.sendFile(path.join(dist, 'index.html'));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof SentinelBridgeError) {
    return response.status(error.status).json({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return response.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted values.',
      issues: error.issues,
    });
  }
  if ((error as { code?: string })?.code === 'P2025') {
    return response.status(404).json({ code: 'NOT_FOUND' });
  }
  console.error(error);
  response.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'RazorCart could not complete that request.',
    requestId: crypto.randomUUID(),
  });
});

if (!process.env.VERCEL) {
  app.listen(env.PORT, '127.0.0.1', () => {
    console.log(`RazorCart API ready at http://127.0.0.1:${env.PORT}`);
  });
}

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

if (!process.env.VERCEL) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
