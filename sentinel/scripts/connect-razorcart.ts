import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import path from 'node:path';

const ownPath = path.resolve('.env');
const cartPath = path.resolve('../razorcart/.env');
if (!existsSync(ownPath) || !existsSync(cartPath))
  throw new Error('Run Sentinel setup and create RazorCart .env first.');
const own = parse(readFileSync(ownPath));
const previous = readFileSync(cartPath, 'utf8');
const cart = parse(previous);
function put(text: string, key: string, value: string) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}
if (!own.REGISTRATION_API_KEY || !own.SENTINEL_CATALOG_KEY)
  throw new Error('Run npm run setup before connecting.');
const updates = {
  SENTINEL_URL: `http://127.0.0.1:${own.PORT || '3003'}/authorize`,
  SENTINEL_REGISTRATION_KEY: own.REGISTRATION_API_KEY,
  SENTINEL_CATALOG_KEY: own.SENTINEL_CATALOG_KEY,
  SENTINEL_CREDENTIAL_KEY: cart.SENTINEL_CREDENTIAL_KEY || randomBytes(32).toString('hex'),
  RAZORCART_ADMIN_KEY: cart.RAZORCART_ADMIN_KEY || randomBytes(32).toString('hex'),
};
// Keep an ignored recovery copy and preserve unrelated environment values.
const backup = `${cartPath}.before-sentinel`;
if (!existsSync(backup)) writeFileSync(backup, previous, { flag: 'wx', mode: 0o600 });
let next = previous;
for (const [key, value] of Object.entries(updates)) next = put(next, key, value);
writeFileSync(cartPath, next, { mode: 0o600 });
if (!own.GROQ_API_KEY && cart.GROQ_API_KEY) {
  writeFileSync(ownPath, put(readFileSync(ownPath, 'utf8'), 'GROQ_API_KEY', cart.GROQ_API_KEY), {
    mode: 0o600,
  });
}
console.log(
  'Local RazorCart and Sentinel credentials connected. No secrets were printed. Restart both APIs and run RazorCart npm run sentinel:sync.',
);
