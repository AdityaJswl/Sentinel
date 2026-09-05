import Groq from 'groq-sdk';
import type { PrismaClient, Product } from '@prisma/client';
import { z } from 'zod';
import { parseJson, safeSummary, serializeProduct } from './serialize.js';

const intentSchema = z.object({
  category: z.string().nullable().default(null),
  minPrice: z.number().nonnegative().nullable().default(null),
  maxPrice: z.number().positive().nullable().default(null),
  attributes: z.array(z.string()).default([]),
  useCase: z.string().default(''),
  sortPreference: z.enum(['relevance', 'price_low', 'rating']).default('relevance'),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ShoppingIntent = z.infer<typeof intentSchema>;
export type ConversationMessage = { role: 'user' | 'assistant'; content: string };

const turnSchema = z.object({
  action: z.enum(['recommend', 'clarify', 'converse']),
  reply: z.string().trim().min(1).max(700),
  intent: intentSchema,
});

const replySchema = z.object({ reply: z.string().trim().min(1).max(700) });

const rankSchema = z.object({
  ranking: z.array(
    z.object({
      id: z.string(),
      relevance: z.number().min(0).max(100),
      factKeys: z.array(
        z.enum(['price', 'brand', 'rating', 'stock', 'warranty', 'shipping', 'tags']),
      ),
    }),
  ),
});

function parseNumericAmount(input: string) {
  const normalized = input.toLowerCase().replace(/,/g, '');
  const match = normalized.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lakh|lac|k|thousand)?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === 'lakh' || match[2] === 'lac') return base * 100_000;
  if (match[2] === 'k' || match[2] === 'thousand') return base * 1_000;
  return base;
}

function heuristicIntent(
  query: string,
  categories: string[],
  history: ConversationMessage[] = [],
): ShoppingIntent {
  const priorUserMessages = history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' ');
  const lower = `${priorUserMessages} ${query}`.toLowerCase();
  const category =
    categories.find((candidate) => {
      const singular = candidate.replace(/s$/, '');
      return (
        lower.includes(candidate.replace(/-/g, ' ')) || lower.includes(singular.replace(/-/g, ' '))
      );
    }) ??
    (
      {
        phone: 'smartphones',
        mobile: 'smartphones',
        laptop: 'laptops',
        tablet: 'tablets',
        perfume: 'fragrances',
        chair: 'furniture',
        sofa: 'furniture',
        watch: lower.includes('women') ? 'womens-watches' : 'mens-watches',
        shoe: lower.includes('women') ? 'womens-shoes' : 'mens-shoes',
        grocery: 'groceries',
      } as Record<string, string>
    )[
      Object.keys({
        phone: 1,
        mobile: 1,
        laptop: 1,
        tablet: 1,
        perfume: 1,
        chair: 1,
        sofa: 1,
        watch: 1,
        shoe: 1,
        grocery: 1,
      }).find((key) => lower.includes(key)) ?? ''
    ];
  const amount = parseNumericAmount(query);
  const hasUpperBound = /under|below|less than|up to|budget|max(?:imum)?|within/i.test(query);
  const hasLowerBound = /over|above|more than|at least|min(?:imum)?/i.test(query);
  return {
    category: category ?? null,
    minPrice: hasLowerBound ? amount : null,
    maxPrice: hasUpperBound ? amount : null,
    attributes: [
      'lightweight',
      'fast',
      'durable',
      'gift',
      'work',
      'travel',
      'gaming',
      'quiet',
      'compact',
    ].filter((attribute) => lower.includes(attribute)),
    useCase: safeSummary(priorUserMessages ? `${priorUserMessages} ${query}` : query, 120),
    sortPreference: /cheapest|lowest price|affordable/i.test(query)
      ? 'price_low'
      : /best rated|rating/i.test(query)
        ? 'rating'
        : 'relevance',
    confidence: category ? 0.76 : 0.52,
  };
}

