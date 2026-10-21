// Synthetic in-memory PostgreSQL fixture. Never connects to DATABASE_URL.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.env.QITU_VERIFY_RUN_ID;
assert.match(runId ?? '', /^run-[0-9]+-[0-9]+$/, 'Run the fresh-source verifier first');
const apiDist = process.env.QITU_VERIFY_API_DIST
  ?? join(root, 'services/api/.tmp/pbl-capability', runId, 'dist');
const workerDist = process.env.QITU_VERIFY_WORKERS_DIST
  ?? join(root, 'services/api/.tmp/pbl-capability', runId, 'workers');
const req = createRequire(join(root, 'services/api/package.json'));
const externalRoot = process.env.QITU_VERIFY_DEPENDENCY_ROOT;
const external = externalRoot ? createRequire(join(resolve(externalRoot), '__fixture__.cjs')) : req;
const pgliteEntry = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === '@electric-sql/pglite'
    ? { url: pathToFileURL(pgliteEntry).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
delete process.env.QITU_VERIFY_DEPENDENCY_ROOT;
process.env.QITU_SOURCE_RUN_ID = runId;
await import('./verify-workspace-source.mjs');
const { PGlite } = external('@electric-sql/pglite');
const { drizzle } = req('drizzle-orm/pglite');
const { sql } = req('drizzle-orm');
const { getTableConfig, PgDialect } = req('drizzle-orm/pg-core');
const schema = req('@qitu/database');
const mod = (path) => {
  const target = join(apiDist, path);
  assert.ok(existsSync(target), `Missing fresh API build: ${target}`);
  return req(target);
};
const workers = (name) => {
  const target = [join(workerDist, name), join(workerDist, 'src', name)].find(existsSync);
  assert.ok(target, `Missing fresh worker build: ${name}`);
  return req(target);
};
req('reflect-metadata');
const { GrowthProjectionSettingsService } = mod('modules/growth/growth-projection-settings.service.js');
const { provisionGrowthProjectionRuntime } = mod('modules/growth/growth-projection-runtime.js');
const { AuditService } = mod('common/audit/audit.service.js');
const { GrowthProjectionOwnerService } = mod('modules/growth/growth-projection-owner.service.js');
const { PostgresTeamProjectionSource } = workers('team-runtime-projection-source.js');
const { PostgresTeamMailboxSource } = workers('team-runtime-mailbox-source.js');
const pg = new PGlite();
const db = drizzle(pg);
const checks = [];
const dialect = new PgDialect();
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const literal = (value) => value === null ? 'NULL' : typeof value === 'number' || typeof value === 'boolean'
  ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const expression = (value) => {
  const query = dialect.sqlToQuery(value);
  assert.equal(query.params.length, 0, 'Fixture DDL cannot contain parameters');
  return query.sql.replace(/"[^"]+"\."/gu, '"');
};

// Derive columns, unique indexes and FK constraints from the real schema.
// This keeps the active-run partial index in the test rather than mocking it.
async function createFixtureSchema() {
  const tables = new Map();
  function collect(table) {
    const config = getTableConfig(table);
    if (tables.has(config.name)) return;
    tables.set(config.name, config);
    for (const foreign of config.foreignKeys) collect(foreign.reference().foreignTable);
  }
  for (const name of ['adminAssistants', 'adminTeams', 'adminTeamVersions', 'projectBindingSnapshots',
    'agentConfigs', 'agentRoutes', 'agentTeamRuns', 'agentTeamTasks', 'agentTeamMessages',
    'agentMailboxes', 'agentProjectionCandidates', 'agentTeamEvents', 'outbox', 'auditLogs']) collect(schema[name]);
  for (const config of tables.values()) {
    const columns = config.columns.map((column) => {
      const type = column.getSQLType();
      const defaultValue = column.default === undefined ? '' : ` DEFAULT ${
        column.default && typeof column.default === 'object' && 'queryChunks' in column.default
          ? expression(column.default) : type === 'jsonb'
            ? `${literal(JSON.stringify(column.default))}::jsonb` : literal(column.default)}`;
      return `${quote(column.name)} ${type}${column.notNull ? ' NOT NULL' : ''}`
        + `${column.primary ? ' PRIMARY KEY' : ''}${column.isUnique ? ' UNIQUE' : ''}${defaultValue}`;
    });
    for (const primary of config.primaryKeys) columns.push(`PRIMARY KEY (${primary.columns.map((c) => quote(c.name)).join(',')})`);
    for (const unique of config.uniqueConstraints) columns.push(`UNIQUE (${unique.columns.map((c) => quote(c.name)).join(',')})`);
    for (const check of config.checks) columns.push(`CHECK (${expression(check.value)})`);
    await pg.exec(`CREATE TABLE ${quote(config.name)} (${columns.join(',')})`);
    for (const { config: index } of config.indexes.filter((index) => index.config.unique)) {
      const indexed = index.columns.map((column) => 'name' in column ? quote(column.name) : expression(column)).join(',');
      await pg.exec(`CREATE UNIQUE INDEX ${quote(index.name)} ON ${quote(config.name)} (${indexed})`
        + (index.where ? ` WHERE ${expression(index.where)}` : ''));
    }
  }
  for (const config of tables.values()) for (const foreign of config.foreignKeys) {
    const ref = foreign.reference();
    await pg.exec(`ALTER TABLE ${quote(config.name)} ADD FOREIGN KEY (${ref.columns.map((c) => quote(c.name)).join(',')})`
      + ` REFERENCES ${quote(getTableConfig(ref.foreignTable).name)} (${ref.foreignColumns.map((c) => quote(c.name)).join(',')})`);
  }
  await pg.exec(`CREATE TABLE platform_configuration_revisions (
    revision integer PRIMARY KEY, parent_revision integer, config jsonb NOT NULL,
    updated_by text NOT NULL, idempotency_key text NOT NULL UNIQUE, request_hash text NOT NULL)`);
}

