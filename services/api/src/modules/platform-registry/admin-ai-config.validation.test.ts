import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAssistantCreate,
  parseAssistantUpdate,
  parseTeamCreate,
  parseTeamUpdate,
} from './admin-ai-config.validation';

/** 断言 400 + 稳定错误码 ADMIN_AI_CONFIG_INVALID（而不是随便一个 Error）。 */
function assertInvalid(code = 'ADMIN_AI_CONFIG_INVALID'): (error: unknown) => boolean {
  return (error: unknown) => {
    const status = (error as { getStatus?: () => number }).getStatus?.();
    const response = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    assert.equal(status, 400, `期望 BadRequestException(400)，实际 ${String(status)}`);
    assert.equal(response?.code, code);
    return true;
  };
}

const VALID_ASSISTANT = {
  name: ' 战机陪练助手 ',
  description: '负责拓展练习引导',
  role: 'Coach / 陪练',
  instructions: '用问题引导学生完成拓展。',
};

function pblSpec(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'pbl-thunder-fighter',
    projectName: '雷霆战机：从零打造 Python 飞行射击小游戏',
    targetDomain: 'programming_game_dev',
    theoryMasteredGate: true,
    phases: [
      { phase: 'concept_mastery', title: '概念掌握', assignedAssistantId: 'coach' },
      { phase: 'guided_practice', title: '代码实践', assignedAssistantId: 'coach', gateCondition: 'code_playable_run_verified' },
    ],
    ...overrides,
  };
}

function teamBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '雷霆战机 PBL 导师团队',
    description: '多智能体协同导师团队',
    leaderAssistantId: 'tutor-leader',
    members: [
      { slotId: 'slot-leader', assistantId: 'tutor-leader', role: 'leader' },
      { assistantId: 'coach', role: 'coach', pblPhase: 'concept_mastery' },
    ],
    concurrencyLimit: 2,
    ...overrides,
  };
}

test('助手创建：必填字段齐全并裁剪 name 空白；派生字段不可提交', () => {
  const input = parseAssistantCreate({ ...VALID_ASSISTANT, temperature: 0.6, teamSelectable: true });
  assert.equal(input.name, '战机陪练助手');
  assert.equal(input.description, '负责拓展练习引导');
  assert.equal(input.instructions, '用问题引导学生完成拓展。');
  assert.equal(input.temperature, 0.6);
  assert.equal(input.teamSelectable, true);
  assert.throws(() => parseAssistantCreate({ description: 'd', role: 'r', instructions: 'i' }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, name: '' }), assertInvalid());
});

test('助手创建：拒绝客户端直写 id/source/deletable/agentStatus/createdAt 等服务端字段', () => {
  for (const forbidden of ['id', 'source', 'deletable', 'agentStatus', 'agentStatusMessage', 'createdAt', 'updatedAt']) {
    assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, [forbidden]: 'x' }), assertInvalid(), `${forbidden} 应被拒绝`);
  }
});

test('助手创建：name 裁剪空白后 1–40 字符；temperature 0–2；sortOrder 非负', () => {
  assert.equal(parseAssistantCreate({ ...VALID_ASSISTANT, name: `${'名'.repeat(40)}  ` }).name.length, 40);
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, name: '名'.repeat(41) }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, name: '    ' }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, temperature: 2.5 }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, temperature: -0.1 }), assertInvalid());
  assert.equal(parseAssistantCreate({ ...VALID_ASSISTANT, temperature: 0 }).temperature, 0);
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, sortOrder: -1 }), assertInvalid());
});

test('空 PATCH 一律拒绝（助手与团队）', () => {
  assert.throws(() => parseAssistantUpdate({}), assertInvalid());
  assert.throws(() => parseTeamUpdate({}), assertInvalid());
  assert.deepEqual(parseAssistantUpdate({ enabled: false }), { enabled: false });
});

test('团队创建：members 至少 1 人且 role/pblPhase 限枚举；成员派生字段不可写', () => {
  assert.throws(() => parseTeamCreate(teamBody({ members: [] })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ members: { bad: true } })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ members: [{ assistantId: 'a', role: 'supervisor' }] })), assertInvalid());
  assert.throws(() => parseTeamCreate({
    name: 'n', description: 'd', leaderAssistantId: 'a',
    members: [{ assistantId: 'a', role: 'leader', status: 'active', assistantName: '注入', avatar: '💀' }],
  }), assertInvalid());
  assert.equal(parseTeamCreate(teamBody()).members.length, 2);
});

