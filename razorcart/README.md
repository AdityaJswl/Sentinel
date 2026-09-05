# RazorCart

RazorCart is the buying-agent storefront for an agentic-commerce authorization demo. It combines a real multi-category catalog, a grounded shopping desk, independently scoped buying agents, and a swappable Sentinel authorization boundary. It deliberately contains no Razorpay or payment-gateway code.

## What is included

- Editorial, responsive React storefront using live DummyJSON product photography
- Persistent SQLite catalog, carts, agent delegations, AI action records, replay nonces, and authorization ledger
- Groq-powered intent parsing and relevance ranking, with a deterministic local fallback when no key is configured
- Grounded recommendation explanations composed only from stored catalog facts
- Standard cart add, quantity update, remove, totals, and session persistence
- Human-owned agent setup page with separate spending, frequency, merchant, category, count, and expiry limits per agent
- Server-generated purchase proposal and a mock Sentinel endpoint returning `APPROVE`, `DENY`, or `ESCALATE`
- Demo controls for price tampering, replay, budget breach, and merchant mismatch
- Transparency viewer combining assistant actions and authorization decisions
- Custom loading, empty, error, verdict, and 404 states
- Generated and web-optimized favicon and Open Graph card; self-hosted Fraunces and Manrope fonts

## Local setup

```bash
cd razorcart
npm install
copy .env.example .env
npm run db:setup
npm run dev
```

Open `http://127.0.0.1:5174`. The frontend proxies `/api` to the Express server at `http://127.0.0.1:3002`.

The checked-in environment example uses SQLite:

```env
DATABASE_URL="your Supabase transaction pooler URL"
DIRECT_URL="your Supabase direct/session URL"
PORT=3002
WEB_ORIGIN="http://127.0.0.1:5174"
GROQ_API_KEY=""
GROQ_MODEL="openai/gpt-oss-120b"
SENTINEL_URL=""
DEMO_MODE=true
```

Set `GROQ_API_KEY` only in the server-side `.env` file. Vite never reads or exposes it. If the key is absent or a Groq request fails, RazorCart keeps the demo usable with transparent deterministic parsing and ranking; it never invents product attributes.

## Production-style local run

```bash
npm run build
npm start
```

## Vercel deployment

The included Vercel configuration deploys the Vite frontend and Express API together. For an
unclaimed demo deployment, the clean SQLite seed is copied into the function's temporary writable
directory on each cold instance. This keeps the demo self-contained, but its carts, audit records,
and agent changes are ephemeral. The Vercel deployment now requires Supabase Postgres: set a pooled `DATABASE_URL` and direct `DIRECT_URL`, run `npm run db:migrate`, then `npm run db:seed` before deploying.
persistence after claiming the project.

The Express process serves the built frontend and API together on port `3002`.

## Catalog refresh

`npm run db:seed` fetches the DummyJSON product catalog in pages, validates records, requires a real HTTPS image, then upserts by the stable remote product ID. The current seed imports 194 products across 24 categories. Counts and categories are discovered at runtime rather than hard-coded. If the external request fails, the script preserves the last successful catalog and exits without truncating it.

## Groq pipeline

`POST /api/assistant/recommend`

1. Parses the request into category, price constraints, attributes, use case, sort preference, and confidence.
2. Applies category, stock, and price constraints in SQLite.
3. Sends only the shortlist’s real fields to Groq for ranking.
4. Builds the displayed explanations from the stored price, brand, rating, stock, tags, warranty, and shipping facts selected by the ranker.
5. Returns a plain closest-alternative response when no exact hard-constraint match exists.

Both `intent_parsed` and `recommendation_generated` are recorded in `AiAction`. Purchase proposals are recorded as `purchase_proposal_generated` with delivery information redacted.

## Sentinel boundary

The default checkout adapter posts the proposal to:

```text
POST /api/mock-sentinel/authorize
```

To use the real Sentinel service later, set `SENTINEL_URL` to its full authorization endpoint. RazorCart’s cart, assistant, and checkout code do not change.

The proposal includes the required contract fields plus line-item evidence:

```json
{
  "request_id": "req_88213",
  "agent_id": "razorcart-buyer-01",
  "merchant": "razorcart-demo-store",
  "product_name": "New DELL XPS 13 9300 Laptop",
  "sku": "LAP-DEL-NEW-029",
  "quantity": 1,
  "price": 1499.99,
  "currency": "INR",
  "category": "laptops",
  "delivery_address": "...",
  "quoted_total": 1499.99,
  "created_at": "2026-09-03T06:00:00.000Z",
  "items": []
}
```

Sentinel uses paise internally and evaluates proposal validity, registered agent, replay, expiry, merchant, every line-item category, per-transaction limit, remaining total budget, catalog-price integrity, transaction count, and rolling frequency. Valid proposals at or above 90% of a spending boundary return `ESCALATE`. Only `APPROVE` consumes authority.

## Suggested demo

1. Add a laptop to the cart from the catalog or the shopping desk.
2. Checkout as **General Shopping Bot** with `Normal`: the request is approved.
3. Switch to **Essentials Runner**: the same laptop is denied for `CATEGORY_NOT_ALLOWED`.
4. Switch to **Threshold Review Bot**: the same laptop is escalated for confirmation.
5. Switch back to General Shopping Bot and run the tampering, replay, budget-breach, and merchant-mismatch controls.
6. Open **Audit trail** to show the grounded assistant records and each machine-readable authorization result.

Reset transaction and cart history between demos without touching products or agent delegations:

```bash
npm run demo:reset
```

## Primary API routes

| Method                  | Route                          | Purpose                                        |
| ----------------------- | ------------------------------ | ---------------------------------------------- |
| `GET`                   | `/api/products`                | Paginated catalog filtering and sort           |
| `GET`                   | `/api/categories`              | Categories derived from the stored catalog     |
| `GET/POST/PATCH/DELETE` | `/api/cart/:cartId/...`        | Session cart CRUD                              |
| `POST`                  | `/api/assistant/recommend`     | Structured intent and recommendations          |
| `GET/POST`              | `/api/agents`                  | List or register independent delegations       |
| `POST`                  | `/api/checkout/authorize`      | Build, optionally corrupt, and send a proposal |
| `POST`                  | `/api/mock-sentinel/authorize` | Local Sentinel-compatible policy evaluation    |
| `GET`                   | `/api/audit`                   | Unified assistant and authorization ledger     |

## Design direction

The visual thesis is documented in `src/styles/tokens.css`: **the modern buyer’s ledger**—an editorial goods journal crossed with a precise transaction record. The interface uses the Radix sand and jade scales, a strict 4px spacing base, hairline rules instead of decorative shadows, asymmetrical catalog spans, self-hosted type, and one deliberate jade signal color.
