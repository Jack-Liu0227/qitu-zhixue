import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrepareTeachingArrangementInput } from '@qitu/contracts';
import { configurationAdmin, configurationBindingFixture } from './configuration-binding.test-fixture';
import { parseTeachingArrangement } from './teaching-arrangement.input';
import { teamVersionContentDigest, teamVersionView } from '../platform-registry/teaching-team-capture.service';
import { teachingValueDigest } from './teaching-bundle.canonical';
import type { PublishedAssistantSnapshot } from '../platform-registry/team-version.snapshot';

async function fixture() {
  const h = await configurationBindingFixture();
  const published = new Map<string, typeof h.team>();
  Object.assign(h.bindings, { teamCapture: { capture: async (_actor: unknown, teamId: string, request: { expectedUpdatedAt: string }, key: string) => {
    assert.equal(request.expectedUpdatedAt, h.team.createdAt.toISOString());
    if (!published.has(key)) {
      const next = structuredClone(h.team); next.id = `automatic-${key}`; next.teamId = teamId;
      next.pblSpec.teamVersionPublication = { ...next.pblSpec.teamVersionPublication!, digest: teamVersionContentDigest(next) };
      h.store.seedTeamVersion(next);
      published.set(key, next);
    }
    return published.get(key)!;
  } } });
  Object.assign(h.live.catalog, { bindings: h.store });
  const input: PrepareTeachingArrangementInput = { teamId: h.team.teamId, scheduleProfileId: h.draft.scheduleProfileId,
    teams: [h.team.teamId, 'another-managed-team'].map(teamId => ({ teamId, expectedUpdatedAt: h.team.createdAt.toISOString() })),
    sessions: h.template.curriculum!.profiles[0]!.sessions.map(session => ({ sessionIndex: session.sessionIndex,
      teamId: session.sessionIndex === 2 ? 'another-managed-team' : h.team.teamId,
      kind: 'assistant', assistantId: h.team.leaderAssistantId })) };
  return { ...h, input, published };
}

test('existing teams and assistant IDs save without client version IDs, preserve scope, and replay after readback', async () => {
  const h = await fixture();
  await h.bindings.saveTeachingBundleDraft(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id,
    { ...h.draft, knowledgeBaseIds: ['explicit-existing-library'] }, 'source-scope');
  const source = (await h.store.findBinding(h.binding.id))!;
  h.input.sourceBinding = { id: source.id, updatedAt: source.updatedAt.toISOString() };
  const saved = await h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'arrangement');
  assert.notEqual(saved.binding.id, source.id);
  assert.equal(h.published.size, 2);
  assert.equal(saved.binding.bundleDraft!.sessionAssignments!.length, h.input.sessions.length);
  assert.deepEqual(saved.binding.bundleDraft!.knowledgeBaseIds, ['explicit-existing-library']);
  assert.equal(saved.binding.status, 'draft');
  const replay = await h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'arrangement');
  assert.equal(replay.binding.id, saved.binding.id); assert.equal(replay.replayed, true); assert.equal(h.published.size, 2);
  assert.deepEqual(await h.store.findBinding(source.id), source, 'the source binding remains unchanged');
  const readback = await h.bindings.listGovernedBindings(configurationAdmin, 'configuration-template', 'configuration-version');
  assert.deepEqual(readback.find(row => row.binding.id === saved.binding.id)!.binding.bundleDraft, saved.binding.bundleDraft);
});

test('retry after an interrupted binding save reuses automatic team snapshots and the created binding', async () => {
  const h = await fixture();
  const save = h.bindings.saveTeachingBundleDraft.bind(h.bindings);
  let interrupted = false;
  h.bindings.saveTeachingBundleDraft = async (...args) => { if (!interrupted) { interrupted = true; throw new Error('Interrupted fixture save'); } return save(...args); };
  await assert.rejects(h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'recover'), /Interrupted/);
  const saved = await h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'recover');
  assert.ok(saved.binding.bundleDraft); assert.equal(h.published.size, 2);
  assert.equal(h.audit.entries.filter(entry => entry.action === 'template.binding.create').length, 2, 'one fixture binding and one new arrangement');
});