test('团队创建：leaderAssistantId 必须命中某个成员', () => {
  assert.throws(
    () => parseTeamCreate(teamBody({ leaderAssistantId: 'ghost-assistant' })),
    assertInvalid(),
  );
  const ok = parseTeamCreate(teamBody({ leaderAssistantId: 'coach' }));
  assert.equal(ok.leaderAssistantId, 'coach');
});

test('团队创建：slotId 不允许重复', () => {
  assert.throws(() => parseTeamCreate(teamBody({
    members: [
      { slotId: 'slot-x', assistantId: 'tutor-leader', role: 'leader' },
      { slotId: 'slot-x', assistantId: 'coach', role: 'coach' },
    ],
  })), assertInvalid());
});

test('PBL 硬门禁：theoryMasteredGate=false 或缺失都被拒绝（强校验，不是兜底默认）', () => {
  assert.throws(() => parseTeamCreate(teamBody({ pblSpec: pblSpec({ theoryMasteredGate: false }) })), assertInvalid());
  const stripped = pblSpec();
  delete (stripped as Record<string, unknown>).theoryMasteredGate;
  assert.throws(() => parseTeamCreate(teamBody({ pblSpec: stripped })), assertInvalid());
  const accepted = parseTeamCreate(teamBody({ pblSpec: pblSpec() }));
  assert.equal(accepted.pblSpec?.theoryMasteredGate, true);
  assert.throws(() => parseTeamCreate(teamBody({ pblSpec: pblSpec({ allowAutonomousAdvance: true }) })), assertInvalid());
  assert.equal(parseTeamCreate(teamBody({ pblSpec: pblSpec({ allowAutonomousAdvance: false }) })).pblSpec?.allowAutonomousAdvance, false);
});

test('PBL 门禁：concept_mastery 阶段 gateCondition 必须是 TheoryMastered', () => {
  assert.throws(() => parseTeamCreate(teamBody({ pblSpec: pblSpec({
    phases: [{ phase: 'concept_mastery', title: '概念', assignedAssistantId: 'coach', gateCondition: 'code_playable_run_verified' }],
  }) })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ pblSpec: pblSpec({
    phases: [{ phase: 'concept_mastery', title: '概念', assignedAssistantId: 'coach', gateCondition: 'anything_else' }],
  }) })), assertInvalid());
  // 省略时由服务端按阶段补 TheoryMastered（校验通过，规范化在 service 层）。
  const parsed = parseTeamCreate(teamBody({ pblSpec: pblSpec({
    phases: [{ phase: 'concept_mastery', title: '概念', assignedAssistantId: 'coach' }],
  }) }));
  assert.equal(parsed.pblSpec?.phases[0]?.gateCondition, undefined);
});

test('团队创建：concurrencyLimit 限 1–8；name 裁剪后 1–40；未知字段拒绝', () => {
  assert.throws(() => parseTeamCreate(teamBody({ concurrencyLimit: 0 })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ concurrencyLimit: 9 })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ concurrencyLimit: 2.5 })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ name: '团'.repeat(41) })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ createdAt: '2020-01-01' })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ workspaceMode: 'network' })), assertInvalid());
  assert.throws(() => parseTeamCreate(teamBody({ sessionMode: 'yolo' })), assertInvalid());
  assert.equal(parseTeamCreate(teamBody({ concurrencyLimit: 8 })).concurrencyLimit, 8);
});

test('团队 PATCH：members 整体替换语义 + leader 同补丁命中校验', () => {
  assert.throws(() => parseTeamUpdate({
    members: [{ assistantId: 'a', role: 'leader' }],
    leaderAssistantId: 'not-a-member',
  }), assertInvalid());
  const patch = parseTeamUpdate({ members: [{ slotId: 'slot-keep', assistantId: 'a', role: 'leader' }] });
  assert.deepEqual(patch.members, [{ slotId: 'slot-keep', assistantId: 'a', role: 'leader' }]);
  assert.equal(patch.leaderAssistantId, undefined);
});

test('助手 defaults 只接受已知项并做形状校验', () => {
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, defaults: { mystery: 1 } }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, defaults: { model: 'qwen' } }), assertInvalid());
  assert.throws(() => parseAssistantCreate({ ...VALID_ASSISTANT, defaults: { skills: { mode: 'default', value: 'not-list' } } }), assertInvalid());
  const ok = parseAssistantCreate({ ...VALID_ASSISTANT, defaults: { model: { mode: 'fixed', value: 'qwen3.8-flash' }, skills: { mode: 'default', value: [] } } });
  assert.deepEqual(ok.defaults?.model, { mode: 'fixed', value: 'qwen3.8-flash' });
});
