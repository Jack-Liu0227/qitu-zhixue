import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAssistants, adminTeamMembers, adminTeams, agentConfigs, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { FakeIdempotencyStore } from '../templates/templates.test-support';
import { TeachingTeamCaptureService, parseTeamVersionPublish, teamVersionView } from './teaching-team-capture.service';
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
  const rows: Array<{table: unknown; row: Record<string, unknown>}> = [];
  const audits: unknown[] = [];
  const team = { id: 'team', name: 'Team', description: 'Fixture', workspaceMode: 'shared', sessionMode: 'supervised',
    leaderAssistantId: 'coach', enabled: true, updatedAt: new Date('2026-10-21T00:00:00.000Z'), pblSpec: null as Record<string, unknown> | null };
  const values = (table: unknown) => table === adminTeams ? [team] : table === adminAssistants ? [{ id: 'coach', enabled: true, mcpServerIds: [] }]
    : table === adminTeamMembers ? [{ slotId: 'slot', teamId: 'team', assistantId: 'coach', role: 'leader', roleLabel: 'Guide', pblPhase: 'exploration' }] : [];
  const db = { select: () => ({ from: (table: unknown) => {
    const query = { where() { return this; }, orderBy() { return this; }, for() { return this; }, limit() { return this; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(values(table)).then(resolve); } }; return query;
  } }), insert: (table: unknown) => ({ values: async (row: Record<string, unknown>) => { rows.push({ table, row }); } }),
    update: () => ({ set: () => ({ where: async () => undefined }) }), delete: () => ({ where: async () => undefined }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as Database;
  const service = new TeachingTeamCaptureService(db, { getAssistantRuntime: async () => structuredClone(runtime) } as unknown as PlatformRegistryService,
    new FakeIdempotencyStore(), { write: async entry => { audits.push(entry); return 'audit'; } } as AuditWriter);
  return { service, team, rows, audits, runtime: (next: EffectiveAgentRuntime) => { runtime=next; } };
}

test('capture returns frozen source for a binding with no separately persisted team resource', async () => {
  const h=fixture(); const input={ expectedUpdatedAt: h.team.updatedAt.toISOString() };
  const first=await h.service.capture(admin,'team',input,'arrangement');
  const replay=await h.service.capture(admin,'team',input,'arrangement');
  assert.deepEqual(first,replay); assert.equal(h.audits.length,1);
  assert.equal(first.createdAt instanceof Date,true);
  assert.equal(teamVersionView(first).runtimeSnapshotStatus,'published');
  assert.equal(h.team.pblSpec,null);
  assert.ok(h.rows.some(entry=>entry.table===agentConfigs));
  assert.ok(h.rows.every(entry=>entry.row.id!==first.id), 'no independent snapshot resource is written');
  const changed=syntheticRuntime(); changed.agent.agentDefinition='New policy';h.runtime(changed);
  const next=await h.service.capture(admin,'team',input,'new-arrangement');
  assert.notEqual(first.id,next.id);
  assert.notEqual(teamVersionView(first).snapshotDigest,teamVersionView(next).snapshotDigest);
  assert.deepEqual(await h.service.capture(admin,'team',input,'arrangement'),first);
  (first.members[0] as Record<string,unknown>).role='tampered';
  assert.throws(()=>teamVersionView(first));
});

test('capture validates source revision, permission, safety gates and server-owned input', async () => {
  const h=fixture(); const input={ expectedUpdatedAt: h.team.updatedAt.toISOString() };
  assert.throws(()=>parseTeamVersionPublish({...input,runtimeSnapshot:{}}));
  for(const role of ['student','teacher','parent'] as const) await assert.rejects(h.service.capture({...admin,role},'team',input,role));
  await assert.rejects(h.service.capture(admin,'team',{expectedUpdatedAt:'2026-10-20'},'stale'));
  h.team.enabled=false;await assert.rejects(h.service.capture(admin,'team',input,'disabled'));
  h.team.enabled=true;h.team.pblSpec={theoryMasteredGate:false,allowAutonomousAdvance:true};
  await assert.rejects(h.service.capture(admin,'team',input,'unsafe'));
  const absent=new TeachingTeamCaptureService(null,{} as PlatformRegistryService,new FakeIdempotencyStore(),{} as AuditWriter);
  await assert.rejects(absent.capture(admin,'team',input,'storage'));
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

