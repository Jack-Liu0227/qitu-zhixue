import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { adminAssistants, adminTeamMembers, adminTeams, adminTeamVersions, agentConfigs, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { FakeIdempotencyStore } from '../templates/templates.test-support';
import { TeamVersionService, parseTeamVersionPublish, teamVersionView } from './team-version.service';
import { freezeTeamAssistant, readPublishedAssistant, publishedRuntimeSource } from './team-version.snapshot';
import type { EffectiveAgentRuntime, PlatformRegistryService } from './platform-registry.service';
import { builtinToolRegistry } from './built-in-tools';

const admin: CurrentUser = { id: 'admin-fixture', role: 'admin', displayName: 'Admin', email: 'fixture@example.invalid' };
export function syntheticRuntime(): EffectiveAgentRuntime {
  return { agent: { id: 'coach', label: 'Coach', description: '', role: 'coach', roleDefinition: 'Guide inquiry', agentDefinition: 'Original policy',
    parentAgentId: null, enabled: true, status: 'enabled', modelProviderId: 'provider', modelId: 'model-a', modelLabel: 'A',
    modelAvailable: true, promptVersion: 'v1', capabilities: ['teach'], skillIds: ['published-skill'], toolIds: ['tutor.context_packet'], mcpServerIds: [], mcpToolIds: {} },
    policy: { id: 'AGENTS.md', version: 'policy-v1', contentHash: 'a'.repeat(64), status: 'ready', content: 'Policy' },
    skills: [{ id: 'published-skill', label: 'Skill', description: '', version: '1.0.0', contentHash: 'b'.repeat(64), status: 'ready', content: 'Teach', runtime: 'teaching', publicationStatus: 'published' }],
    tools: builtinToolRegistry.listForAgentIds(['tutor.context_packet']), mcpServers: [] };
}
function fixture() {
  let runtime = syntheticRuntime();
  let readsUnavailable = false;
  let insideTransaction = false;
  let writes = 0;
  const audits: unknown[] = [];
  const runtimeInserts: Array<{ table: unknown; row: unknown }> = [];
  const now = new Date('2026-10-21T00:00:00.000Z');
  const team = { id: 'team', name: 'Team', description: 'Fixture', workspaceMode: 'shared', sessionMode: 'supervised',
    leaderAssistantId: 'coach', enabled: true, updatedAt: now, pblSpec: { theoryMasteredGate: true, allowAutonomousAdvance: false, phases: [] } };
  const versions: Array<typeof adminTeamVersions.$inferSelect> = [];
  const tableRows = (table: unknown): unknown[] => table === adminTeams ? [team] : table === adminTeamVersions ? versions : table === adminAssistants ?
    [{ id: 'coach', enabled: true, mcpServerIds: [] }] : table === adminTeamMembers ?
      [{ slotId: 'slot', teamId: 'team', assistantId: 'coach', role: 'leader', roleLabel: 'Guide', pblPhase: 'exploration' }] : [];
  const dialect = new PgDialect();
  const db = {
    select: () => ({ from: (table: unknown) => {
      let predicate: { sql: string; params: unknown[] } | undefined;
      let limit = Infinity;
      const builder = {
        where(query: Parameters<PgDialect['sqlToQuery']>[0]) { predicate = dialect.sqlToQuery(query); return this; },
        orderBy() { return this; }, for() { return this; }, limit(value: number) { limit = value; return this; },
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          if (!insideTransaction && readsUnavailable && table === adminTeamVersions) return Promise.reject(new Error('read unavailable')).then(resolve, reject);
          const rows = tableRows(table).filter(raw => {
            if (!predicate) return true;
            const row = raw as Record<string, unknown>;
            const field = predicate.sql.includes('"team_id"') ? 'teamId' : predicate.sql.includes('"agent_id"') ? 'agentId' : 'id';
            return predicate.params.includes(row[field]);
          });
          if (table === adminTeamVersions) rows.sort((a, b) => (b as { version: number }).version - (a as { version: number }).version);
          return Promise.resolve(rows.slice(0, limit)).then(resolve, reject);
        },
      };
      return builder;
    } }),
    insert: (table: unknown) => ({ values: async (row: unknown) => {
      if (table === adminTeamVersions) {
        writes++;
        versions.push(structuredClone(row as typeof adminTeamVersions.$inferSelect));
      } else {
        runtimeInserts.push({ table, row: structuredClone(row) });
      }
    } }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      insideTransaction = true;
      const before = versions.length;
      try { return await callback(db); } catch (error) { versions.splice(before); throw error; } finally { insideTransaction = false; }
    },
  } as unknown as Database;
  const registry = { getAssistantRuntime: async () => structuredClone(runtime) } as unknown as PlatformRegistryService;
  const service = new TeamVersionService(db, registry, new FakeIdempotencyStore(), { write: async entry => { audits.push(entry); return 'audit'; } } as AuditWriter);
  return { service, team, versions, audits, runtime: (value: EffectiveAgentRuntime) => { runtime = value; },
    readFailure: (value: boolean) => { readsUnavailable = value; }, writes: () => writes, runtimeInserts };
}

test('publication only accepts a team revision; clients cannot supply their own frozen runtime', () => {
  assert.deepEqual(parseTeamVersionPublish({ expectedUpdatedAt: '2026-10-21T00:00:00.000Z' }), { expectedUpdatedAt: '2026-10-21T00:00:00.000Z' });
  for (const body of [{ expectedUpdatedAt: 'invalid' }, { expectedUpdatedAt: '2026-10-21', runtimeSnapshot: {} }, null]) assert.throws(() => parseTeamVersionPublish(body));
});

