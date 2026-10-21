import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeachingBundleDraft } from '@qitu/contracts';
import type { PublishedTeamMember } from '../../api/template-bindings';
import { parseDraftPreview, routeSession, routeSessionToMember, togglePublishedSkill, togglePublishedTool } from './model';

const member = {
  slotId: 'member-b', assistantId: 'assistant-b', roleLabel: 'Inquiry guide', runtimeSnapshot: {
    model: { modelProviderId: 'provider-b', modelId: 'shared-name' },
    skills: [{ canonicalId: 'pbl-cer-coach', version: '2.0.0', packageDigest: 'b'.repeat(64) }],
    tools: [{ toolId: 'lesson.activity', handlerVersion: 'v1', schemaDigest: 'c'.repeat(64) }],
    mcpPermissions: [{ serverId: 'ima-knowledge', toolIds: ['ima_search_knowledge'] }],
  },
} satisfies PublishedTeamMember;

function draft(): TeachingBundleDraft {
  return {
    templateVersionId: 'template-v1', teamVersionId: 'team-v3', scheduleProfileId: 'schedule-4', approvalPolicyVersion: 'policy-v1',
    roleMap: [{ roleSlotId: 'role-a', memberId: 'member-a', purposes: ['dialogue'] }],
    sessionRoutes: [{ sessionIndex: 7, roleSlotId: 'role-a' }, { sessionIndex: 11, roleSlotId: 'role-a' }],
    modelByPurpose: { 'role-a': { dialogue: { modelProviderId: 'provider-a', modelId: 'shared-name' } } },
    skillPins: [{ roleSlotId: 'role-a', canonicalId: 'existing-skill', version: '1.0.0', packageDigest: 'a'.repeat(64) }],
    toolIds: [], mcpServerIds: [], knowledgeBaseIds: ['kb-existing'],
  };
}

test('preview keeps invalid JSON intact and rejects malformed role/model fields', () => {
  const text = '{"roleMap": [invalid';
  const invalid = parseDraftPreview(text);
  assert.equal(invalid.kind, 'invalid');
  assert.equal(text, '{"roleMap": [invalid');
  assert.equal(parseDraftPreview('').kind, 'empty');
  assert.equal(parseDraftPreview(JSON.stringify(draft())).kind, 'ready');
  assert.equal(parseDraftPreview(JSON.stringify({ ...draft(), roleMap: [{ roleSlotId: 'role-a', memberId: 'member-a', purposes: ['mark_mastered'] }] })).kind, 'invalid');
  assert.equal(parseDraftPreview(JSON.stringify({ ...draft(), modelByPurpose: { 'role-a': { dialogue: { modelId: 'shared-name' } } } })).kind, 'invalid');
  assert.equal(parseDraftPreview(JSON.stringify({ ...draft(), sessionRoutes: [{ sessionIndex: 1.5, roleSlotId: 'role-a' }] })).kind, 'invalid');
});

test('lesson reassignment preserves real indexes, independent routes and provider/model pairs', () => {
  const original = draft();
  const next = routeSessionToMember(original, 7, member);
  assert.deepEqual(next.sessionRoutes, [{ sessionIndex: 7, roleSlotId: 'member-b' }, { sessionIndex: 11, roleSlotId: 'role-a' }]);
  assert.deepEqual(next.modelByPurpose['member-b']?.dialogue, member.runtimeSnapshot.model);
  assert.equal(next.modelByPurpose['role-a']?.dialogue?.modelProviderId, 'provider-a');
  assert.deepEqual(next.skillPins.find((pin) => pin.roleSlotId === 'member-b'), { roleSlotId: 'member-b', ...member.runtimeSnapshot.skills[0] });
  assert.deepEqual(next.knowledgeBaseIds, original.knowledgeBaseIds);
  assert.deepEqual(next.mcpServerIds, [], 'Assigning a teacher does not grant an MCP server');
  assert.equal(original.roleMap.length, 1, 'The original saved draft is immutable');
  assert.equal(routeSessionToMember(next, 11, member).roleMap.length, 2, 'Reassignment reuses the same role');
});

test('unknown roles, legacy members and invalid indexes cannot create routes', () => {
  const original = draft();
  assert.equal(routeSession(original, 7, 'guessed-role'), original);
  assert.equal(routeSession(original, 0, 'role-a'), original);
  assert.equal(routeSession(original, 1.5, 'role-a'), original);
  assert.equal(routeSessionToMember(original, 7, { slotId: 'legacy', assistantId: 'legacy' }), original);
});

test('skill selection copies only exact canonical published pins and preserves other roles', () => {
  const original = routeSessionToMember(draft(), 7, member);
  const removed = togglePublishedSkill(original, 'member-b', member, 'pbl-cer-coach', false);
  assert.equal(removed.skillPins.length, 1);
  const restored = togglePublishedSkill(removed, 'member-b', member, 'pbl-cer-coach', true);
  assert.deepEqual(restored.skillPins, original.skillPins);
  assert.equal(togglePublishedSkill(original, 'role-a', member, 'pbl-cer-coach', true), original);
  assert.equal(togglePublishedSkill(original, 'member-b', member, 'Unpublished display name', true), original);
  assert.deepEqual(togglePublishedSkill(restored, 'member-b', member, 'pbl-cer-coach', true).skillPins, restored.skillPins);
});

test('tool and MCP choices remain below the exact member publication ceiling', () => {
  const original = routeSessionToMember(draft(), 7, member);
  assert.equal(togglePublishedTool(original, 'member-b', member, 'advance_stage', true), original);
  assert.equal(togglePublishedTool(original, 'role-a', member, 'ima_search_knowledge', true), original);
  const selected = togglePublishedTool(original, 'member-b', member, 'ima_search_knowledge', true);
  assert.deepEqual(selected.mcpServerIds, ['ima-knowledge']);
  assert.deepEqual(selected.knowledgeBaseIds, ['kb-existing'], 'Tools never grant another knowledge library');
  assert.deepEqual(togglePublishedTool(selected, 'member-b', member, 'ima_search_knowledge', true).toolIds, selected.toolIds);
  assert.ok(!togglePublishedTool(selected, 'member-b', member, 'ima_search_knowledge', false).toolIds.some((tool) => tool.toolId === 'ima_search_knowledge'));
});
