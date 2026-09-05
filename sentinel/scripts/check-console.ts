import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();
const base = `http://127.0.0.1:${process.env.PORT || 3003}`;
for (const route of ['/api/agents', '/api/audit', '/api/decisions']) {
  assert.equal((await fetch(`${base}${route}`)).status, 401, `${route} must require login`);
}
assert.equal(
  (
    await fetch(`${base}/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  ).status,
  403,
);
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.SENTINEL_TEST_EMAIL;
const password = process.env.SENTINEL_TEST_PASSWORD;
if (!url || !key || !email || !password) {
  console.log(
    'Unauthenticated console checks passed. Set SENTINEL_TEST_EMAIL and SENTINEL_TEST_PASSWORD to test authenticated routes.',
  );
  process.exit(0);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
assert.ifError(error);
assert.ok(data.session?.access_token);
const authorization = `Bearer ${data.session.access_token}`;
for (const route of ['/api/auth/session', '/api/agents', '/api/audit', '/api/decisions']) {
  const response: Response = await fetch(`${base}${route}`, { headers: { authorization } });
  assert.equal(response.status, 200, `${route} must accept the verified Supabase session`);
  const body = await response.text();
  assert.ok(!body.includes(process.env.SIGNING_SECRET!), 'Signing master must never be exposed');
  assert.ok(
    !body.includes(process.env.REGISTRATION_API_KEY!),
    'Registration key must never be exposed',
  );
}
const rejectedOrigin = await fetch(`${base}/agents/register`, {
  method: 'POST',
  headers: { origin: 'https://untrusted.example', authorization },
});
assert.equal(rejectedOrigin.status, 403);
await supabase.auth.signOut();
console.log(
  'Console smoke checks passed: Supabase login, protected views, no credential disclosure, and mutation origin enforcement.',
);
