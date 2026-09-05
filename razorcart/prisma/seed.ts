import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SOURCE_URL = 'https://dummyjson.com/products';
const PAGE_SIZE = 100;

type DummyProduct = {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  discountPercentage?: number;
  rating?: number;
  stock?: number;
  brand?: string;
  sku?: string;
  tags?: string[];
  thumbnail?: string;
  images?: string[];
  weight?: number;
  dimensions?: { width?: number; height?: number; depth?: number };
  warrantyInformation?: string;
  shippingInformation?: string;
  availabilityStatus?: string;
  returnPolicy?: string;
  minimumOrderQuantity?: number;
};

type DummyEnvelope = {
  products: DummyProduct[];
  total: number;
  skip: number;
  limit: number;
};

function slugify(value: string, id: number) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${slug || 'product'}-${id}`;
}

function validImage(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

async function fetchPage(skip: number, attempt = 1): Promise<DummyEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${SOURCE_URL}?limit=${PAGE_SIZE}&skip=${skip}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as DummyEnvelope;
    if (!Array.isArray(data.products) || !Number.isFinite(data.total)) {
      throw new Error('Unexpected response envelope');
    }
    return data;
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      return fetchPage(skip, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCatalog() {
  const collected = new Map<number, DummyProduct>();
  let skip = 0;
  let total = Number.POSITIVE_INFINITY;

  while (skip < total) {
    const page = await fetchPage(skip);
    total = page.total;
    for (const product of page.products) collected.set(product.id, product);
    if (page.products.length === 0) break;
    skip += page.products.length;
  }

  return [...collected.values()];
}

async function upsertAgents(categories: string[]) {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);
  const agents = [
    {
      agentId: 'razorcart-buyer-01',
      name: 'General Shopping Bot',
      totalLimitPaise: 5_000_000,
      perTransactionLimitPaise: 5_000_000,
      transactionCountLimit: 20,
      frequencyCount: 8,
      frequencyUnit: 'day',
      allowedCategoriesJson: JSON.stringify(categories),
      allowedMerchantsJson: JSON.stringify(['razorcart-demo-store']),
      expiresAt,
    },
    {
      agentId: 'razorcart-essentials-02',
      name: 'Essentials Runner',
      totalLimitPaise: 200_000,
      perTransactionLimitPaise: 200_000,
      transactionCountLimit: 5,
      frequencyCount: 2,
      frequencyUnit: 'day',
      allowedCategoriesJson: JSON.stringify(['groceries']),
      allowedMerchantsJson: JSON.stringify(['razorcart-demo-store']),
      expiresAt,
    },
    {
      agentId: 'razorcart-review-03',
      name: 'Threshold Review Bot',
      totalLimitPaise: 155_000,
      perTransactionLimitPaise: 155_000,
      transactionCountLimit: 3,
      frequencyCount: 1,
      frequencyUnit: 'day',
      allowedCategoriesJson: JSON.stringify(['laptops']),
      allowedMerchantsJson: JSON.stringify(['razorcart-demo-store']),
      expiresAt,
    },
  ];

  for (const agent of agents) {
    await prisma.agentDelegation.upsert({
      where: { agentId: agent.agentId },
      update: {},
      create: agent,
    });
  }
}

async function main() {
  let remote: DummyProduct[];
  try {
    remote = await fetchCatalog();
  } catch (error) {
    const existing = await prisma.product.count();
    console.warn(
      `[seed] DummyJSON refresh failed; preserving ${existing} existing products.`,
      error instanceof Error ? error.message : error,
    );
    if (existing === 0) {
      console.warn(
        '[seed] Catalog remains empty. Re-run npm run db:seed when the network is available.',
      );
    }
    const categories = await prisma.product.findMany({
      distinct: ['category'],
      select: { category: true },
    });
    await upsertAgents(categories.map(({ category }) => category));
    return;
  }

  const accepted = remote.filter((product) => {
    const image = validImage(product.thumbnail)
      ? product.thumbnail
      : product.images?.find(validImage);
    const valid =
      Number.isInteger(product.id) &&
      product.title?.trim() &&
      product.category?.trim() &&
      Number.isFinite(product.price) &&
      Boolean(image);
    if (!valid) console.warn(`[seed] Skipping invalid or imageless product ${product.id}.`);
    return Boolean(valid);
  });

  await prisma.$transaction(
    accepted.map((product) => {
      const images = [product.thumbnail, ...(product.images ?? [])].filter(validImage);
      const imageUrl = images[0];
      const attributes = {
        weight: product.weight ?? null,
        dimensions: product.dimensions ?? null,
        warrantyInformation: product.warrantyInformation ?? null,
        shippingInformation: product.shippingInformation ?? null,
        availabilityStatus: product.availabilityStatus ?? null,
        returnPolicy: product.returnPolicy ?? null,
        minimumOrderQuantity: product.minimumOrderQuantity ?? null,
      };
      const data = {
        source: 'dummyjson',
        remoteId: product.id,
        name: product.title.trim(),
        slug: slugify(product.title, product.id),
        description: product.description?.trim() || product.title.trim(),
        category: product.category.trim(),
        pricePaise: Math.round(product.price * 100),
        discountPercentage: product.discountPercentage ?? null,
        rating: product.rating ?? 0,
        stock: product.stock ?? 0,
        brand: product.brand?.trim() || null,
        sku: product.sku?.trim() || `DUMMY-${product.id}`,
        imageUrl,
        imagesJson: JSON.stringify([...new Set(images)]),
        tagsJson: JSON.stringify(product.tags ?? []),
        attributesJson: JSON.stringify(attributes),
      };
      return prisma.product.upsert({
        where: { remoteId: product.id },
        update: data,
        create: data,
      });
    }),
  );

  const categories = [...new Set(accepted.map(({ category }) => category))].sort();
  await upsertAgents(categories);
  console.log(
    `[seed] Imported ${accepted.length} products across ${categories.length} categories.`,
  );
}

main()
  .catch((error) => {
    console.error('[seed] Unexpected failure:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
