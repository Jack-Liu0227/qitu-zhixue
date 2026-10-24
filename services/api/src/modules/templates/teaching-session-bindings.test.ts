import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TeachingSessionAssignment } from '@qitu/contracts';
import { configurationAdmin, configurationBindingFixture } from './configuration-binding.test-fixture';
import { teamVersionContentDigest } from '../platform-registry/teaching-team-capture.service';
import { parseTeachingBundleDraft } from './templates-binding.controller';
import { parseSessionAssignments, requireSessionBindingAdmin, teachingBundleForSession } from './teaching-session-assignments';
import { teachingValueDigest } from './teaching-bundle.canonical';

test('one course freezes different published teams and assistant targets for individual lessons', async () => {
  const h = await configurationBindingFixture();
  const other = structuredClone(h.team);
  other.id = 'other-team-version'; other.teamId = 'different-team'; other.name = 'Other teaching team';
  other.leaderAssistantId = h.live.members.find(member => member.assistantId !== h.team.leaderAssistantId && member.assistantId !== 'qitu-intake-assistant')!.assistantId;
  other.pblSpec.teamVersionPublication = { ...other.pblSpec.teamVersionPublication!, digest: teamVersionContentDigest(other) };
  h.store.seedBindingTeams(h.binding.id, [h.team, other]);
  Object.assign(h.live.catalog, { bindings: h.store });
  const member = h.live.members.find(entry => entry.assistantId === h.team.leaderAssistantId)!;
  const assignments: TeachingSessionAssignment[] = h.template.curriculum!.profiles[0]!.sessions.map(session => session.sessionIndex === 2
    ? { sessionIndex: 2, teamVersionId: other.id, kind: 'team' }
    : { sessionIndex: session.sessionIndex, teamVersionId: h.team.id, kind: 'assistant', memberId: member.slotId });
  await h.bindings.prepareTeachingBundle(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id,
    h.draft.scheduleProfileId, 'prepare-sessions', undefined, assignments);
  const saved = (await h.bindings.listGovernedBindings(configurationAdmin, 'configuration-template', 'configuration-version'))[0]!.binding;
  assert.deepEqual(saved.bundleDraft!.sessionAssignments, assignments);
  assert.deepEqual(parseTeachingBundleDraft(saved.bundleDraft).sessionAssignments, assignments);
  const replay = await h.bindings.prepareTeachingBundle(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id,
    h.draft.scheduleProfileId, 'prepare-sessions', undefined, assignments);
  assert.equal(replay.replayed, true);
  assert.equal(h.audit.entries.filter(entry => entry.action === 'template.binding.bundle.save').length, 1);
  await h.bindings.validateBinding(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'validate-sessions');
  await h.bindings.activateBinding(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'activate-sessions');
  const binding = await h.store.findBinding(h.binding.id);
  const payload = binding!.bundlePayload!;
  assert.equal(payload.sessionTeamBundles!.length, 1);
  assert.equal(payload.sessionRoutes.length, assignments.length - 1);
  assert.equal(payload.sessionTeamBundles![0]!.sessionRoutes.length, 1);
  assert.equal(teachingBundleForSession(payload, 1).teamVersion.teamVersionId, h.team.id);
  assert.equal(teachingBundleForSession(payload, 2).teamVersion.teamVersionId, other.id);
  assert.equal(teachingBundleForSession(payload, 2).teamVersion.leaderAssistantId, other.leaderAssistantId);
  assert.equal(binding!.bundleDigest, teachingValueDigest(payload));
  const original = binding!.bundleDigest;
  const changed = structuredClone(payload);
  changed.sessionTeamBundles![0]!.roles = [];
  assert.notEqual(teachingValueDigest(changed), original, 'additional team capabilities are covered by the frozen digest');
  assert.deepEqual(payload.knowledgeGrant, null, 'selecting a team does not implicitly grant a knowledge base');
  assert.equal(h.audit.entries.some(entry => entry.action === 'template.binding.activate'), true);
  const mismatched = structuredClone(saved.bundleDraft!);
  mismatched.roleMap = mismatched.roleMap.map(role => ({ ...role, memberId: h.live.members.find(entry => entry.slotId !== role.memberId)!.slotId }));
  await assert.rejects(h.live.catalog.compile((await h.templates.findVersion('configuration-version'))!, h.team, mismatched), /SESSION_ASSIGNMENT_ROUTE_MISMATCH/);
});

test('assignment parser rejects duplicate, fractional, missing and mixed targets', () => {
  const valid = { sessionIndex: 1, teamVersionId: 'published-team', kind: 'team' };
  for (const invalid of [[], [valid, valid], [{ ...valid, sessionIndex: 1.5 }], [{ ...valid, sessionIndex: 0 }],
    [{ ...valid, kind: 'assistant' }], [{ ...valid, memberId: 'invented' }], [{ ...valid, teamVersionId: '' }], [{ ...valid, tools: ['write_database'] }]]) {
    assert.throws(() => parseSessionAssignments(invalid));
  }
});

test('lesson routing changes require Admin even for a teacher who can govern legacy templates', () => {
  assert.throws(() => requireSessionBindingAdmin({ ...configurationAdmin, role: 'teacher' }, []));
  assert.throws(() => requireSessionBindingAdmin({ ...configurationAdmin, role: 'student' }, []));
  assert.doesNotThrow(() => requireSessionBindingAdmin(configurationAdmin, []));
  assert.doesNotThrow(() => requireSessionBindingAdmin({ ...configurationAdmin, role: 'teacher' }, undefined));
});

test('incomplete lesson assignments and unpublished teams cannot compile', async () => {
  const h = await configurationBindingFixture();
  const version = (await h.templates.findVersion('configuration-version'))!;
  const partial = h.live.catalog.prepareDraft(version, h.team, h.draft.scheduleProfileId, undefined,
    [{ sessionIndex: 1, teamVersionId: h.team.id, kind: 'team' }]);
  await assert.rejects(h.live.catalog.compile(version, h.team, partial), /SESSION_ROUTE_INCOMPLETE/);
  const assignments = h.template.curriculum!.profiles[0]!.sessions.map(session => ({ sessionIndex: session.sessionIndex, teamVersionId: 'unknown-team', kind: 'team' as const }));
  const unknown = h.live.catalog.prepareDraft(version, h.team, h.draft.scheduleProfileId, undefined, assignments);
  await assert.rejects(h.live.catalog.compile(version, h.team, unknown), /TEAM_VERSION_UNAVAILABLE/);
});
