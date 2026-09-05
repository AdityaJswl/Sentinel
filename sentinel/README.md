# Sentinel

Independent authorization service and operations console for RazorCart. It uses its own Supabase Postgres database. RazorCart checkout sends the existing proposal contract to `POST /authorize`; Sentinel returns a structured decision and issues an artifact only after deterministic controls and risk review both pass.

## Run locally

Requires Node.js 22+ and Supabase PostgreSQL connection credentials.

Save the project's transaction pooler URL (port 6543) as `DATABASE_URL` and its session/direct URL (port 5432) as `DIRECT_URL` in `.env.local`. Replace password placeholders with the URL-encoded database password. Both URLs must target the same project. Existing process/Vercel variables take precedence, then `.env.local`, then `.env`.

Sentinel uses the private `sentinel` schema; omit the `schema` query parameter or set it to `sentinel`. This keeps its migration history and authorization tables separate from RazorCart and Supabase Auth. Do not expose this schema through Supabase's Data API. Server connection credentials must belong to the table owner (or an appropriately privileged server role); the browser's publishable key cannot access these tables.

`npm run db:migrate` applies Prisma migrations, applies idempotent RLS/access restrictions from `prisma/security.sql`, and verifies all tables and audit triggers. `npm run db:status` reports migration status, and `npm run db:check` performs read-only verification. Use these commands instead of calling Prisma directly so `.env.local` and connection settings are loaded consistently. Existing SQLite files are left untouched; this sets up fresh Postgres storage and does not import old local authorization history.

```powershell
cd sentinel
npm install
npm run setup
npm run connect:razorcart
```

`setup` generates private random signing, registration, and catalog credentials in `.env`, then applies the database migration. It does not print secrets. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the public settings from the connected Supabase project. `connect:razorcart` configures the local server bridge and saves an ignored backup of RazorCart's prior environment.

Set `GROQ_API_KEY` in **Sentinel's server `.env`**. A key saved in RazorCart's Vercel environment is not automatically available to this local service. The default Groq model is configurable with `GROQ_MODEL`; it uses `openai/gpt-oss-120b`, matching RazorCart's working provider configuration. The older requested Llama model was unavailable in this project's earlier deployment. Missing keys, invalid model replies, timeouts, and unavailable catalog evidence safely escalate without artifacts.

Start Sentinel, then prepare the existing RazorCart database and mirror its agents:

```powershell
# Terminal 1, sentinel/
npm run dev

# Terminal 2, razorcart/
npx prisma generate
npx prisma db push
npm run sentinel:sync
npm run dev
```

If a Windows Prisma DLL is locked, stop the corresponding running RazorCart API before generating. Do not reset the database.

Sentinel console: `http://127.0.0.1:5175`. Sentinel API: `http://127.0.0.1:3003`. RazorCart UI/API: ports 5174/3002. The exact permitted origins are configured in `.env`. For a built console, run `npm run build`, then `npm start` and visit port 3003.

No fabricated decisions are seeded. `npm run demo` registers two temporary demo agents, submits actual signed requests through the live services, and fills the console with normal, cross-agent, replay, price, merchant, invalid-signature, and injection scenarios. It creates no payment orders. Without a Groq key, the normal case escalates; the hard-failure cases still deny.

## Security boundaries

1. Authenticate the registered agent using HMAC-SHA256 over canonical JSON. Reject absent/invalid signatures before consuming a nonce or calling Groq.
2. Atomically claim the global `request_id` in PostgreSQL. Repeated IDs deny even when submitted concurrently by another agent.
3. Check revocation, delegation expiry, INR, amount caps, reserved/settled budget, transaction count, frequency, and merchant/category scope.
4. Fetch product identity, price, stock, and description from the authenticated merchant catalog endpoint configured by the operator. No catalog URL or price supplied by the agent is trusted as evidence.
5. Run pure product and total checks. Any failed hard check returns before risk reasoning.
6. Groq reviews the proposal, catalog, and recent authorization history. Deterministic injection signals deny; ambiguous retry patterns escalate. All untrusted text is treated as evidence, never instructions.
7. Re-run hard checks inside a PostgreSQL transaction holding the owning agent's row lock after the asynchronous risk call. This closes the race with concurrent approvals, policy changes, revocation, and expiry. Reserve budget and issue a five-minute artifact atomically.

Every approval increments the authorization count and frequency usage. Expired unused artifacts release the amount reservation but retain their historical authorization counts. Actual captured payment moves the reservation to settled spend. Policy edits and revocation invalidate outstanding, unused artifacts. Consumed orders remain reserved until reconciliation; their payment results cannot safely be assumed cancelled.

Per-agent secrets are generated server-side, returned once at registration, and encrypted at rest. RazorCart also stores them encrypted. Re-registration updates delegation fields without replacing or returning the secret and without resetting usage. Registration requires a separate privileged server credential or an authenticated Sentinel administrator. RazorCart's owner-key protected admin operation performs this registration; checkout cannot grant itself permissions.

