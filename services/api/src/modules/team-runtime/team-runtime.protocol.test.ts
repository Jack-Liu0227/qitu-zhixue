import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PBL_GATE_BLOCKED_TOPIC,
  PBL_GATE_SATISFIED_TOPIC,
  PBL_PHASE_ADVANCED_TOPIC,
  TEAM_FRAME_NAMES,
  TEAM_MODEL_THINKING_TOPIC,
  TEAM_TOOL_INVOKED_TOPIC,
  buildTeamFrameData,
  isExecutableTeamMessageType,
  sanitizeTeamFramePayload,
  teamFrameName,
  type TeamStreamKind,
} from './team-runtime.service';

test('Team Runtime executes request messages but never result messages', () => {
  assert.equal(isExecutableTeamMessageType('task.request'), true);
  assert.equal(isExecutableTeamMessageType('projection.request'), true);
  assert.equal(isExecutableTeamMessageType('delegate.result'), false);
  assert.equal(isExecutableTeamMessageType('projection.result'), false);
  assert.equal(isExecutableTeamMessageType('leader.reply'), false);
});

/* ------------------------------------------------------------------ *
 * 流式帧协议钉死：新增/改名帧类型必须同步修改以下断言。
 * ------------------------------------------------------------------ */

test('team stream frames expose exactly the five frozen frame names', () => {
  assert.deepEqual(Object.keys(TEAM_FRAME_NAMES).sort(), [
    'gate_blocked',
    'member_delegated',
    'phase_advanced',
    'thinking',
    'tool_invoked',
  ]);
  assert.deepEqual(TEAM_FRAME_NAMES, {
    phase_advanced: 'team.phase_advanced',
    gate_blocked: 'team.gate_blocked',
    member_delegated: 'team.member_delegated',
    tool_invoked: 'team.tool_invoked',
    thinking: 'team.thinking',
  });
  const kinds: TeamStreamKind[] = ['phase_advanced', 'gate_blocked', 'member_delegated', 'tool_invoked', 'thinking'];
  for (const kind of kinds) assert.equal(teamFrameName(kind), TEAM_FRAME_NAMES[kind]);
});

test('team frames never collide with tutor conversation frame names', () => {
  // tutor.* 对话帧名在 tutor.controller 的 FRAME_NAME 里（改名会碰坏前端，
  // 所以这里把两边都钉住）。团队帧必须与对话帧可区分。
  const tutorFrameNames = new Set([
    'tutor.tool_call',
    'tutor.tool_result',
    'tutor.delta',
    'tutor.block',
    'error',
    'turn.done',
  ]);
  for (const frameName of Object.values(TEAM_FRAME_NAMES)) {
    assert.equal(tutorFrameNames.has(frameName), false, `frame ${frameName} must not collide with tutor frames`);
    assert.match(frameName, /^team\./);
  }
});

test('team event topics map one-to-one onto frame kinds (delegated frames come from tasks)', () => {
  assert.equal(PBL_GATE_SATISFIED_TOPIC, 'team.gate.satisfied');
  assert.equal(PBL_GATE_BLOCKED_TOPIC, 'team.gate.blocked');
  assert.equal(PBL_PHASE_ADVANCED_TOPIC, 'team.phase_advanced');
  assert.equal(TEAM_TOOL_INVOKED_TOPIC, 'team.tool.invoked');
  assert.equal(TEAM_MODEL_THINKING_TOPIC, 'team.model.thinking');
  // 证据主题不产生帧：门禁达成事件只用于服务端判定，不直接暴露给学生流。
  assert.notEqual(PBL_GATE_SATISFIED_TOPIC, PBL_GATE_BLOCKED_TOPIC);
});

test('team frames are sanitized: raw student text never leaves the server', () => {
  const sanitized = sanitizeTeamFramePayload({
    runId: 'run-1',
    phase: 'guided_practice',
    content: '学生的原始对话内容，绝不能进入流式帧',
    text: '助手原文',
    utterance: '原话',
    transcript: '逐字稿',
    messages: [{ role: 'user' }],
    prompt: 'system prompt',
    conversationSummary: '对话摘要原文',
    intent: '学生原话里的意图',
    errorCode: 'PBL_GATE_THEORY_MASTERED_REQUIRED',
    evidenceRefs: ['tutor_turn:session-1:7'],
    longField: 'x'.repeat(500),
  });
  for (const leaked of ['content', 'text', 'utterance', 'transcript', 'messages', 'prompt', 'conversationSummary', 'intent']) {
    assert.equal(leaked in sanitized, false, `${leaked} must be stripped from team frames`);
  }
  assert.equal(sanitized.runId, 'run-1');
  assert.equal(sanitized.errorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
  assert.deepEqual(sanitized.evidenceRefs, ['tutor_turn:session-1:7']);
  assert.equal((sanitized.longField as string).length, 120);

  const frameData = buildTeamFrameData('gate_blocked', {
    runId: 'run-1',
    requiredGate: 'TheoryMastered',
    errorCode: 'PBL_GATE_THEORY_MASTERED_REQUIRED',
    content: '学生原文',
  });
  assert.equal(frameData.frame, 'team.gate_blocked');
  assert.equal('content' in frameData, false);
  assert.equal(frameData.requiredGate, 'TheoryMastered');
});
