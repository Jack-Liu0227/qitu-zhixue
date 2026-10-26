import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Disposable reduced schema: actual owner SQL and schema foreign keys, no external database.
const root = fileURLToPath(new URL('../', import.meta.url));
const runId = process.env.QITU_SOURCE_RUN_ID;
assert.match(runId ?? '', /^run-\d+-\d+$/);
assert.ok(process.env.QITU_VERIFY_DEPENDENCY_ROOT);
const require = createRequire(import.meta.url);
const external = createRequire(join(process.env.QITU_VERIFY_DEPENDENCY_ROOT, 'package.json'));
const pglitePath = external.resolve('@electric-sql/pglite');
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === '@electric-sql/pglite' ? pglitePath : specifier, context);
} });
const { PGlite } = external('@electric-sql/pglite');
const { drizzle } = require('drizzle-orm/pglite');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');
const schema = require('@qitu/database');
const compiled = join(root, 'services/api/.tmp/archive-delete', runId, 'dist/modules/templates');
const { PostgresTemplateStore } = require(join(compiled, 'templates.store.postgres.js'));
const { TemplateDeleteProtectedError } = require(join(compiled, 'templates.store.js'));
const pg = new PGlite();
const db = drizzle(pg);
const store = new PostgresTemplateStore(db);
const protectedNames = new Set(['project_templates', 'project_template_versions', 'pbl_template_team_bindings']);
const configs = ['projectTemplates', 'projectTemplateVersions', 'pblTemplateTeamBindings', 'projects',
  'explorationSessions', 'learningPlans', 'artifacts', 'templateVerificationRuns', 'projectBindingSnapshots']
  .map(name => { assert.ok(schema[name], `Missing schema ${name}`); return getTableConfig(schema[name]); });
const history = [];
let checks = 0;

try {
  for (const config of configs) {
    const columns = new Set(['id', 'status']);
    for (const key of config.foreignKeys) {
      const ref = key.reference();
      if (protectedNames.has(getTableConfig(ref.foreignTable).name)) {
        ref.columns.forEach(column => columns.add(column.name));
      }
    }
    await pg.exec(`CREATE TABLE "${config.name}" (${[...columns].map(name => `"${name}" text`).join(', ')}, PRIMARY KEY(id))`);
  }
  for (const config of configs) {
    for (const key of config.foreignKeys) {
      const ref = key.reference();
      const target = getTableConfig(ref.foreignTable).name;
      if (!protectedNames.has(target)) continue;
      assert.equal(ref.columns.length, 1);
      const column = ref.columns[0].name;
      await pg.exec(`ALTER TABLE "${config.name}" ADD FOREIGN KEY ("${column}") REFERENCES "${target}"("${ref.foreignColumns[0].name}") ON DELETE ${key.onDelete ?? 'no action'}`);
      if (!protectedNames.has(config.name)) history.push({ table: config.name, column, target });
    }
  }
  await pg.exec('CREATE TABLE fixture_audit(id text)');

  async function fixture(id, status = 'archived') {
    await pg.query('INSERT INTO project_templates(id,status) VALUES ($1,$2)', [id, status]);
    await pg.query("INSERT INTO project_template_versions(id,template_id,status) VALUES ($1,$2,'published')", [id + '-v', id]);
    await pg.query('INSERT INTO pbl_template_team_bindings(id,template_version_id) VALUES ($1,$2)', [id + '-b', id + '-v']);
  }
  async function present(id, expected) {
    for (const [table, suffix] of [['project_templates', ''], ['project_template_versions', '-v'], ['pbl_template_team_bindings', '-b']]) {
      assert.equal((await pg.query(`SELECT id FROM "${table}" WHERE id=$1`, [id + suffix])).rows.length, expected);
    }
  }

  await fixture('unused');
  assert.equal(await store.deleteTemplate('unused', async tx => {
    await tx.execute(sql`INSERT INTO fixture_audit VALUES ('unused')`);
  }), true);
  await present('unused', 0);
  assert.equal((await pg.query('SELECT * FROM fixture_audit')).rows.length, 1); checks++;

  for (const [index, reference] of history.entries()) {
    const id = `history-${index}`;
    await fixture(id);
    const targetId = id + (reference.target === 'pbl_template_team_bindings' ? '-b' : '-v');
    await pg.query(`INSERT INTO "${reference.table}"(id,"${reference.column}") VALUES ($1,$2)`, [id, targetId]);
    await assert.rejects(store.deleteTemplate(id), TemplateDeleteProtectedError);
    await present(id, 1);
    assert.equal((await pg.query(`SELECT * FROM "${reference.table}" WHERE id=$1`, [id])).rows.length, 1); checks++;
  }

  await fixture('audit-failure');
  await assert.rejects(store.deleteTemplate('audit-failure', async tx => {
    await tx.execute(sql`INSERT INTO fixture_audit VALUES ('failed')`);
    throw new Error('Synthetic audit outage');
  }), /audit outage/);
  await present('audit-failure', 1);
  assert.equal((await pg.query("SELECT * FROM fixture_audit WHERE id='failed'")).rows.length, 0); checks++;

  await fixture('relisted', 'piloting');
  await assert.rejects(store.deleteTemplate('relisted'), TemplateDeleteProtectedError);
  await present('relisted', 1); checks++;
  console.log(`PASS: ${checks} isolated PGlite PostgreSQL checks (actual store SQL, historical foreign keys, unused bindings and audit rollback).`);
} finally { await pg.close(); }