function groqClient() {
  return process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
}

function fallbackAction(intent: ShoppingIntent, query: string) {
  const lower = query.toLowerCase().trim();
  if (/^(thanks|thank you|thx|okay|ok|great|got it)[!. ]*$/i.test(lower)) return 'converse' as const;
  if (!intent.category) return 'clarify' as const;
  if (!intent.maxPrice && !intent.minPrice && intent.attributes.length === 0) return 'clarify' as const;
  return 'recommend' as const;
}

function fallbackTurn(intent: ShoppingIntent, query: string) {
  const action = fallbackAction(intent, query);
  if (action === 'converse') {
    return { action, intent, reply: 'You’re welcome. Tell me what you want to compare or refine next.' };
  }
  if (action === 'clarify') {
    if (intent.category) {
      return {
        action,
        intent,
        reply: `I can help narrow down ${intent.category.replace(/-/g, ' ')}. What is your budget, and what will you mainly use it for?`,
      };
    }
    return {
      action,
      intent,
      reply: 'What are you shopping for, and do you have a budget or use case in mind?',
    };
  }
  return { action, intent, reply: '' };
}

function groqHistory(history: ConversationMessage[]) {
  return history.slice(-8).map((message) => ({
    role: message.role,
    content: safeSummary(message.content, 700),
  }));
}