const settings = { profileAssistantId: 'fixture-profile', growthAssistantId: 'fixture-growth' };
const actor = { id: 'fixture-admin', role: 'admin', email: 'admin@example.invalid', displayName: 'Synthetic admin' };
const body = { expectedRevision: 1, settings };
const one = async (text) => (await pg.query(text)).rows[0];
const count = async (table) => Number((await one(`SELECT count(*) AS count FROM ${quote(table)}`)).count);

try {
  await createFixtureSchema();
  await db.insert(schema.users).values([
    { id: actor.id, email: actor.email, role: 'admin', displayName: actor.displayName, passwordHash: 'fixture-no-login' },
    { id: 'fixture-student', email: 'student@example.invalid', role: 'student', displayName: 'Synthetic learner', passwordHash: 'fixture-no-login' },
  ]);
  await db.insert(schema.adminAssistants).values([
    { id: settings.profileAssistantId, name: 'Synthetic profile', modelProviderId: 'synthetic-provider', modelId: 'synthetic-model', instructions: 'Synthetic profile instructions' },
    { id: settings.growthAssistantId, name: 'Synthetic growth', instructions: 'Synthetic growth instructions' },
    { id: 'qitu-learning-partner', name: 'Synthetic tutor' },
    { id: 'fixture-live-leader', name: 'Synthetic team leader' },
  ]);
  await db.insert(schema.agentConfigs).values([
    { id: 'qitu-learning-partner', displayName: 'Synthetic tutor', roleDefinition: 'Synthetic' },
    { id: 'fixture-live-leader', displayName: 'Synthetic team leader', roleDefinition: 'Synthetic' },
    { id: 'fixture-unrelated', displayName: 'Unrelated agent', roleDefinition: 'Synthetic' },
  ]);
  await db.insert(schema.adminTeams).values({ id: 'fixture-team', name: 'Synthetic team', leaderAssistantId: 'fixture-live-leader' });
  await db.execute(sql`INSERT INTO platform_configuration_revisions VALUES (1,NULL,'{}'::jsonb,${actor.id},'fixture-initial','initial')`);
  const audit = new AuditService(db);
  const knowledge = { configuration: async () => one('SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1') };
  const service = new GrowthProjectionSettingsService(db, knowledge, audit);
  assert.equal((await service.read()).assistants.some((item) => item.id === settings.profileAssistantId), true);

  const failing = new GrowthProjectionSettingsService(db, knowledge, { write: async (entry, tx) => {
    await audit.write(entry, tx);
    throw new Error('SYNTHETIC_AUDIT_FAILURE');
  } });
  await assert.rejects(failing.save(actor, body, 'rollback'), /SYNTHETIC_AUDIT_FAILURE/);
  assert.equal(await count('platform_configuration_revisions'), 1);
  assert.equal(await count('agent_configs'), 3);
  assert.equal(await count('agent_routes'), 0);
  assert.equal(await count('audit_logs'), 0);
  checks.push('configuration-descriptors-routes-audit-rollback');

  const saved = await service.save(actor, body, 'save');
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.readiness, { profile: 'ready', growth: 'ready' });
  assert.equal(await count('agent_routes'), 4);
  assert.equal(await count('agent_configs'), 5);
  const canonical = await one("SELECT * FROM agent_configs WHERE id='fixture-profile'");
  assert.equal(canonical.model_id, null);
  assert.equal(canonical.model_provider_id, null);
  assert.equal(canonical.role_definition, '');
  assert.equal(canonical.agent_definition, '');
  assert.deepEqual((await pg.query('SELECT DISTINCT from_agent_id FROM agent_routes ORDER BY from_agent_id')).rows
    .map((row) => row.from_agent_id), ['fixture-live-leader', 'qitu-learning-partner']);
  assert.equal((await service.save(actor, body, 'save')).revision, 2);
  assert.equal(await count('platform_configuration_revisions'), 2);
  assert.equal(await count('audit_logs'), 1);
  await assert.rejects(service.save(actor, { ...body, settings: { ...settings, growthAssistantId: null } }, 'save'));
  await assert.rejects(service.save(actor, body, 'stale-revision'));
  checks.push('canonical-descriptors-explicit-leaders-save-replay-conflict');

  await pg.exec("UPDATE agent_routes SET enabled=false WHERE from_agent_id='fixture-live-leader'");
  await db.transaction((tx) => provisionGrowthProjectionRuntime(tx, settings, actor.id));
  assert.equal(Number((await one("SELECT count(*) AS count FROM agent_routes WHERE from_agent_id='fixture-live-leader' AND enabled=false")).count), 2);
  await pg.exec("UPDATE agent_configs SET enabled=false WHERE id='fixture-profile'");
  await assert.rejects(db.transaction((tx) => provisionGrowthProjectionRuntime(tx, settings, actor.id)), /GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE/);
  assert.equal((await one("SELECT enabled FROM agent_configs WHERE id='fixture-profile'")).enabled, false);
  await pg.exec("UPDATE agent_configs SET enabled=true WHERE id='fixture-profile'");
  checks.push('runtime-and-route-revocation-preserved');

  await db.insert(schema.agentTeamRuns).values({ id: 'fixture-tutor-run', leaderAgentId: 'qitu-learning-partner',
    studentUserId: 'fixture-student', trigger: 'tutor.turn', status: 'running', idempotencyKey: 'fixture-tutor-run' });
  await assert.rejects(async () => db.insert(schema.agentTeamRuns).values({ id: 'fixture-forbidden-run', leaderAgentId: 'qitu-learning-partner',
    studentUserId: 'fixture-student', trigger: 'tutor.turn', status: 'queued', idempotencyKey: 'fixture-forbidden-run' }));
  const event = { eventId: 'fixture-reflection-event', topic: 'reflection.created', payload: {
    sourceAgentId: 'qitu-learning-partner', studentUserId: 'fixture-student', projectId: null,
    evidenceRefs: ['reflection:fixture-reflection'],
  } };
  await db.insert(schema.agentTeamEvents).values({ id: event.eventId, topic: event.topic, payload: event.payload, idempotencyKey: event.eventId });
  await db.insert(schema.outbox).values({ id: 'fixture-source-outbox', topic: 'agent.team.event', payload: event, status: 'pending' });
  const source = new PostgresTeamProjectionSource(db);
  const claimed = await source.claim();
  assert.ok(claimed);
  assert.equal(await source.project(claimed), 2);
  assert.equal(await source.project(claimed), 2);
  assert.equal(await count('agent_team_tasks'), 2);
  assert.equal(await count('agent_projection_candidates'), 2);
  assert.equal(await count('agent_team_messages'), 2);
  assert.equal((await one("SELECT status FROM agent_team_runs WHERE id='fixture-tutor-run'")).status, 'running');
  const analysisRun = await one("SELECT id,status,context FROM agent_team_runs WHERE id<>'fixture-tutor-run'");
  assert.equal(analysisRun.status, 'waiting');
  assert.equal(analysisRun.context.projectionOnly, true);
  assert.equal(Number((await one('SELECT sum(pending_count) AS count FROM agent_mailboxes')).count), 2);
  await source.complete(claimed);
  assert.equal((await one("SELECT status FROM outbox WHERE id='fixture-source-outbox'")).status, 'published');
  checks.push('real-active-run-unique-index-analysis-coexists-source-replay');

  const mailbox = new PostgresTeamMailboxSource(db);
  const output = { fixture: 'synthetic-queue-result-not-a-domain-fact' };
  for (let index = 0; index < 2; index++) {
    const job = await mailbox.claim(undefined, true);
    assert.ok(job);
    assert.equal(job.message.messageType, 'projection.request');
    assert.equal((await one("SELECT status FROM agent_team_runs WHERE id='fixture-tutor-run'")).status, 'running');
    assert.equal((await one(`SELECT status FROM agent_team_runs WHERE id=${literal(analysisRun.id)}`)).status, 'waiting');
    assert.equal(await mailbox.complete(job, output), true);
    assert.equal(await mailbox.complete(job, output), false);
  }
  assert.equal((await one(`SELECT status FROM agent_team_runs WHERE id=${literal(analysisRun.id)}`)).status, 'completed');
  assert.equal((await one("SELECT status FROM agent_team_runs WHERE id='fixture-tutor-run'")).status, 'running');
  assert.equal(await mailbox.claim(undefined, true), null);
  assert.equal(Number((await one("SELECT count(*) AS count FROM agent_team_tasks WHERE status='succeeded'")).count), 2);
  assert.equal(Number((await one("SELECT count(*) AS count FROM agent_team_messages WHERE message_type='projection.result' AND status='delivered'")).count), 2);
  assert.equal(Number((await one('SELECT sum(pending_count) AS count FROM agent_mailboxes')).count), 0);
  assert.equal(Number((await one("SELECT count(*) AS count FROM agent_projection_candidates WHERE status='accepted'")).count), 0);
  checks.push('mailbox-leases-ack-replay-analysis-completion-tutor-run-preserved');

  const owner = new GrowthProjectionOwnerService(db, audit);
  for (const suffix of ['serial-a', 'serial-b']) {
    const serialEvent = { ...event, eventId: `fixture-${suffix}` };
    await db.insert(schema.agentTeamEvents).values({ id: serialEvent.eventId, topic: serialEvent.topic,
      payload: serialEvent.payload, idempotencyKey: serialEvent.eventId });
    await source.project({ ...claimed, event: serialEvent });
  }
  const firstProfile = await mailbox.claim(settings.profileAssistantId, true);
  assert.ok(firstProfile);
  assert.equal(await mailbox.claim(settings.profileAssistantId, true), null, 'Same scope waits while its first model task runs');
  const firstGrowth = await mailbox.claim(settings.growthAssistantId, true);
  assert.ok(firstGrowth, 'Different projection types do not block one another');
  assert.equal((await one("SELECT status FROM agent_team_runs WHERE id='fixture-tutor-run'")).status, 'running');
  const manifestOutput = { result: output, analysisManifest: { fixture: 'synthetic-unreviewed-result' } };
  await mailbox.complete(firstProfile, manifestOutput);
  await mailbox.complete(firstGrowth, manifestOutput);
  assert.equal(await mailbox.claim(settings.profileAssistantId, true), null, 'Succeeded generation waits for owner receipt');
  assert.equal(await mailbox.claim(settings.growthAssistantId, true), null, 'Each type waits for its own owner receipt');
  const profileCandidate = await one(`SELECT id FROM agent_projection_candidates WHERE task_id=${literal(firstProfile.task.id)}`);
  await owner.reject(profileCandidate.id, actor, 'INSUFFICIENT_EVIDENCE', 'fixture-profile-receipt');
  const nextProfile = await mailbox.claim(settings.profileAssistantId, true);
  assert.ok(nextProfile, 'Owner rejection releases the next generation without inventing acceptance');
  assert.equal(await mailbox.claim(settings.growthAssistantId, true), null, 'A profile receipt does not release growth generation');
  const growthCandidate = await one(`SELECT id FROM agent_projection_candidates WHERE task_id=${literal(firstGrowth.task.id)}`);
  await owner.reject(growthCandidate.id, actor, 'INSUFFICIENT_EVIDENCE', 'fixture-growth-receipt');
  const nextGrowth = await mailbox.claim(settings.growthAssistantId, true);
  assert.ok(nextGrowth);
  await mailbox.complete(nextProfile, output);
  await mailbox.complete(nextGrowth, output);
  assert.equal((await one("SELECT status FROM agent_team_runs WHERE id='fixture-tutor-run'")).status, 'running');
  checks.push('same-student-type-serialized-through-real-owner-rejection-other-type-independent');
  console.log(JSON.stringify({ fixture: 'disposable-in-memory-postgresql', runId, checks,
    limits: 'Queue and configuration integration only; no external model call or owner acceptance assertion' }, null, 2));
} finally {
  await pg.close();
}
