import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftFromPublishedTeam } from './teaching-bundle.draft';
import { configurationAdmin, configurationBindingFixture } from './configuration-binding.test-fixture';

test('preparing a draft persists exact published identities and survives a separate list read', async () => {
  const h = await configurationBindingFixture();
  const args = [configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, h.draft.scheduleProfileId, 'prepare'] as const;
  await h.bindings.prepareTeachingBundle(...args);
  const first = (await h.bindings.listGovernedBindings(configurationAdmin, 'configuration-template', 'configuration-version'))[0]!;
  assert.deepEqual(first.binding.bundleDraft, h.draft);
  assert.ok(first.binding.bundleDraft);
  assert.equal(first.binding.status, 'draft');
  assert.equal(first.binding.bundleDigest, null);
  assert.equal(first.team?.runtimeSnapshotStatus, 'published');
  assert.equal(first.binding.bundleDraft.sessionRoutes?.length, 16);
  assert.deepEqual(first.binding.bundleDraft.knowledgeBaseIds, []);
  assert.deepEqual(first.binding.bundleDraft.mcpServerIds, []);
  first.binding.bundleDraft.roleMap = [];
  const reloaded = (await h.bindings.listGovernedBindings(configurationAdmin, 'configuration-template', 'configuration-version'))[0]!;
  assert.equal(reloaded.binding.bundleDraft?.roleMap.length, h.draft.roleMap.length);
  assert.equal((await h.bindings.prepareTeachingBundle(...args)).replayed, true);
  await h.bindings.validateBinding(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'validate');
  assert.equal((await h.bindings.activateBinding(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'activate')).binding.status, 'active');
});

test('draft generation refuses legacy teams, unspecified multi-profile schedules and guessed assistants', async () => {
  const h = await configurationBindingFixture();
  const generate = () => draftFromPublishedTeam('configuration-version', h.template, h.team, h.draft.approvalPolicyVersion);
  const publication = h.team.pblSpec.teamVersionPublication;
  delete h.team.pblSpec.teamVersionPublication;
  assert.throws(generate, /请先生成并选择已发布/);
  h.team.pblSpec.teamVersionPublication = publication;
  const profiles = h.template.curriculum!.profiles;
  h.template.curriculum = { profiles: [...profiles, { ...profiles[0]!, id: 'other-profile' }] };
  assert.throws(generate, /明确课时排期/);
  h.template.curriculum = { profiles };
  const explicitAssignments = Object.fromEntries(h.template.phases.map((phase) => [phase.phase,
    h.live.members.find((member) => member.assistantId === phase.assignedAssistantId)!.slotId]));
  const unassigned = { ...h.template, phases: h.template.phases.map((phase) => ({ ...phase, assignedAssistantId: null })) };
  assert.throws(() => draftFromPublishedTeam('configuration-version', unassigned, h.team, h.draft.approvalPolicyVersion), /没有明确匹配/);
  assert.equal(draftFromPublishedTeam('configuration-version', unassigned, h.team, h.draft.approvalPolicyVersion,
    profiles[0]!.id, explicitAssignments).sessionRoutes?.length, 16);
  h.template.phases = h.template.phases.map((phase) => ({ ...phase, assignedAssistantId: 'unrelated-assistant' }));
  assert.throws(generate, /没有明确匹配/);
});

test('preparing a draft cannot silently overwrite an existing knowledge scope or edit an active binding', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  await assert.rejects(h.bindings.prepareTeachingBundle(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, h.draft.scheduleProfileId, 'late'));
  const readback = await h.bindings.getTeachingBundle(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id);
  assert.deepEqual(readback.draft, h.draft);
});
