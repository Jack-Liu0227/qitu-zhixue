import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../services/api/package.json', import.meta.url));
const { Client } = require('pg');
const base = new URL(process.env.QITU_BUSINESS_FIXTURE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname) && base.port && base.port !== '5432');
const name = `qitu_commerce_migration_fixture_${Date.now()}`;
const control = new Client({ connectionString: base.href });
await control.connect();
await control.query(`CREATE DATABASE ${name}`);
const url = new URL(base);
url.pathname = `/${name}`;
const client = new Client({ connectionString: url.href });
await client.connect();
const up = readFileSync(new URL('../database/migrations/0056_company_commerce.sql', import.meta.url), 'utf8');
const down = readFileSync(new URL('../database/migrations/0056_company_commerce.down.sql', import.meta.url), 'utf8');
async function refusesWithoutLoss(message) {
  await assert.rejects(client.query(down), /Cannot roll back 0056/);
  await client.query('ROLLBACK');
  assert.equal((await client.query("SELECT to_regclass('company_members') IS NOT NULL AS present")).rows[0].present, true);
  console.log(`PASS ${message}`);
}
try {
  await client.query(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE business_orders (
      id text PRIMARY KEY, student_id text NOT NULL, offer_id text NOT NULL,
      template_version_id text NOT NULL, offer_snapshot jsonb NOT NULL, amount_fen integer NOT NULL
    );
    INSERT INTO users VALUES ('synthetic-owner');
    INSERT INTO business_orders VALUES ('legacy', 'student', 'offer', 'version', '{}', 990);
  `);
  await client.query(up);
  await client.query("INSERT INTO company_members (user_id, role) VALUES ('synthetic-owner', 'owner')");
  await refusesWithoutLoss('existing Company records block rollback atomically');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM company_members')).rows[0].count, 1);
  await client.query('DELETE FROM company_members');
  await client.query("INSERT INTO business_orders (id, amount_fen, subscription) VALUES ('subscription', 990, '{}')");
  await refusesWithoutLoss('subscription orders block rollback atomically');
  assert.equal((await client.query("SELECT count(*)::int AS count FROM business_orders WHERE id = 'subscription'")).rows[0].count, 1);
  await client.query("DELETE FROM business_orders WHERE id = 'subscription'");
  await client.query(down);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM business_orders')).rows[0].count, 1);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'commerce_%' OR table_name LIKE 'company_%')")).rows[0].count, 0);
  const columns = (await client.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='business_orders'")).rows;
  for (const field of ['student_id', 'offer_id', 'template_version_id', 'offer_snapshot'])
    assert.equal(columns.find(row => row.column_name === field)?.is_nullable, 'NO');
  for (const field of ['subscription', 'service_starts_at', 'refund_amount_fen'])
    assert.equal(columns.some(row => row.column_name === field), false);
  console.log('PASS empty migration rolls back without changing legacy orders');
  await client.query(down);
  await client.query(up);
  await client.query(down);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM business_orders')).rows[0].count, 1);
  console.log('PASS rollback is repeatable and the migration can be reapplied');
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
  await control.query(`DROP DATABASE ${name}`);
  await control.end();
}
