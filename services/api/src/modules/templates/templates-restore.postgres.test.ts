import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { closeDb, createDb } from '@qitu/database';
import { PostgresTemplateStore } from './templates.store.postgres';
import { TemplateRestoreConflictError } from './templates.store';
import { DEFAULT_STAGES, VALID_CREATE_INPUT } from './templates.test-support';

const connection = process.env.QITU_TEMPLATE_RESTORE_TEST_DATABASE_URL;

test('PostgreSQL restore locks out stale/concurrent writes and rolls back both content and state on audit failure', { skip: !connection }, async () => {
  assert(connection);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.QITU_DATA_MODE, 'test');
  const databaseName = new URL(connection).pathname.slice(1);
  assert.match(databaseName, /^qitu_restore_fixture_[a-z0-9_]+$/);
  const db = createDb(connection);
  try {
    const actual = await db.execute(sql`select current_database() as name`);
    assert.equal(actual.rows[0]?.name, databaseName);
    const existing = await db.execute(sql`select to_regclass('public.project_templates') as name`);
    assert.equal(existing.rows[0]?.name, null, 'The disposable fixture must start empty');
    const migration = await readFile(join(process.env.QITU_PROJECT_ROOT ?? process.cwd(), 'database/migrations/0008_domain_foundation.sql'), 'utf8');
    for (const name of ['project_templates', 'project_template_versions']) {
      const statement = migration.split('--> statement-breakpoint').find(entry => entry.trim().startsWith(`CREATE TABLE IF NOT EXISTS "${name}" (`))?.trim();
      assert(statement); await db.execute(sql.raw(statement));
    }
    await db.execute(sql`create unique index fixture_version_unique on project_template_versions(template_id, version)`);
    const store = new PostgresTemplateStore(db);
    let sequence = 0;
    async function archived() {
      const id = `fixture-${++sequence}`, now = new Date();
      await store.createTemplate({ ...VALID_CREATE_INPUT, id, slug: id, createdBy: 'fixture-admin', now });
      const version = await store.createVersion({ id: id + '-v1', templateId: id, version: 'v1',
        stages: DEFAULT_STAGES, content: { materials: ['synthetic fixture'] }, rubric: [], createdBy: 'fixture-admin', now });
      await store.setVersionStatus(version.id, 'published', now, now);
      const historical = await store.findVersion(version.id);
      const template = await store.setTemplateStatus(id, 'archived', null, null, now);
      return { id, historical, input: { expectedUpdatedAt: template.updatedAt, createdBy: 'fixture-admin', versionId: id + '-v2', now: new Date() } };
    }
    const failed = await archived();
    await assert.rejects(store.restoreTemplate(failed.id, failed.input, async (_result, tx) => {
      assert(tx); throw new Error('Synthetic audit outage');
    }), /audit outage/);
    assert.equal((await store.findTemplate(failed.id))?.status, 'archived');
    assert.equal((await store.listVersions(failed.id)).length, 1);
    assert.deepEqual(await store.findVersion(failed.historical!.id), failed.historical);
    const restored = await store.restoreTemplate(failed.id, failed.input, async (_result, tx) => { assert(tx); });
    assert.equal(restored.template.status, 'draft');
    assert.equal(restored.version?.version, 'v2');
    assert.deepEqual(await store.findVersion(failed.historical!.id), failed.historical);
    await assert.rejects(store.restoreTemplate(failed.id, failed.input, async () => {}), TemplateRestoreConflictError);
    const concurrent = await archived();
    const outcomes = await Promise.allSettled(['a', 'b'].map(suffix => store.restoreTemplate(concurrent.id,
      { ...concurrent.input, versionId: concurrent.id + suffix }, async () => {})));
    assert.equal(outcomes.filter(entry => entry.status === 'fulfilled').length, 1);
    assert.equal((await store.listVersions(concurrent.id)).length, 2);
    const stale = await archived();
    await assert.rejects(store.restoreTemplate(stale.id, { ...stale.input, expectedUpdatedAt: new Date(0) }, async () => {}), TemplateRestoreConflictError);
    assert.equal((await store.findTemplate(stale.id))?.status, 'archived');
  } finally { await closeDb(db); }
});
