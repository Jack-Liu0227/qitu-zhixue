import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTemplates, projectTemplateVersions, pblTemplateTeamBindings } from '@qitu/database';
import { PostgresTemplateStore } from './templates.store.postgres';
import { TemplateStoreConflictError, TemplateDeleteProtectedError } from './templates.store';

function fixture() {
  let status = 'draft'; let versionStatus = 'draft'; let referenced: unknown = null; let wrapped = false; let referenceCode = '23503';
  const deleted: unknown[] = []; const locks: unknown[] = [];
  const db = {
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => {
      const snapshot = [...deleted];
      try { return await run(db); }
      catch (error) { deleted.splice(0, deleted.length, ...snapshot); throw error; }
    },
    select: () => ({ from: (table: unknown) => ({ where: () => ({ for: async () => {
      locks.push(table); return [{ id: 'version', status: table === projectTemplates ? status : versionStatus }];
    } }) }) }),
    delete: (table: unknown) => ({ where: async () => {
      if (referenced === table) {
        const error = Object.assign(new Error('synthetic foreign key'), { code: referenceCode });
        throw wrapped ? new Error('query failed', { cause: error }) : error;
      }
      deleted.push(table);
    } }),
  };
  return { store: new PostgresTemplateStore(db as never), deleted, locks,
    status(value: string) { status = value; }, versionStatus(value: string) { versionStatus = value; },
    referenced(value: unknown, wrap = false, code = '23503') { referenced = value; wrapped = wrap; referenceCode = code; } };
}

test('physical template deletion locks current template and versions and refuses a newly published version', async () => {
  const f = fixture(); f.versionStatus('published');
  await assert.rejects(f.store.deleteTemplate('template'), TemplateStoreConflictError);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.locks, [projectTemplates, projectTemplateVersions]);
});

test('historical reference failures roll back deletion; an unused draft deletes only its versions and template', async () => {
  const f = fixture(); f.referenced(projectTemplateVersions);
  await assert.rejects(f.store.deleteTemplate('template'), TemplateStoreConflictError);
  assert.deepEqual(f.deleted, []);
  f.referenced(null);
  assert.equal(await f.store.deleteTemplate('template'), true);
  assert.deepEqual(f.deleted, [pblTemplateTeamBindings, projectTemplateVersions, projectTemplates]);
});

test('archived published courses remove unused teaching configurations before deleting versions', async () => {
  const f = fixture(); f.status('archived'); f.versionStatus('published');
  assert.equal(await f.store.deleteTemplate('template'), true);
  assert.deepEqual(f.deleted, [pblTemplateTeamBindings, projectTemplateVersions, projectTemplates]);
  assert.deepEqual(f.locks, [projectTemplates, projectTemplateVersions]);
});

test('historical binding, version and course references roll back all deletion, including wrapped database errors', async () => {
  for (const table of [pblTemplateTeamBindings, projectTemplateVersions, projectTemplates]) {
    const f = fixture(); f.status('archived'); f.versionStatus('published'); f.referenced(table, true);
    let audited = false;
    await assert.rejects(f.store.deleteTemplate('template', async () => { audited = true; }), TemplateDeleteProtectedError);
    assert.deepEqual(f.deleted, []);
    assert.equal(audited, false);
  }
});

test('database rejects a course that was relisted before the deletion acquired its lock', async () => {
  const f = fixture(); f.status('piloting'); f.versionStatus('piloting');
  await assert.rejects(f.store.deleteTemplate('template'), TemplateDeleteProtectedError);
  assert.deepEqual(f.deleted, []);
});

test('RESTRICT violations also produce the protected-deletion error', async () => {
  const f = fixture(); f.status('archived'); f.versionStatus('published');
  f.referenced(pblTemplateTeamBindings, true, '23001');
  await assert.rejects(f.store.deleteTemplate('template'), TemplateDeleteProtectedError);
  assert.deepEqual(f.deleted, []);
});

test('audit failure rolls back physical deletion before commit', async () => {
  const f = fixture(); f.status('archived'); f.versionStatus('published');
  await assert.rejects(f.store.deleteTemplate('template', async tx => {
    assert.ok(tx); throw new Error('Synthetic audit failure');
  }), /audit failure/);
  assert.deepEqual(f.deleted, []);
});
