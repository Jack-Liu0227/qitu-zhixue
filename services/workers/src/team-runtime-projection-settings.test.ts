import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAssistants, type Database } from '@qitu/database';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { resolveProjectionAssistant } from './team-runtime-projection-settings';

function fixture() {
  const state = { settings: { profileAssistantId: 'custom-profile', growthAssistantId: 'custom-growth' } as unknown, admin: true, runtime: true, revision: 4 };
  const queriedIds: unknown[] = [];
  const db = {
    execute: async () => ({ rows: [{ revision: state.revision, config: { growthProjection: state.settings } }] }),
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
      queriedIds.push(new PgDialect().sqlToQuery(condition).params[0]);
      return { limit: async () => [{ enabled: table === adminAssistants ? state.admin : state.runtime }] };
    } }) }),
  } as unknown as Database;
  return { state, db, queriedIds };
}

test('worker uses exact configured identities and rereads global bindings for each job', async () => {
  const f = fixture();
  assert.deepEqual(await resolveProjectionAssistant(f.db, 'learner_profile'), { agentId: 'custom-profile', revision: 4 });
  assert.deepEqual(await resolveProjectionAssistant(f.db, 'growth_trajectory'), { agentId: 'custom-growth', revision: 4 });
  f.state.settings = { profileAssistantId: 'new-profile', growthAssistantId: null };
  f.state.revision = 5;
  assert.deepEqual(await resolveProjectionAssistant(f.db, 'learner_profile'), { agentId: 'new-profile', revision: 5 });
  assert.deepEqual(f.queriedIds, ['custom-profile', 'custom-profile', 'custom-growth', 'custom-growth', 'new-profile', 'new-profile']);
});

test('missing, incomplete and revoked purpose configurations fail closed', async () => {
  const f = fixture();
  for (const settings of [undefined, {}, { profileAssistantId: null, growthAssistantId: null }, { profileAssistantId: 'custom-profile' }]) {
    f.state.settings = settings;
    await assert.rejects(resolveProjectionAssistant(f.db, 'learner_profile'), /PROJECTION_PURPOSE_UNCONFIGURED/);
  }
  f.state.settings = { profileAssistantId: 'custom-profile', growthAssistantId: null };
  f.state.admin = false;
  await assert.rejects(resolveProjectionAssistant(f.db, 'learner_profile'), /PROJECTION_ASSISTANT_UNAVAILABLE/);
  f.state.admin = true;
  f.state.runtime = false;
  await assert.rejects(resolveProjectionAssistant(f.db, 'learner_profile'), /PROJECTION_ASSISTANT_UNAVAILABLE/);
});
