/* Run after API test compilation against a disposable, migrated database. */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const api = createRequire(path.resolve(__dirname, '../services/api/package.json'));
api('reflect-metadata');
const { createDb, closeDb } = api('@qitu/database');
const { sql } = api('drizzle-orm');
const { KnowledgeCenterService } = api(
  './.tmp/test-dist/modules/knowledge/knowledge-center.service.js',
);
const { AuditService } = api('./.tmp/test-dist/common/audit/audit.service.js');
const { KnowledgeBuildWorker } = api(
  './.tmp/test-dist/modules/knowledge/knowledge-build.worker.js',
);
const connection = process.env.QITU_KNOWLEDGE_VERIFY_DATABASE_URL;
if (!connection || !new URL(connection).pathname.startsWith('/qitu_knowledge_verify_'))
  throw new Error('A disposable qitu_knowledge_verify_* database is required');
const db = createDb(connection);
const actor = {
  id: 'knowledge-verify-admin',
  role: 'admin',
  displayName: 'Verification',
  email: 'knowledge-verify@example.invalid',
};
(async () => {
  await db.execute(
    sql`INSERT INTO users(id,email,display_name,role,password_hash) VALUES(${actor.id},${actor.email},'Verification','admin','disabled') ON CONFLICT DO NOTHING`,
  );
  const center = new KnowledgeCenterService(db, new AuditService(db));
  const initial = await center.configuration();
  const edits = await Promise.allSettled(
    ['one', 'two'].map((k) =>
      center.save(
        actor,
        { expectedRevision: initial.revision, config: initial.config },
        'cas-' + k + '-' + initial.revision,
      ),
    ),
  );
  assert.equal(
    edits.filter((r) => r.status === 'fulfilled').length,
    1,
    'CAS allows one concurrent editor',
  );
  const snapshot = await center.configuration();
  const request = { expectedRevision: snapshot.revision, config: snapshot.config };
  const saves = await Promise.all([
    center.save(actor, request, 'same-' + snapshot.revision),
    center.save(actor, request, 'same-' + snapshot.revision),
  ]);
  assert.equal(
    saves[0].revision,
    saves[1].revision,
    'duplicate config submission replays one revision',
  );
  const engine = Object.keys(snapshot.config.knowledgeEngines)[0];
  const creates = await Promise.allSettled(
    ['Alpha', 'Beta'].map((name) =>
      center.createBase(actor, { name, engineInstanceId: engine }, 'same-create'),
    ),
  );
  assert.equal(
    creates.filter((r) => r.status === 'fulfilled').length,
    1,
    'different concurrent requests cannot share a key',
  );
  const base = creates.find((r) => r.status === 'fulfilled').value;
  const uploads = await Promise.allSettled(
    ['First material', 'Second material'].map((content) =>
      center.addFile(
        actor,
        base.id,
        { title: 'Material', content, allowMaterialize: true },
        'same-upload',
      ),
    ),
  );
  assert.equal(
    uploads.filter((r) => r.status === 'fulfilled').length,
    1,
    'concurrent upload collision rejected',
  );
  const before = await center.base(base.id);
  await center.updateFile(actor, base.id, before.files[0].id, { allowMaterialize: false });
  const revoked = await center.base(base.id);
  await center.updateFile(actor, base.id, before.files[0].id, { allowMaterialize: false });
  assert.equal(
    (await center.base(base.id)).revision,
    revoked.revision,
    'repeated revocation is idempotent',
  );
  assert.equal((await center.file(base.id, before.files[0].id)).origin.canMaterialize, false);
  const builds = await Promise.all([
    center.rebuild(base.id, 'rebuild-once'),
    center.rebuild(base.id, 'rebuild-once'),
  ]);
  assert.equal(builds[0].revision, builds[1].revision);
  // Disabled engines terminate truthfully; no fake index/version is published.
  const worker = new KnowledgeBuildWorker(
    center,
    { check: async () => ({ ok: false, errorCode: 'MODEL_NOT_BOUND' }) },
    { discover: async () => ({ imported: 0, failures: 0, catalogComplete: true }) },
  );
  await worker.tick();
  const outcome = await center.base(base.id);
  assert.equal(outcome.active_index_version_id, null);
  assert.ok(outcome.jobs.some((j) => j.state === 'failed'));
  const bad = new KnowledgeCenterService(db, {
    write: async () => {
      throw new Error('audit unavailable');
    },
  });
  const state = await center.configuration();
  await assert.rejects(
    bad.save(
      actor,
      { expectedRevision: state.revision, config: state.config },
      'rollback-' + state.revision,
    ),
    /audit unavailable/,
  );
  assert.equal(
    (await center.configuration()).revision,
    state.revision,
    'audit failure rolls back configuration',
  );
  console.log(
    'PASS: CAS, concurrent replay, conflicting creates/uploads, revocation, rebuild deduplication, durable failure, transactional audit',
  );
})()
  .finally(() => closeDb(db))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