The audit API is read-only. Application code only appends, and database triggers reject UPDATE and DELETE. This protects against application mistakes, not a privileged database administrator replacing the database file.

## APIs

- `POST /agents/register`: privileged registration/update; body uses `agent_id`, `name`, `totalLimit`, `perTransactionLimit`, `transactionCountLimit`, `frequencyCount`, `frequencyUnit`, `allowedCategories`, `allowedMerchants`, `expiresAt`, `currency`. Send `Authorization: Bearer <REGISTRATION_API_KEY>` server-side. Initial response includes `signing_secret` once.
- `POST /authorize`: original RazorCart proposal JSON; headers `x-agent-id`, `x-sentinel-signature`. Signature is lowercase HMAC-SHA256 hex, with the per-agent secret as UTF-8. Canonical JSON recursively sorts object keys and preserves array order.
- `POST /payments/orders`: `{artifact, proposal}` signed over that entire object by the same agent, with the same headers. Every actual checkout field must match the artifact. Response contains an order ID, never payment secrets.
- `POST /webhooks/razorpay`: raw JSON with `x-razorpay-signature` and optional `x-razorpay-event-id`.
- `/api/auth/session`: verifies the Supabase access token and returns the server-authorized console identity. Every protected console endpoint requires the same bearer token.
- `/api/decisions`, `/api/decisions/:id`, `/api/agents`, `/api/audit`: protected console views. `POST /api/agents/:id/revoke` requires admin.

An authorization response has `authorization_id`, `request_id`, `agent_id`, `verdict`, `reason_code`, `reason_text`, backward-compatible `reason`, `checks`, `evaluated_amount`, `remaining_budget`, `risk`, `authorized_at`, and an `artifact` only for APPROVE. Each check has `rule`, `passed`, `reason_code`, `reason_text`, and optional `actual`/`limit`.

Supabase Auth provides email/password sign-up, sign-in, session refresh, and sign-out. New accounts are standard users with no matching agent data. Grant access by setting protected app metadata through a trusted Supabase Admin API call: `sentinel_role` may be `admin`, while `sentinel_agent_id` scopes a standard user to one registered agent. Refresh the user's session after changing metadata. Console admins can view all decisions and revoke agents; standard users can only view their assigned agent. The console never receives signing keys, registration credentials, or payment secrets.

Add `http://127.0.0.1:5175` and each deployed console origin to the Supabase Auth redirect URL allow list so email confirmations return to Sentinel.

## Payment adapter

`PAYMENT_MODE=mock` is the default. It returns clearly labeled local mock orders and cannot move money. `PAYMENT_MODE=test` requires a `rzp_test_` key ID and server-only secret, and uses Razorpay's orders endpoint. Live keys are refused. The provider boundary is `createProviderOrder()` in `server/razorpay-adapter.ts`.

An artifact is signature-verified, checked against the issued database record, bound to the exact checkout, checked against current delegation status, and atomically marked consumed **before** the provider call. Reuse is rejected. An uncertain provider result retains the reservation and requires reconciliation; the artifact is never restored for blind retry.

Webhook validation uses HMAC-SHA256 of the exact raw request bytes, as required by [Razorpay's webhook validation documentation](https://razorpay.com/docs/webhooks/validate-test/). Order, amount, currency, payment status, and original artifact are reconciled. Receipt deduplication and settlement are transactional; repeated or concurrent callbacks cannot debit usage twice. A failed payment attempt does not release an order reservation because a subsequent attempt on that order may succeed.

## Verification

```powershell
npm test
npm run lint
npm run build
```

`npm test` runs the offline security and connection configuration tests. Set `TEST_DATABASE_URL` to a dedicated PostgreSQL test database's direct/session URL in `.env.local`, then run `npm run test:integration`. The integration suite creates a unique `sentinel_test_<uuid>` schema, applies actual migrations and RLS, runs authorization/concurrency/audit/webhook tests through two Prisma clients, and removes only that generated schema afterward. It fails clearly if the test URL is absent; integration tests are never silently skipped. No Groq key or Razorpay access is needed.

## Hosting boundary

Supabase Postgres is required for deployment. Use the Supavisor transaction pooler URL (port 6543) as `DATABASE_URL` for Vercel runtime and a direct/session URL (port 5432) as `DIRECT_URL` for migrations. Do not use an ephemeral serverless `/tmp` database: replay protection, secrets, reservations, and artifact consumption must be shared and durable.

Production operations such as managed key rotation, database access controls, additional identity providers, persistent distributed rate limits, and automatic reconciliation of uncertain gateway calls remain deployment work. The runnable demo supports the full authorization path, with payment execution explicitly limited to mock or Razorpay Test Mode.
