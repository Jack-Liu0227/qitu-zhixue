import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EvidenceRequirement, PblRubric } from '@qitu/contracts';
import {
  applyAutomaticAcceptance,
  evaluateAutomaticAcceptance,
  resolveDerivedAutomaticGateId,
  toAiProjectReviewCandidate,
  toAutomaticAcceptanceState,
  toProjectReviewCandidate,
  validateProjectReviewCandidate,
  type AutomaticAcceptanceDecision,
  type GateEvidenceWriter,
} from './project-review';
import type { MentorReviewRecord } from './works.store';

const rubric: PblRubric = {
  id: 'robot-rubric',
  version: '1',
  title: '机器人作品',
  passingScore: 60,
  criteria: [{
    id: 'function', title: '功能', description: '可运行', evidenceRequirementIds: ['run'],
    levels: { 0: '无', 1: '初步', 2: '基本', 3: '良好', 4: '优秀' }, weight: 1,
  }],
};
const requirements: EvidenceRequirement[] = [{
  id: 'run', objectiveId: 'build', title: '运行记录', description: '演示视频',
  types: ['video'], required: true, visibility: 'teacher', validation: 'teacher_check',
}];
const review = (status: MentorReviewRecord['status']): MentorReviewRecord => ({
  id: 'mentor-review-1', schoolId: null, studentId: 'student-1', mentorUserId: 'teacher-1',
  projectId: 'project-1', artifactId: 'artifact-1', kind: 'artifact', status,
  decision: null, comment: null, idempotencyKey: 'review-1', requestedAt: new Date('2026-01-01'),
  reviewedAt: status === 'approved' ? new Date('2026-01-02') : null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
});

describe('project review contract adapter', () => {
  it('maps Works approved review to teacher accepted candidate', () => {
    const candidate = toProjectReviewCandidate({ review: review('approved'), artifactVersionId: 'artifact-1-v1', rubric, now: new Date('2026-01-03') });
    assert.equal(candidate.status, 'accepted');
    assert.equal(candidate.source, 'teacher');
    assert.equal(candidate.reviewedBy, 'teacher-1');
    assert.equal(candidate.projectId, 'project-1');
  });

  it('rejects AI acceptance and missing required evidence', () => {
    const candidate = {
      ...toProjectReviewCandidate({ review: review('in_review'), artifactVersionId: 'artifact-1-v1', rubric }),
      source: 'ai' as const, status: 'accepted' as const, modelId: 'model-1',
      criteria: [{ criterionId: 'function', level: 3 as const, rationale: 'ok', evidenceRefs: [] }],
    };
    const errors = validateProjectReviewCandidate({ candidate, rubric, evidenceRequirements: requirements, availableEvidenceIds: [] });
    assert.ok(errors.some((error) => error.includes('AI review')));
    assert.ok(errors.some((error) => error.includes('required evidence')));
    assert.ok(errors.some((error) => error.includes('required evidence')));
  });

  it('accepts a teacher candidate only when required evidence is available', () => {
    const candidate = {
      ...toProjectReviewCandidate({ review: review('approved'), artifactVersionId: 'artifact-1-v1', rubric }),
      status: 'accepted' as const,
      criteria: [{ criterionId: 'function', level: 3 as const, rationale: 'runs', evidenceRefs: ['run-video-1'] }],
    };
    const errors = validateProjectReviewCandidate({ candidate, rubric, evidenceRequirements: requirements, availableEvidenceIds: ['run', 'run-video-1'] });
    assert.deepEqual(errors, []);
  });
});

/* ================================================================== *
 *  自动验收接缝（automatic assessor seam）
 *
 *  这里验证两件**规则**，不是策略：
 *  1. AI 永远写不出「通过」——构造入口没有 accepted 这个选项；
 *  2. 只有**确定性规则**（`evaluateAutomaticAcceptance`）能产生
 *     `auto_accept` 结论，并且只有当门禁落在冻结核心集合内时才会去写门禁。
 * ================================================================== */