test('published team versions preserve source prompts/models and publish later changes into a new version', async () => {
  const h = fixture();
  const first = await h.service.publish(admin, 'team', { expectedUpdatedAt: h.team.updatedAt.toISOString() }, 'first');
  const changed = syntheticRuntime(); changed.agent.agentDefinition = 'New policy'; changed.agent.modelId = 'model-b';
  h.runtime(changed); h.team.updatedAt = new Date('2026-10-21T01:00:00.000Z');
  const second = await h.service.publish(admin, 'team', { expectedUpdatedAt: h.team.updatedAt.toISOString() }, 'second');
  assert.equal(first.version, 1); assert.equal(second.version, 2); assert.notEqual(first.snapshotDigest, second.snapshotDigest);
  const old = await h.service.read(admin, 'team', first.id);
  const snapshot = (old.members[0] as { runtimeSnapshot: ReturnType<typeof freezeTeamAssistant> }).runtimeSnapshot;
  assert.equal(snapshot.agentDefinition, 'Original policy'); assert.equal(snapshot.model.modelId, 'model-a');
  assert.equal(old.runtimeSnapshotStatus, 'published'); assert.equal(h.audits.length, 2);
});

test('publication projects every frozen member into the Team Runtime agent registry', async () => {
  const h = fixture();
  await h.service.publish(admin, 'team', { expectedUpdatedAt: h.team.updatedAt.toISOString() }, 'runtime-projection');
  const projected = h.runtimeInserts.filter((entry) => entry.table === agentConfigs).map((entry) => entry.row as Record<string, unknown>);
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.id, 'coach');
  assert.equal(projected[0]?.roleDefinition, 'Guide inquiry');
  assert.equal(projected[0]?.agentDefinition, 'Original policy');
  assert.equal(projected[0]?.modelProviderId, 'provider');
  assert.equal(projected[0]?.modelId, 'model-a');
  assert.equal(projected[0]?.enabled, true);
  assert.deepEqual(projected[0]?.capabilities, ['teach']);
});

test('publication retries after readback failure never create another immutable version', async () => {
  const h = fixture(); const body = { expectedUpdatedAt: h.team.updatedAt.toISOString() };
  h.readFailure(true);
  await assert.rejects(h.service.publish(admin, 'team', body, 'read-retry'), /read unavailable/);
  h.readFailure(false);
  const result = await h.service.publish(admin, 'team', body, 'read-retry');
  assert.equal(result.version, 1); assert.equal(h.writes(), 1); assert.equal(h.audits.length, 1);
  await assert.rejects(h.service.publish(admin, 'team', { expectedUpdatedAt: '2026-10-21T02:00:00.000Z' }, 'read-retry'));
});

test('non-admin, stale revisions, disabled source and missing persistent storage fail closed', async () => {
  const h = fixture(); const input = { expectedUpdatedAt: h.team.updatedAt.toISOString() };
  for (const role of ['student', 'teacher', 'parent'] as const) await assert.rejects(h.service.publish({ ...admin, role }, 'team', input, role));
  await assert.rejects(h.service.publish(admin, 'team', { expectedUpdatedAt: '2026-10-20T00:00:00.000Z' }, 'stale'));
  h.team.enabled = false; await assert.rejects(h.service.publish(admin, 'team', input, 'disabled'));
  const absent = new TeamVersionService(null, {} as PlatformRegistryService, new FakeIdempotencyStore(), {} as AuditWriter);
  await assert.rejects(absent.publish(admin, 'team', input, 'no-database'));
  assert.equal(h.writes(), 0);
});

test('snapshot rejects admin or unpublished skills, missing model and unknown tool assignments', () => {
  for (const mutate of [
    (r: EffectiveAgentRuntime) => { r.skills[0]!.runtime = 'admin'; },
    (r: EffectiveAgentRuntime) => { r.skills[0]!.publicationStatus = 'quarantined'; },
    (r: EffectiveAgentRuntime) => { r.agent.modelAvailable = false; },
    (r: EffectiveAgentRuntime) => { r.agent.toolIds.push('unknown-tool'); },
  ]) { const runtime = syntheticRuntime(); mutate(runtime); assert.throws(() => freezeTeamAssistant(runtime)); }
});

test('current prompt/model changes do not rewrite published content while revocation immediately rejects it', () => {
  const original = syntheticRuntime(); const snapshot = freezeTeamAssistant(original);
  const changed = syntheticRuntime(); changed.agent.agentDefinition = 'New live prompt'; changed.agent.modelId = 'new-model';
  assert.equal(publishedRuntimeSource(snapshot, changed).agentDefinition, 'Original policy');
  changed.skills[0]!.contentHash = 'c'.repeat(64); assert.throws(() => publishedRuntimeSource(snapshot, changed));
  const disabled = syntheticRuntime(); disabled.agent.enabled = false; assert.throws(() => publishedRuntimeSource(snapshot, disabled));
  assert.throws(() => readPublishedAssistant({ ...snapshot, agentDefinition: 'tampered' }, 'coach'));
});

test('tampering with immutable member roles fails the version digest', async () => {
  const h = fixture(); await h.service.publish(admin, 'team', { expectedUpdatedAt: h.team.updatedAt.toISOString() }, 'tamper');
  (h.versions[0]!.members[0] as Record<string, unknown>).role = 'tampered';
  assert.throws(() => teamVersionView(h.versions[0]!));
});
