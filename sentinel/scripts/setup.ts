import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'node:child_process';
const path = '.env';
if (!existsSync(path)) {
  let contents = readFileSync('.env.example', 'utf8');
  for (const key of ['SIGNING_SECRET', 'REGISTRATION_API_KEY', 'SENTINEL_CATALOG_KEY']) {
    contents = contents.replace(`${key}=""`, `${key}="${randomBytes(32).toString('hex')}"`);
  }
  writeFileSync(path, contents, { mode: 0o600, flag: 'wx' });
  console.log('Created private .env. Configure the Supabase publishable settings in that file.');
}
loadEnv({ path: '.env.local' });
loadEnv();
if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  throw new Error(
    'Set DATABASE_URL and DIRECT_URL to the Supabase connection strings before setup.',
  );
}
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/database.ts', 'migrate'], {
  stdio: 'inherit',
});
console.log(
  'Sentinel database is ready. Create a Supabase Auth account to enter the console; add a Groq key to .env for live reasoning.',
);