async function decideTurnWithGroq(
  query: string,
  categories: string[],
  history: ConversationMessage[],
) {
  const client = groqClient();
  const fallback = fallbackTurn(heuristicIntent(query, categories, history), query);
  if (!client) return { turn: fallback, mode: 'local' as const };
  try {
    const response = await client.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are RazorCart’s conversational shopping agent. Use the conversation history to resolve refinements such as “actually under ₹30,000”. Available category slugs: ${categories.join(', ')}. Return only JSON {action,reply,intent}. action is recommend, clarify, or converse. Choose clarify when a shopping request lacks enough signal for a useful recommendation: for example a category with neither budget nor use case, or no product category at all. For clarify and converse, reply is a warm, concise plain-language answer and do not promise unavailable facts. For recommend, reply may be an empty string because a second grounded reply is generated after catalog ranking. intent is {category,minPrice,maxPrice,attributes,useCase,sortPreference,confidence}; use null for absent prices/category, INR for prices, and only listed category slugs. Never invent product facts. sortPreference is relevance, price_low, or rating.`,
        },
        ...groqHistory(history),
        { role: 'user', content: query },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Groq returned an empty intent');
    return { turn: turnSchema.parse(JSON.parse(content)), mode: 'groq' as const };
  } catch (error) {
    console.warn('[assistant] Groq intent parsing failed; using deterministic fallback.', error);
    return { turn: fallback, mode: 'local' as const };
  }
}

function scoreProduct(product: Product, intent: ShoppingIntent, query: string) {
  let score = product.rating * 8 + Math.min(product.stock, 50) * 0.15;
  const haystack =
    `${product.name} ${product.brand ?? ''} ${product.description} ${product.category} ${product.tagsJson}`.toLowerCase();
  for (const word of query
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2)) {
    if (haystack.includes(word)) score += 8;
  }
  if (intent.category === product.category) score += 35;
  if (intent.maxPrice && product.pricePaise / 100 <= intent.maxPrice) score += 10;
  return score;
}

async function rankWithGroq(
  query: string,
  intent: ShoppingIntent,
  products: Product[],
  history: ConversationMessage[],
) {
  const client = groqClient();
  if (!client) return null;
  try {
    const compact = products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.pricePaise / 100,
      rating: product.rating,
      stock: product.stock,
      tags: parseJson<string[]>(product.tagsJson, []),
      attributes: parseJson<Record<string, unknown>>(product.attributesJson, {}),
    }));
    const response = await client.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Rank only the supplied products for the request. Return JSON {ranking:[{id,relevance,factKeys}]}, at most 6. factKeys must only name facts that materially support the match: price, brand, rating, stock, warranty, shipping, tags. Never add specifications or prose.',
        },
        ...groqHistory(history),
        { role: 'user', content: JSON.stringify({ query, intent, products: compact }) },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return rankSchema.parse(JSON.parse(content));
  } catch (error) {
    console.warn('[assistant] Groq ranking failed; using deterministic relevance.', error);
    return null;
  }
}

async function generateRecommendationReply(
  query: string,
  intent: ShoppingIntent,
  results: Array<{ product: ReturnType<typeof serializeProduct>; explanation: string }>,
  history: ConversationMessage[],
) {
  const client = groqClient();
  const fallback = `Found ${results.length} ${results.length === 1 ? 'option' : 'options'} that fit the direction you gave me. Here’s what stood out:`;
  if (!client) return { reply: fallback, mode: 'local' as const };
  try {
    const products = results.map(({ product, explanation }) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      rating: product.rating,
      stock: product.stock,
      explanation,
    }));
    const response = await client.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are RazorCart’s shopping agent. Return only JSON {reply}. Write a concise, natural opening for the attached recommendations (one or two sentences). Refer only to product facts supplied in the current turn. Do not invent specifications, delivery claims, or discounts. The product cards carry the detailed grounded explanations, so do not repeat every fact.',
        },
        ...groqHistory(history),
        { role: 'user', content: JSON.stringify({ query, intent, products }) },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Groq returned an empty recommendation reply');
    return { reply: replySchema.parse(JSON.parse(content)).reply, mode: 'groq' as const };
  } catch (error) {
    console.warn('[assistant] Groq reply generation failed; using deterministic opening.', error);
    return { reply: fallback, mode: 'local' as const };
  }
}

function groundedExplanation(product: Product, intent: ShoppingIntent, factKeys: string[]) {
  const attributes = parseJson<Record<string, unknown>>(product.attributesJson, {});
  const tags = parseJson<string[]>(product.tagsJson, []);
  const facts: string[] = [];
  if (factKeys.includes('price') || intent.maxPrice) {
    facts.push(
      `it comes in at ₹${new Intl.NumberFormat('en-IN').format(product.pricePaise / 100)}`,
    );
  }
  if (factKeys.includes('rating') && product.rating)
    facts.push(`carries a ${product.rating.toFixed(1)} rating`);
  if (factKeys.includes('brand') && product.brand) facts.push(`is made by ${product.brand}`);
  if (factKeys.includes('stock') && product.stock)
    facts.push(`${product.stock} are currently listed in stock`);
  if (factKeys.includes('warranty') && attributes.warrantyInformation) {
    facts.push(`lists ${String(attributes.warrantyInformation).toLowerCase()}`);
  }
  if (factKeys.includes('shipping') && attributes.shippingInformation) {
    facts.push(String(attributes.shippingInformation).replace(/^Ships/i, 'ships'));
  }
  if (factKeys.includes('tags') && tags[0])
    facts.push(`is tagged “${tags.slice(0, 2).join('” and “')}”`);
  const chosen = facts.slice(0, 3);
  if (chosen.length === 0) {
    chosen.push(
      `matches the ${product.category.replace(/-/g, ' ')} category`,
      `has a ${product.rating.toFixed(1)} catalog rating`,
    );
  }
  const first = chosen.shift()!;
  return `A close fit because ${[first, ...chosen].join(', and ')}. Every detail here comes from the current catalog.`;
}

export async function recommendProducts(
  prisma: PrismaClient,
  query: string,
  history: ConversationMessage[] = [],
) {
  const categoryRows = await prisma.product.findMany({
    distinct: ['category'],
    select: { category: true },
  });
  const categories = categoryRows.map(({ category }) => category).sort();
  const { turn, mode } = await decideTurnWithGroq(query, categories, history);
  const { intent } = turn;
  await prisma.aiAction.create({
    data: {
      actionType: 'intent_parsed',
      inputSummary: safeSummary(query),
      outputSummary: safeSummary(JSON.stringify(intent)),
      metadataJson: JSON.stringify({ mode }),
    },
  });

  if (turn.action !== 'recommend') {
    await prisma.aiAction.create({
      data: {
        actionType: 'conversation_reply_generated',
        inputSummary: safeSummary(query),
        outputSummary: safeSummary(turn.reply),
        metadataJson: JSON.stringify({ mode, action: turn.action, historyLength: history.length }),
      },
    });
    return {
      message: turn.reply,
      intent,
      results: [],
      isFallback: false,
      needsClarification: turn.action === 'clarify',
      mode,
    };
  }

  const where = {
    stock: { gt: 0 },
    ...(intent.category ? { category: intent.category } : {}),
    ...((intent.minPrice || intent.maxPrice) && {
      pricePaise: {
        ...(intent.minPrice ? { gte: Math.round(intent.minPrice * 100) } : {}),
        ...(intent.maxPrice ? { lte: Math.round(intent.maxPrice * 100) } : {}),
      },
    }),
  };
  let candidates = await prisma.product.findMany({ where, take: 40, orderBy: { rating: 'desc' } });
  let isFallback = false;
  if (candidates.length === 0) {
    isFallback = true;
    candidates = await prisma.product.findMany({
      where: { stock: { gt: 0 }, ...(intent.category ? { category: intent.category } : {}) },
      take: 30,
      orderBy: intent.maxPrice ? [{ pricePaise: 'asc' }, { rating: 'desc' }] : [{ rating: 'desc' }],
    });
  }
  if (candidates.length === 0 && intent.category) {
    candidates = await prisma.product.findMany({
      where: { stock: { gt: 0 } },
      take: 30,
      orderBy: { rating: 'desc' },
    });
  }

  const groqRanking = await rankWithGroq(query, intent, candidates, history);
  const byId = new Map(candidates.map((product) => [product.id, product]));
  const usableGroqRanking = groqRanking?.ranking.filter((item) => byId.has(item.id)) ?? [];
  const ranked = usableGroqRanking.length
    ? usableGroqRanking
        .filter((item) => byId.has(item.id))
        .map((item) => ({
          product: byId.get(item.id)!,
          relevance: item.relevance,
          factKeys: item.factKeys,
        }))
    : candidates
        .map((product) => ({
          product,
          relevance: scoreProduct(product, intent, query),
          factKeys: ['price', 'rating'],
        }))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 6);

  const results = ranked.slice(0, 6).map(({ product, relevance, factKeys }) => ({
    product: serializeProduct(product),
    relevance: Math.round(relevance),
    explanation: groundedExplanation(product, intent, factKeys),
  }));
  const generated = results.length
    ? await generateRecommendationReply(query, intent, results, history)
    : {
        reply: 'I could not find a credible match in the current catalog. Try widening the category or budget.',
        mode: 'local' as const,
      };
  const message = isFallback && results.length
    ? `${generated.reply} Nothing matches every constraint exactly, so these are the closest available alternatives.`
    : generated.reply;

  await prisma.aiAction.create({
    data: {
      actionType: 'recommendation_generated',
      inputSummary: safeSummary(query),
      outputSummary: safeSummary(
        `${message} Product IDs: ${results.map(({ product }) => product.id).join(', ')}`,
      ),
      metadataJson: JSON.stringify({
        mode: mode === 'groq' || groqRanking || generated.mode === 'groq' ? 'groq' : 'local',
        isFallback,
        resultCount: results.length,
        historyLength: history.length,
      }),
    },
  });
  return {
    message,
    intent,
    results,
    isFallback,
    needsClarification: false,
    mode: mode === 'groq' || Boolean(groqRanking) || generated.mode === 'groq' ? 'groq' : 'local',
  };
}
