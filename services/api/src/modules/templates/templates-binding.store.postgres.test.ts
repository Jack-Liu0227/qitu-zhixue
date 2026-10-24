import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresTemplateBindingStore } from './templates-binding.store.postgres';
import type { Database } from '@qitu/database';
import type { BindingRecord, TeamVersionRecord } from './templates-binding.types';

test('stored teaching configuration resolves only inside the requested binding', async () => {
  const store = new PostgresTemplateBindingStore({} as Database);
  const team = { id: 'frozen-a', name: 'Original configuration' } as TeamVersionRecord;
  const reads: string[] = [];
  store.findBinding = async (id: string) => {
    reads.push(id);
    return { teamSnapshots: id === 'binding-a' ? { 'frozen-a': team } : {} } as BindingRecord;
  };
  assert.equal(await store.findTeamVersion('frozen-a'), null);
  assert.deepEqual(reads, []);
  assert.equal(await store.findTeamVersion('frozen-a', 'binding-b'), null);
  assert.deepEqual(await store.findTeamVersion('frozen-a', 'binding-a'), team);
  assert.equal(await store.findTeamVersion('frozen-other', 'binding-a'), null);
});
