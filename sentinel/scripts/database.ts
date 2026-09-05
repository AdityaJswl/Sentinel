import '../server/load-env.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { databaseUrls } from '../server/database-env.js';

const tables = [
  'agents',
  'delegations',
  'budgets_usage',
  'decisions',
  'approvals',
  'denials',
  'nonces',
  'authorization_artifacts',
  'transactions',
  'webhook_receipts',
  'audit_events',
];

export async function verifyDatabase() {
  const db = new PrismaClient();
  try {
    const rows = await db.$queryRaw<Array<{ name: string; rls: boolean }>>`
      SELECT c.relname AS name, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = current_schema() AND c.relkind = 'r'`;
    for (const name of tables) {
      if (!rows.some((row) => row.name === name && row.rls)) {
        throw new Error(`Database verification failed: ${name} is missing or RLS is disabled.`);
      }
    }
    const triggers = await db.$queryRaw<Array<{ name: string }>>`
      SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = current_schema() AND c.relname = 'audit_events' AND NOT t.tgisinternal`;
    if (
      !['audit_events_no_update', 'audit_events_no_delete'].every((name) =>
        triggers.some((t) => t.name === name),
      )
    ) {
      throw new Error('Database verification failed: audit immutability triggers are missing.');
    }
    await db.agent.count();
    console.log(
      'Verified PostgreSQL connection, all 11 Sentinel tables, RLS, audit triggers, and Prisma reads.',
    );
  } finally {
    await db.$disconnect();
  }
}

try {
  Object.assign(process.env, databaseUrls(process.env));
  const command = process.argv[2] ?? 'check';
  if (command === 'migrate' || command === 'status') {
    execFileSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        command === 'migrate' ? 'deploy' : 'status',
      ],
      { stdio: 'inherit' },
    );
    if (command === 'migrate') {
      const direct = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
      try {
        // Trusted repository SQL; Prisma sets the datasource's private search_path.
        await direct.$executeRawUnsafe(readFileSync('prisma/security.sql', 'utf8'));
      } finally {
        await direct.$disconnect();
      }
      await verifyDatabase();
    }
  } else if (command === 'check') {
    await verifyDatabase();
  } else {
    throw new Error('Use migrate, status, or check.');
  }
} catch (error) {
  // CLI/driver exceptions can include full connection strings: never print them.
  if (
    error instanceof Error &&
    /^(DATABASE_URL|DIRECT_URL|Database verification|Use migrate)/.test(error.message)
  ) {
    console.error(error.message);
  } else {
    console.error(
      'Database operation failed. Verify the connection password, reachability, schema privileges, and migration status. No connection credentials were logged.',
    );
  }
  process.exitCode = 1;
}
