import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseUrls } from './database-env.js';

const valid = {
  DATABASE_URL:
    'postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:6543/postgres',
  DIRECT_URL: 'postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:5432/postgres',
};
test('Supabase runtime uses private schema, TLS and transaction pooling', () => {
  const urls = databaseUrls(valid);
  const runtime = new URL(urls.DATABASE_URL);
  const direct = new URL(urls.DIRECT_URL);
  assert.equal(runtime.searchParams.get('schema'), 'sentinel');
  assert.equal(direct.searchParams.get('schema'), 'sentinel');
  assert.equal(runtime.searchParams.get('sslmode'), 'require');
  assert.equal(runtime.searchParams.get('pgbouncer'), 'true');
  assert.equal(direct.searchParams.get('pgbouncer'), null);
});
test('rejects SQLite, missing URLs and unfilled password placeholders without leaking secrets', () => {
  for (const value of [
    '',
    'file:./sentinel.db',
    valid.DATABASE_URL.replace('secret', '[YOUR-PASSWORD]'),
  ]) {
    assert.throws(
      () => databaseUrls({ ...valid, DATABASE_URL: value }),
      /DATABASE_URL must contain/,
    );
  }
  assert.throws(
    () => databaseUrls({ DATABASE_URL: valid.DATABASE_URL }),
    /DIRECT_URL must contain/,
  );
});
test('refuses public/shared schemas and migrations through transaction pooling', () => {
  assert.throws(
    () => databaseUrls({ ...valid, DATABASE_URL: valid.DATABASE_URL + '?schema=public' }),
    /private sentinel schema/,
  );
  assert.throws(() => databaseUrls({ ...valid, DIRECT_URL: valid.DATABASE_URL }), /session pooler/);
});