test('snapshot readback isolates damaged history and verifies only the selected binding', async () => {
  const h = await fixture();
  const damaged = structuredClone(h.team); damaged.name = 'Altered historical snapshot';
  h.store.seedBindingTeams(h.binding.id, [damaged]);
  const old = await h.bindings.getTeachingTeamSnapshots(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id);
  assert.equal(old.versions.length, 0); assert.equal(old.issues.length, 1);
  const saved = await h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'fresh-arrangement');
  const fresh = await h.bindings.getTeachingTeamSnapshots(configurationAdmin, 'configuration-template', 'configuration-version', saved.binding.id);
  assert.equal(fresh.versions.length, 2); assert.deepEqual(fresh.issues, []);
  await assert.rejects(h.bindings.getTeachingTeamSnapshots({ ...configurationAdmin, role: 'teacher' }, 'configuration-template', 'configuration-version', saved.binding.id));
});

test('changing team slots retains only existing knowledge tools permitted by the selected assistants', async () => {
  const h = await fixture();
  const sourceDraft = { ...h.draft, mcpServerIds: ['ima-knowledge'], knowledgeBaseIds: ['approved-library'],
    toolIds: h.draft.roleMap.map(role => ({ roleSlotId: role.roleSlotId, toolId: 'ima_search_knowledge' })) };
  await h.bindings.saveTeachingBundleDraft(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, sourceDraft, 'old-scope');
  const source = (await h.store.findBinding(h.binding.id))!;
  h.input.sourceBinding = { id: source.id, updatedAt: source.updatedAt.toISOString() };
  for (const raw of h.team.members) {
    const member = raw as { slotId: string; runtimeSnapshot: PublishedAssistantSnapshot };
    member.slotId = `new-${member.slotId}`;
    const { digest: _digest, ...payload } = member.runtimeSnapshot;
    payload.mcpPermissions = [{ serverId: 'ima-knowledge', toolIds: ['ima_search_knowledge', 'ima_read_document'] }];
    member.runtimeSnapshot = { ...payload, digest: teachingValueDigest(payload) };
  }
  const saved = await h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version', h.input, 'new-slots');
  const draft = saved.binding.bundleDraft!;
  assert.deepEqual(draft.knowledgeBaseIds, ['approved-library']);
  assert.ok(draft.roleMap.every(role => draft.toolIds.some(tool => tool.roleSlotId === role.roleSlotId && tool.toolId === 'ima_search_knowledge')));
  assert.ok(!draft.toolIds.some(tool => tool.toolId === 'ima_read_document'), 'newly available tools do not expand the retained scope');
});

test('unrelated assistants, stale source configurations and non-admin writes fail closed', async () => {
  const h = await fixture();
  await assert.rejects(h.bindings.prepareCurrentTeams({ ...configurationAdmin, role: 'teacher' }, 'configuration-template', 'configuration-version', h.input, 'teacher'));
  assert.equal(h.published.size, 0);
  await assert.rejects(h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version',
    { ...h.input, sourceBinding: { id: h.binding.id, updatedAt: '2000-01-01T00:00:00Z' } }, 'stale'));
  assert.equal(h.published.size, 0);
  await assert.rejects(h.bindings.prepareCurrentTeams(configurationAdmin, 'configuration-template', 'configuration-version',
    { ...h.input, sessions: h.input.sessions.map(item => ({ ...item, kind: 'assistant', assistantId: 'not-a-member' })) }, 'outsider'));
  assert.equal(h.audit.entries.filter(entry => entry.action === 'template.binding.create').length, 1);
});

test('the current-team input rejects client snapshots, duplicate lessons and mismatched revision scopes', () => {
  const valid = { teamId: 'team', scheduleProfileId: 'profile', sessions: [{ sessionIndex: 1, teamId: 'team', kind: 'team' }],
    teams: [{ teamId: 'team', expectedUpdatedAt: '2026-10-23T00:00:00Z' }] };
  assert.deepEqual(parseTeachingArrangement(valid), valid);
  for (const invalid of [{ ...valid, teamVersionId: 'injected' }, { ...valid, sessions: [...valid.sessions, ...valid.sessions] },
    { ...valid, teams: [] }, { ...valid, sessions: [{ ...valid.sessions[0], kind: 'assistant' }] },
    { ...valid, sessions: [{ ...valid.sessions[0], sessionIndex: 1.5 }] }]) assert.throws(() => parseTeachingArrangement(invalid));
});
