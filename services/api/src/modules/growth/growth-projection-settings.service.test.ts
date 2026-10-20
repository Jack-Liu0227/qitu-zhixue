import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAssistants, agentConfigs, type Database } from '@qitu/database';
import { parseGrowthProjectionSettings, type CurrentUser } from '@qitu/contracts';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import { GrowthProjectionSettingsService } from './growth-projection-settings.service';
import { GrowthProjectionSettingsController } from './growth-projection-settings.controller';

const actor = { id: 'admin', role: 'admin' } as CurrentUser;
const settings = { profileAssistantId: 'profile', growthAssistantId: 'growth' };

function fixture() {
  type Row = { revision: number; config: Record<string, unknown>; actor?: string; key?: string; request_hash?: string };
  const revisions: Row[] = [{ revision: 1, config: { mcpServers: { keep: true }, knowledgeEngines: {}, platformTools: {} } }];
  const assistants = [{ id: 'profile', name: 'Profile', enabled: true }, { id: 'growth', name: 'Growth', enabled: true }, { id: 'unpublished', name: 'Draft', enabled: true }];
  const agents = [{ id: 'profile', enabled: true }, { id: 'growth', enabled: true }];
  const audits: unknown[] = [];
  const query = async (query: SQL) => {
    const { sql: text, params } = new PgDialect().sqlToQuery(query);
    if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (text.startsWith('INSERT')) {
      revisions.push({ revision: params[0] as number, config: JSON.parse(params[2] as string), actor: params[3] as string, key: params[4] as string, request_hash: params[5] as string });
      return { rows: [] };
    }
    if (text.includes('WHERE updated_by=')) return { rows: revisions.filter((row) => row.actor === params[0] && row.key === params[1]) };
    if (text.includes('WHERE revision=')) return { rows: revisions.filter((row) => row.revision === params[0]) };
    return { rows: [revisions.at(-1)!] };
  };
  const db = {
    execute: query,
    select: () => ({ from: async (table: unknown) => table === adminAssistants ? assistants : table === agentConfigs ? agents : [] }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const saved = structuredClone(revisions);
      try { return await fn(db); } catch (error) { revisions.splice(0, revisions.length, ...saved); throw error; }
    },
  } as unknown as Database;
  const knowledge = { configuration: async () => revisions.at(-1)! } as unknown as KnowledgeCenterService;
  const audit = { write: async (entry: unknown) => { audits.push(entry); return 'audit'; } } as AuditWriter;
  return { service: new GrowthProjectionSettingsService(db, knowledge, audit), revisions, assistants, agents, audits };
}

test('missing settings are explicitly unconfigured and directory requires both enabled identities', async () => {
  const f = fixture();
  const initial = await f.service.read();
  assert.deepEqual(initial.settings, { profileAssistantId: null, growthAssistantId: null });
  assert.deepEqual(initial.readiness, { profile: 'unconfigured', growth: 'unconfigured' });
  assert.deepEqual(initial.assistants.map((assistant) => assistant.id), ['growth', 'profile']);
  assert.equal(initial.pendingPolicy, 'proposed');
  f.agents[0]!.enabled = false;
  assert.deepEqual((await f.service.read()).assistants.map((assistant) => assistant.id), ['growth']);
});

test('purpose save preserves platform config, persists exact IDs, audits and replays idempotently', async () => {
  const f = fixture();
  const input = { expectedRevision: 1, settings };
  const saved = await f.service.save(actor, input, 'request-1');
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.settings, settings);
  assert.deepEqual(saved.readiness, { profile: 'ready', growth: 'ready' });
  assert.deepEqual(f.revisions[1]!.config.mcpServers, { keep: true });
  assert.equal(f.audits.length, 1);
  assert.deepEqual(await f.service.save(actor, input, 'request-1'), saved);
  assert.equal(f.revisions.length, 2);
  assert.equal(f.audits.length, 1);
  await assert.rejects(f.service.save(actor, { expectedRevision: 2, settings }, 'request-1'), /IDEMPOTENCY_KEY_CONFLICT/);
  await assert.rejects(f.service.save(actor, input, 'request-2'), (error: unknown) => JSON.stringify(error).includes('CONFIG_REVISION_CONFLICT'));
});

test('disabled or nonexistent runtime identity cannot be bound and revocation is visible', async () => {
  const f = fixture();
  await assert.rejects(f.service.save(actor, { expectedRevision: 1, settings: { ...settings, profileAssistantId: 'unpublished' } }, 'missing'), /GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE/);
  f.assistants[0]!.enabled = false;
  await assert.rejects(f.service.save(actor, { expectedRevision: 1, settings }, 'disabled'), /GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE/);
  f.assistants[0]!.enabled = true;
  await f.service.save(actor, { expectedRevision: 1, settings }, 'enabled');
  f.agents[0]!.enabled = false;
  assert.equal((await f.service.read()).readiness.profile, 'disabled_or_missing');
});

test('settings reject unknown fields, incomplete IDs, unauthorized roles and missing idempotency key', async () => {
  const f = fixture();
  assert.equal(parseGrowthProjectionSettings({ ...settings, modelId: 'unapproved' }), null);
  assert.equal(parseGrowthProjectionSettings({ profileAssistantId: 'profile' }), null);
  await assert.rejects(f.service.save({ ...actor, role: 'student' }, { expectedRevision: 1, settings }, 'key'), /GROWTH_PROJECTION_ADMIN_REQUIRED/);
  await assert.rejects(f.service.save(actor, { expectedRevision: 1, settings }, ''), /IDEMPOTENCY_KEY_REQUIRED/);
  await assert.rejects(f.service.save(actor, { expectedRevision: 1, settings, extra: true }, 'key'), /GROWTH_PROJECTION_SETTINGS_INVALID/);
  assert.equal(f.revisions.length, 1);
});

test('both settings HTTP operations require Admin authentication', async () => {
  const auth = { getSession: () => ({ user: { id: 'student', role: 'student' } }) };
  const controller = new GrowthProjectionSettingsController(fixture().service, auth as never);
  await assert.rejects(controller.read(undefined), (error: unknown) => (error as { status: number }).status === 401);
  await assert.rejects(controller.read('qitu_session=student'), (error: unknown) => (error as { status: number }).status === 403);
  await assert.rejects(controller.save('qitu_session=student', 'key', { expectedRevision: 1, settings }), (error: unknown) => (error as { status: number }).status === 403);
});
