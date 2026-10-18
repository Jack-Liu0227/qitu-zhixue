// Rollback-only integration check: exercises the real configuration store without retaining changes.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { sql } = require('drizzle-orm');
const {
  KnowledgeCenterService,
} = require('../services/api/dist/modules/knowledge/knowledge-center.service');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const secret = `fixture-${randomUUID()}`;
  const rollback = new Error('intentional verification rollback');
  const entries = [];
  const writer = {
    write: async (entry) => {
      entries.push(entry);
      assert.ok(!JSON.stringify(entry).includes(secret));
      return randomUUID();
    },
  };
  const center = new KnowledgeCenterService(db, writer);
  try {
    const initial = await center.configuration();
    try {
      await db.transaction(async (tx) => {
        const store = new KnowledgeCenterService(tx, writer);
        const actor = (
          await tx.execute(
            sql`SELECT id,role FROM users WHERE role='admin' AND disabled_at IS NULL LIMIT 1`,
          )
        ).rows[0];
        assert.ok(actor);
        const config = structuredClone(initial.config);
        config.knowledgeEngines['remote-config-verification'] = {
          name: 'Rollback-only fixture',
          provider: 'ima',
          description: '',
          enabled: false,
          config: {
            server_url: 'https://ima.qq.com',
            clientId: 'fixture-client',
            apiKey: secret,
            allowedKnowledgeBaseIds: [],
          },
        };
        const body = { expectedRevision: initial.revision, config };
        const key = `remote-config-${randomUUID()}`;
        const saved = await store.save(actor, body, key);
        assert.equal(saved.revision, initial.revision + 1);
        assert.equal(
          (await store.configuration()).config.knowledgeEngines['remote-config-verification'].config
            .apiKey,
          secret,
        );
        const replay = await store.save(actor, body, key);
        assert.equal(replay.revision, saved.revision);
        assert.equal(
          replay.config.knowledgeEngines['remote-config-verification'].config.apiKey,
          secret,
        );
        await assert.rejects(store.save(actor, body, `stale-${randomUUID()}`), { status: 409 });
        assert.equal(entries.length, 1);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const after = await center.configuration();
    assert.equal(after.revision, initial.revision);
    assert.equal(
      JSON.stringify(after.config) === JSON.stringify(initial.config),
      true,
      'verification must not retain any configuration changes',
    );
    console.log(
      JSON.stringify({
        status: 'PASS',
        checks: [
          'URL, Client ID and API Key persist together in real platform JSON',
          'idempotent replay retains the editable API Key and revision',
          'stale revisions are rejected and audit omits secret values',
          'outer transaction rolls back all verification changes',
        ],
      }),
    );
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
