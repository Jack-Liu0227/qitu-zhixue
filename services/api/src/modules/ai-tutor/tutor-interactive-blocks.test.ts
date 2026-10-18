import assert from 'node:assert/strict';
import test from 'node:test';
import type { TutorProjectContext } from '@qitu/contracts';
import { buildProjectInteractionBlocks } from './tutor-interactive-blocks';

const baseContext: TutorProjectContext = {
  project: { id: 'project-1', title: '学习项目', stage: 'practice_building', progress: 20 },
  progress: { currentStageIndex: 2, stageTotal: 3, progressPercent: 20 },
  stages: [],
  currentTask: null,
  phases: [
    {
      phaseId: 'concept_mastery', orderIndex: 0, name: '理论推导', requiresGateApproval: true,
      gateRule: 'TheoryMastered', gateStatus: 'pending', status: 'completed',
      requiredDeliverables: [{ id: 'concept-proof', title: '理论说明', submitted: false }],
    },
    {
      phaseId: 'guided_practice', orderIndex: 1, name: '实践制作', requiresGateApproval: false,
      gateRule: 'code_playable_run_verified', gateStatus: 'pending', status: 'active',
      requiredDeliverables: [{ id: 'practice-work', title: '实践作品', submitted: false }],
    },
  ],
};

test('项目交互块基于阶段投影完整生成，理论门禁未过不投影实践 milestone', () => {
  const blocks = buildProjectInteractionBlocks(baseContext);
  assert.deepEqual(blocks.map((block) => block.kind), ['board', 'milestone']);
  const milestone = blocks.find((block) => block.kind === 'milestone');
  assert.equal(milestone?.kind, 'milestone');
  if (milestone?.kind === 'milestone') {
    assert.equal(milestone.phaseId, 'concept_mastery');
    assert.equal(milestone.gate.type, 'TheoryMastered');
    assert.equal(milestone.gate.status, 'pending');
    assert.deepEqual(milestone.deliverables.map((item) => item.id), ['concept-proof']);
  }
});

test('board markup 来自服务端受控 Mermaid，标签中的 HTML/脚本符号被剥离', () => {
  const context = {
    ...baseContext,
    phases: [{ ...baseContext.phases![0]!, name: '<script>alert(1)</script> 理论', status: 'active' as const }],
  };
  const [board] = buildProjectInteractionBlocks(context);
  assert.equal(board?.kind, 'board');
  if (board?.kind === 'board') {
    assert.match(board.steps[0]!.mermaid ?? '', /^flowchart LR/u);
    assert.doesNotMatch(board.steps[0]!.mermaid ?? '', /<|>/u);
    assert.doesNotMatch(board.steps[0]!.mermaid ?? '', /<script|<\/script>/iu);
    assert.equal(board.steps.length, 1);
  }
});

test('无项目或无真实阶段投影时不合成交互块', () => {
  assert.deepEqual(buildProjectInteractionBlocks({ ...baseContext, project: null }), []);
  assert.deepEqual(buildProjectInteractionBlocks({ ...baseContext, phases: [] }), []);
});

test('TheoryMastered 通过后允许当前实践阶段 milestone', () => {
  const context = {
    ...baseContext,
    phases: baseContext.phases!.map((phase) => phase.phaseId === 'concept_mastery'
      ? { ...phase, gateStatus: 'passed' as const }
      : phase),
  };
  const milestone = buildProjectInteractionBlocks(context).find((block) => block.kind === 'milestone');
  assert.equal(milestone?.kind, 'milestone');
  if (milestone?.kind === 'milestone') assert.equal(milestone.phaseId, 'guided_practice');
});

test('光学项目且通过 TheoryMastered 后，实践阶段注入 optics_experiment 块', () => {
  const opticsPassedContext: TutorProjectContext = {
    ...baseContext,
    project: { ...baseContext.project!, title: '高中物理光学散射与衍射探究' },
    phases: baseContext.phases!.map((phase) => phase.phaseId === 'concept_mastery'
      ? { ...phase, gateStatus: 'passed' as const }
      : phase),
  };
  const blocks = buildProjectInteractionBlocks(opticsPassedContext);
  const expBlock = blocks.find((block) => block.kind === 'optics_experiment');
  assert.equal(expBlock !== undefined, true, '应生成 optics_experiment 块');
  if (expBlock?.kind === 'optics_experiment') {
    assert.equal(expBlock.title, '光的散射与衍射动态探究台');
    assert.equal(expBlock.initialMode, 'scattering');
  }
});

test('光学项目未通过 TheoryMastered 时，不得注入 optics_experiment 块', () => {
  const opticsPendingContext: TutorProjectContext = {
    ...baseContext,
    project: { ...baseContext.project!, title: '高中物理光学散射与衍射探究' },
  };
  const blocks = buildProjectInteractionBlocks(opticsPendingContext);
  const expBlock = blocks.find((block) => block.kind === 'optics_experiment');
  assert.equal(expBlock === undefined, true, '理论未掌握时严禁注入实践实验块');
});