describe('automatic acceptance seam（AI 候选 + 确定性规则）', () => {
  const aiRubric: PblRubric = {
    id: 'kinetic-rubric',
    version: '2',
    title: '动能定理实验报告',
    passingScore: 70,
    criteria: [
      { id: 'structure', title: '结构完整', description: '章节齐全', evidenceRequirementIds: ['report'], levels: { 0: '无', 1: '初', 2: '基', 3: '良', 4: '优' }, weight: 1 },
      { id: 'analysis', title: '误差分析', description: '定量分析', evidenceRequirementIds: ['report'], levels: { 0: '无', 1: '初', 2: '基', 3: '良', 4: '优' }, weight: 1 },
    ],
  };
  const aiRequirements: EvidenceRequirement[] = [{
    id: 'report', objectiveId: 'measure', title: '实验报告', description: 'Markdown 报告',
    types: ['document'], required: true, visibility: 'teacher', validation: 'server_check',
  }];
  const aiCandidate = (overrides: Partial<Parameters<typeof evaluateAutomaticAcceptance>[0]['candidate']> = {}) => ({
    ...toAiProjectReviewCandidate({
      candidateId: 'cand-1',
      projectId: 'project-1',
      artifactVersionId: 'artifact-1-v3',
      rubric: aiRubric,
      modelId: 'gpt-x',
      score: 85,
      criteria: [
        { criterionId: 'structure', level: 4, rationale: '章节齐全', evidenceRefs: ['report'] },
        { criterionId: 'analysis', level: 3, rationale: '误差有定量分析', evidenceRefs: ['report'] },
      ],
      now: new Date('2026-02-01T00:00:00.000Z'),
    }),
    ...overrides,
  });
  const evaluate = (candidate: ReturnType<typeof aiCandidate>, extra: Partial<Parameters<typeof evaluateAutomaticAcceptance>[0]> = {}) =>
    evaluateAutomaticAcceptance({
      candidate,
      rubric: aiRubric,
      evidenceRequirements: aiRequirements,
      availableEvidenceIds: ['report'],
      evidenceProfile: 'experiment_report',
      ...extra,
    });

  it('AI 构造入口：source 恒为 ai、modelId 必填、状态只有 pending / needs_evidence', () => {
    const ok = toAiProjectReviewCandidate({
      candidateId: 'cand-2', projectId: 'project-1', artifactVersionId: 'artifact-1-v3',
      rubric: aiRubric, modelId: 'gpt-x', score: 90, criteria: [],
    });
    assert.equal(ok.source, 'ai');
    assert.equal(ok.status, 'pending');
    assert.equal(ok.reviewedBy, null);
    const needsEvidence = toAiProjectReviewCandidate({
      candidateId: 'cand-3', projectId: 'project-1', artifactVersionId: 'artifact-1-v3',
      rubric: aiRubric, modelId: 'gpt-x', score: 40, criteria: [], missingEvidenceIds: ['report'],
    });
    assert.equal(needsEvidence.status, 'needs_evidence');
    // 构造入口**没有**产生 accepted 的代码路径：状态只由「有没有缺失证据」推导。
    assert.notEqual(ok.status, 'accepted');
    assert.equal(Object.prototype.hasOwnProperty.call(needsEvidence, 'acceptedAt'), false);
  });

  it('既有校验不放宽：AI 候选写 accepted 仍被拒绝', () => {
    const forced = { ...aiCandidate(), status: 'accepted' as const };
    const errors = validateProjectReviewCandidate({
      candidate: forced, rubric: aiRubric, evidenceRequirements: aiRequirements, availableEvidenceIds: ['report'],
    });
    assert.ok(errors.some((error) => error.includes('AI review cannot directly produce an accepted candidate')));
  });

  it('既有校验不放宽：AI 候选不报 modelId 仍被拒绝', () => {
    const nameless = { ...aiCandidate(), modelId: null };
    const errors = validateProjectReviewCandidate({
      candidate: nameless, rubric: aiRubric, evidenceRequirements: aiRequirements, availableEvidenceIds: ['report'],
    });
    assert.ok(errors.some((error) => error.includes('AI candidate must identify its model')));
  });

  it('规则：分数达标 + 逐条达标 → auto_accept，并给出与交付物匹配的门禁', () => {
    const decision = evaluate(aiCandidate());
    assert.equal(decision.outcome, 'auto_accept');
    assert.equal(decision.state, 'accepted');
    // 报告类交付物推导出 `experiment_report_validated`（WS1 已把它注册进
    // 契约注册表与 source 白名单），因此这条决定带上门禁，可以走写入。
    assert.equal(decision.gate, 'experiment_report_validated');
    assert.equal(decision.blockingReasons.length, 0);
    assert.equal(decision.gateDeferredReason, null);
  });

  it('门禁推导是纯函数：交付物 → 门禁 id（不参与可写性判断）', () => {
    assert.equal(resolveDerivedAutomaticGateId({ evidenceProfile: 'runnable_code' }), 'code_playable_run_verified');
    assert.equal(resolveDerivedAutomaticGateId({ deliverableType: 'simulation_experiment_report' }), 'experiment_report_validated');
    assert.equal(resolveDerivedAutomaticGateId({}), null);
  });

  it('规则：分数低于 passingScore → reject，且不写门禁', async () => {
    const decision = evaluate(aiCandidate({ score: 60 }));
    assert.equal(decision.outcome, 'reject');
    assert.ok(decision.blockingReasons.some((reason) => reason.includes('below passingScore')));
    const writes: string[] = [];
    const result = await applyAutomaticAcceptance(
      { async recordGateForStudent(input) { writes.push(input.gate); return { status: 'recorded', runId: 'run-1', gate: input.gate }; } },
      decision,
      { studentUserId: 'student-1', evidenceRef: 'candidate:cand-1', source: 'works.document-structure-validator' },
    );
    assert.equal(result.written, false);
    assert.deepEqual(writes, []);
  });

  it('规则：候选声明缺证据 → needs_evidence，不写门禁', async () => {
    const decision = evaluate(aiCandidate({ status: 'needs_evidence', missingEvidenceIds: ['report'], score: 90 }));
    assert.equal(decision.outcome, 'needs_evidence');
    const writes: string[] = [];
    const result = await applyAutomaticAcceptance(
      { async recordGateForStudent(input) { writes.push(input.gate); return { status: 'recorded', runId: 'run-1', gate: input.gate }; } },
      decision,
      { studentUserId: 'student-1', evidenceRef: 'candidate:cand-1', source: 'works.document-structure-validator' },
    );
    assert.equal(result.written, false);
    assert.deepEqual(writes, []);
  });

  it('规则：criterion 未达最低等级 → reject', () => {
    const decision = evaluate(aiCandidate(), { minimumCriterionLevel: 4 });
    assert.equal(decision.outcome, 'reject');
    assert.ok(decision.blockingReasons.some((reason) => reason.includes('analysis')));
  });

  it('规则：rubric 里某条 criterion 没有结果 → reject（不允许漏评）', () => {
    const decision = evaluate(aiCandidate({
      criteria: [{ criterionId: 'structure', level: 4, rationale: 'ok', evidenceRefs: ['report'] }],
    }));
    assert.equal(decision.outcome, 'reject');
    assert.ok(decision.blockingReasons.some((reason) => reason.includes('no result')));
  });

  it('门禁推导：可运行代码交付物 → code_playable_run_verified（核心门禁），但**静态检查绝不写它**', async () => {
    const decision = evaluate(aiCandidate(), { evidenceProfile: 'runnable_code' });
    assert.equal(decision.outcome, 'auto_accept');
    assert.equal(decision.gate, 'code_playable_run_verified');
    // 关键语义红线：本条决定来自**报告/文档类**候选；门禁推导只回答"该用哪个门禁"，
    // 「代码真的能跑」需要真实 runner。静态检查生产者的结论是
    // `semanticScope: 'static_only'`，它**不**产生 auto_accept，因此不会走到这里。
    const writes: string[] = [];
    const result = await applyAutomaticAcceptance(
      { async recordGateForStudent(input) { writes.push(input.gate); return { status: 'recorded', runId: 'run-1', gate: input.gate }; } },
      decision,
      { studentUserId: 'student-1', evidenceRef: 'candidate:cand-1', source: 'works.document-structure-validator' },
    );
    assert.equal(result.written, true);
    assert.deepEqual(writes, ['code_playable_run_verified']);
    // 该 source 并不在 code_playable_run_verified 的白名单内，真实写入会被
    // assertGateEvidenceWritable 拒绝（400 GATE_SOURCE_NOT_ALLOWED）。白名单拒绝
    // 由 team-runtime 的测试覆盖；这里只验证「规则给出的门禁是哪一个」。
  });

  it('applyAutomaticAcceptance 是唯一写门禁的入口：auto_accept + 可写门禁时恰好调用一次', async () => {
    // 直接构造一条「门禁落在冻结核心集合内」的决定（TheoryMastered 是核心门禁），
    // 验证写入行为本身。这也说明：当前三个生产者推导出的门禁都不是核心门禁，
    // 因此端到端链路的这一跳在本次范围内**打不通**——这是如实登记的延后项。
    const decision: AutomaticAcceptanceDecision = {
      outcome: 'auto_accept',
      state: 'accepted',
      gate: 'TheoryMastered',
      gateDeferredReason: null,
      score: 90,
      blockingReasons: [],
    };
    const calls: Parameters<GateEvidenceWriter['recordGateForStudent']>[0][] = [];
    const result = await applyAutomaticAcceptance(
      {
        async recordGateForStudent(input) {
          calls.push(input);
          return { status: 'deferred', runId: null, gate: input.gate, reason: 'pending_gate_evidence' };
        },
      },
      decision,
      { studentUserId: 'student-1', evidenceRef: 'candidate:cand-1', source: 'learning-plan.theory-mastered' },
    );
    assert.equal(result.written, true);
    // deferred 是 T22 待冲刷账本语义，算调用成功，不是失败。
    assert.equal(result.writeStatus, 'deferred');
    assert.equal(result.reason, 'pending_gate_evidence');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.studentUserId, 'student-1');
    assert.equal(calls[0]?.evidenceRef, 'candidate:cand-1');
    assert.equal(calls[0]?.gate, 'TheoryMastered');
  });

  it('状态映射：ready_for_teacher 被重新表述为等待自动验收（教师态不再表示终局）', () => {
    assert.equal(toAutomaticAcceptanceState('ready_for_teacher'), 'pending_automatic_acceptance');
    assert.equal(toAutomaticAcceptanceState('pending'), 'pending_automatic_acceptance');
    assert.equal(toAutomaticAcceptanceState('accepted'), 'accepted');
  });
});
