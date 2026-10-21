import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTemplates, projectTemplateVersions } from '@qitu/database';
import { PostgresTemplateStore } from './templates.store.postgres';
import { TemplateStoreConflictError } from './templates.store';

function fixture() {
  let status = 'draft'; let versionStatus = 'draft'; let referenced = false;
  const deleted: unknown[] = []; const locks: unknown[] = [];
  const db = {
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => {
      const snapshot = [...deleted];
      try { return await run(db); }
      catch (error) { deleted.splice(0, deleted.length, ...snapshot); throw error; }
    },
    select: () => ({ from: (table: unknown) => ({ where: () => ({ for: async () => {
      locks.push(table); return [{ status: table === projectTemplates ? status : versionStatus }];
    } }) }) }),
    delete: (table: unknown) => ({ where: async () => {
      if (referenced && table === projectTemplateVersions) throw Object.assign(new Error('synthetic foreign key'), { code: '23503' });
      deleted.push(table);
    } }),
  };
  return { store: new PostgresTemplateStore(db as never), deleted, locks,
    status(value: string) { status = value; }, versionStatus(value: string) { versionStatus = value; }, referenced(value: boolean) { referenced = value; } };
}

test('physical template deletion locks current template and versions and refuses a newly published version', async () => {
  const f = fixture(); f.versionStatus('published');
  await assert.rejects(f.store.deleteTemplate('template'), TemplateStoreConflictError);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.locks, [projectTemplates, projectTemplateVersions]);
});

test('historical reference failures roll back deletion; an unused draft deletes only its versions and template', async () => {
  const f = fixture(); f.referenced(true);
  await assert.rejects(f.store.deleteTemplate('template'), TemplateStoreConflictError);
  assert.deepEqual(f.deleted, []);
  f.referenced(false);
  assert.equal(await f.store.deleteTemplate('template'), true);
  assert.deepEqual(f.deleted, [projectTemplateVersions, projectTemplates]);
});

test('audit failure rolls back physical deletion before commit', async () => {
  const f = fixture();
  await assert.rejects(f.store.deleteTemplate('template', async tx => {
    assert.ok(tx); throw new Error('Synthetic audit failure');
  }), /audit failure/);
  assert.deepEqual(f.deleted, []);
});
