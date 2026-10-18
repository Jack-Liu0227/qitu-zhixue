import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFrozenTeamMembers } from './tutor-team-members';

test('完整冻结字段优先；缺失目录成员不替换为其他助手；坏成员不产生空槽位', () => {
  const members = resolveFrozenTeamMembers({
    versionId: 'v1', leaderAssistantId: 'a1',
    assistants: [{ id: 'a1', name: '改名后的姓名', avatar: 'new' }],
    members: [
      { slotId: 's1', assistantId: 'a1', assistantName: '冻结姓名', role: 'coach', roleLabel: '冻结角色', avatar: 'old', pblPhase: 'concept_mastery', color: 'blue' },
      { assistantId: 'removed', phaseScope: 'deliverable_review' }, null, {},
    ],
  });
  assert.equal(members.length, 2);
  assert.equal(members[0]?.assistantName, '冻结姓名');
  assert.equal(members[0]?.slotId, 's1');
  assert.equal(members[0]?.role, 'coach');
  assert.equal(members[0]?.avatar, 'old');
  assert.equal(members[0]?.color, 'blue');
  assert.equal(members[1]?.assistantId, 'removed');
  assert.equal(members[1]?.assistantName, 'removed');
  assert.equal(members[1]?.role, 'reviewer');
});
