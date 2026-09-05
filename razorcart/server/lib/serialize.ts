import type { Product } from '@prisma/client';

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function serializeProduct(product: Product) {
  return {
    id: product.id,
    remoteId: product.remoteId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    price: product.pricePaise / 100,
    pricePaise: product.pricePaise,
    discountPercentage: product.discountPercentage,
    rating: product.rating,
    stock: product.stock,
    brand: product.brand,
    sku: product.sku,
    imageUrl: product.imageUrl,
    images: parseJson<string[]>(product.imagesJson, [product.imageUrl]),
    tags: parseJson<string[]>(product.tagsJson, []),
    attributes: parseJson<Record<string, unknown>>(product.attributesJson, {}),
  };
}

export function safeSummary(value: string, max = 240) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}
