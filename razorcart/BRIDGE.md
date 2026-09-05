# RazorCart → Sentinel bridge

RazorCart continues to work with its local mock while `SENTINEL_URL` is empty. Set it to the standalone service's full authorization URL to enable the real bridge. A configured remote service never falls back to the mock when a request fails.

## Server configuration

Set these only in RazorCart's server environment; do not add a `VITE_` prefix:

- `SENTINEL_URL`: e.g. `http://127.0.0.1:3003/authorize` locally, or `https://sentinel.example.com/authorize`. Only HTTPS and localhost HTTP are accepted.
- `SENTINEL_REGISTRATION_KEY`: the same secret used by Sentinel to protect `POST /agents/register`.
- `SENTINEL_CATALOG_KEY`: the shared catalog evidence key used by Sentinel for `GET /api/catalog/evidence`.
- `RAZORCART_ADMIN_KEY`: a separate human owner key. The agent setup form sends it in the `x-admin-key` header for create/update operations. It is never persisted in browser storage.
- `SENTINEL_CREDENTIAL_KEY`: a separate, stable 32-byte key (base64 or 64 hex characters). Agent signing secrets are encrypted using AES-256-GCM before storage. Back this key up with the database; changing it makes existing credentials unreadable.

Generate each secret separately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Do not reuse the owner key, registration key, or encryption key.

Apply the new nullable column without reseeding existing data:

```powershell
npx prisma generate
npx prisma db push
```

Register existing agents deliberately from the RazorCart directory:

```powershell
npx tsx scripts/sync-sentinel-agents.ts
# Or synchronize one existing agent:
npx tsx scripts/sync-sentinel-agents.ts razorcart-agent-id
```

This command is an owner operation: it sends local standing limits to Sentinel. Checkout never registers agents or copies local limits into Sentinel. Agent creation and editing on `/admin` also perform registration using the server-held registration token. Sentinel preserves its existing signing secret and authorization history during updates. The registration response's initial secret is encrypted locally and never included in an API response to the shopper.

If registration already exists remotely but its local signing credential has been lost, the bridge stops and requests recovery or a new agent ID. It does not create a new secret silently. A failure between remote registration and local persistence may require the same recovery. Keep both the database and encryption key backed up.

## HTTP contracts

`POST /api/agents` and `PATCH /api/agents/:agentId` require `x-admin-key` whenever the real service is configured, or whenever `RAZORCART_ADMIN_KEY` is set. PATCH accepts the same complete form as creation, while preserving the ID and authorization history. `GET /api/admin/config` exposes only whether owner authentication is required and whether the remote mode is configured. `GET /api/agents` exposes a registration boolean, never a secret.

RazorCart registers at `/agents/register` on the configured Sentinel origin using `Authorization: Bearer <SENTINEL_REGISTRATION_KEY>`. The JSON contract is:

```json
{
  "agent_id": "razorcart-example-123456",
  "name": "Equipment buyer",
  "totalLimit": 50000,
  "perTransactionLimit": 40000,
  "transactionCountLimit": 5,
  "frequencyCount": 2,
  "frequencyUnit": "day",
  "allowedCategories": ["laptops"],
  "allowedMerchants": ["razorcart-demo-store"],
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "currency": "INR"
}
```

Responses are `{agent_id, signing_secret}` for first registration and `{agent_id}` for updates. Monetary limits and proposal prices are INR; catalog evidence uses integer paise.

Checkout sends the existing proposal body, including `items`, `quoted_total`, and `created_at`. It adds `x-agent-id` and `x-sentinel-signature`, where the signature is a lowercase hex HMAC-SHA256 over recursively key-sorted JSON. Arrays preserve their order. The per-agent signing secret is used as a UTF-8 string. Demo corruption happens before signing, so the signature establishes the agent identity while Sentinel independently detects the malicious values. Each remote request has a 35-second timeout and redirects are rejected.

Sentinel's verdict must contain `authorization_id`, `request_id`, `agent_id`, `verdict` (`APPROVE`, `DENY`, or `ESCALATE`), `reason_code`, `reason` or `reason_text`, `checks`, `evaluated_amount`, and `remaining_budget`. Check entries have `rule` and `passed` fields. Remote verdicts are persisted locally with redacted delivery addresses so the audit viewer and replay demo continue working.

The trusted catalog route is `GET /api/catalog/evidence?skus=SKU-A,SKU-B`, protected by `x-catalog-key`. It responds with:

```json
{
  "products": [
    {
      "sku": "SKU-A",
      "name": "Catalog name",
      "category": "laptops",
      "pricePaise": 2999900,
      "stock": 10,
      "description": "Catalog description"
    }
  ]
}
```

Sentinel must configure this endpoint itself as an allowlisted evidence URL. It must never use a URL supplied by a purchase proposal. The response reads only current Prisma catalog rows; it does not echo submitted prices.

## Deployment storage

The current Vercel demo copies a bundled SQLite database into ephemeral function storage. Agent credentials, registrations, and audit records written at runtime are not durable across function instances. Run both services locally for the combined demo, or configure durable shared storage before relying on newly registered agents in a hosted deployment. A Vercel seed database must receive the new nullable column before being deployed; schema generation alone does not alter a SQLite database.
