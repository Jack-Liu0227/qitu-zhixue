import {
  CURRICULUM_TEMPLATE_VERSION,
  MAX_OBJECTIVES_PER_SESSION,
  MINUTES_PER_SESSION,
  SESSIONS_PER_WEEK,
  assertValidCurriculumPlan,
  confirmCurriculumPlan,
  curriculumPlanKey,
  exploreCurriculumInterest,
  generateCurriculumPlan,
  planCurriculum,
  selectNextCurriculumStep,
  sessionObjectiveIds,
  toLegacyLearningPlanDraft,
  validateCurriculumPlan,
  validateLearningPlanDraft,
  validateObjectiveWording,
  type CurriculumPlanDraft,
} from './curriculum.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clonePlan(plan: CurriculumPlanDraft): any {
  return JSON.parse(JSON.stringify(plan));
}

function errorOf(run: () => unknown): { code?: string; message?: string } {
  try {
    run();
  } catch (error) {
    const candidate = error as { code?: string; message?: string };
    return { code: candidate.code, message: candidate.message };
  }
  throw new Error('expected the call to throw, but it returned normally');
}

function messages(result: { errors: readonly { message: string }[] }): string {
  return result.errors.map((error) => error.message).join(' | ');
}

const NOW = '2026-10-04T09:00:00.000Z';

function explore(weeks: 4 | 8, interest = '用 Python 做一个小游戏'): ReturnType<typeof exploreCurriculumInterest> {
  return exploreCurriculumInterest({ interest, weeks, seed: 20261004, now: NOW });
}

function plan(weeks: 4 | 8): CurriculumPlanDraft {
  const exploration = explore(weeks);
  return planCurriculum(exploration, { seed: 20261004, now: NOW });
}

function assertSessionBlocksSumTo60(draft: CurriculumPlanDraft, label: string): void {
  for (const session of draft.sessions) {
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    assert(
      minutes === MINUTES_PER_SESSION,
      `${label}: session ${session.id} blocks total ${minutes}, expected ${MINUTES_PER_SESSION}`,
    );
  }
}

function assertObjectiveCap(draft: CurriculumPlanDraft, label: string): void {
  for (const session of draft.sessions) {
    const count = sessionObjectiveIds(session).length;
    assert(
      count <= MAX_OBJECTIVES_PER_SESSION,
      `${label}: session ${session.id} carries ${count} objectives, cap is ${MAX_OBJECTIVES_PER_SESSION}`,
    );
  }
}

export async function runCurriculumAssertions(): Promise<void> {
  // --- 阶段 1：探索必须澄清输入，缺字段降级且留痕 -------------------------
  const invalidInterest = errorOf(() => exploreCurriculumInterest({ interest: '  ', weeks: 4, now: NOW }));
  assert(
    invalidInterest.code === 'LEARNING_PLAN_INVALID',
    `empty interest should be LEARNING_PLAN_INVALID, got ${String(invalidInterest.code)}`,
  );
  const invalidWeeks = errorOf(() =>
    exploreCurriculumInterest({ interest: '机器人', weeks: 6 as unknown as 4, now: NOW }),
  );
  assert(invalidWeeks.code === 'LEARNING_PLAN_INVALID', 'weeks=6 must be rejected');

  const degraded = explore(8);
  assert(degraded.phase === 'explore' && degraded.brand === 'curriculum-exploration-v1', 'explore brand missing');
  assert(degraded.missingIntakeFields.length > 0, 'missing intake fields must be recorded, not silently dropped');
  assert(degraded.profile.degradedFields.length === degraded.missingIntakeFields.length, 'degraded fields must be traceable');
  assert(degraded.clarifyingQuestions.length >= 1 && degraded.clarifyingQuestions.length <= 3, 'expect 1..3 clarifying questions');
  assert(degraded.interestTags.length >= 1, 'interest tags must be derived in the explore phase');

  const withProfile = exploreCurriculumInterest({
    interest: 'Python 小游戏',
    weeks: 8,
    profile: { priorKnowledge: '做过 Scratch', targetLevel: '能独立写脚本', timeBudgetMinutesPerWeek: 240, preferences: ['动手'] },
    now: NOW,
  });
  assert(withProfile.missingIntakeFields.length === 0, 'complete intake must not be marked missing');
  assert(withProfile.profile.timeBudgetMinutesPerWeek === 240, 'intake time budget must be preserved');

  // --- 两阶段：计划不能绕过 explore 一步到位 ------------------------------
  const twoPhase = errorOf(() => planCurriculum({ interest: '机器人', weeks: 8 } as never));
  assert(
    twoPhase.code === 'LEARNING_PLAN_TRANSITION_INVALID',
    `plan without explore output must be rejected, got ${String(twoPhase.code)}`,
  );

  // --- 4 周与 8 周：每节 60 分钟、每节 ≤4 目标、结构合法 ----------------
  for (const weeks of [4, 8] as const) {
    const draft = plan(weeks);
    const result = validateCurriculumPlan(draft);
    assert(result.ok, `${weeks}w plan must be valid: ${messages(result)}`);
    assert(draft.weeks === weeks, `${weeks}w plan carries wrong weeks`);
    assert(draft.minutesPerSession === MINUTES_PER_SESSION, 'minutesPerSession must be 60');
    assert(
      draft.sessions.length === weeks * SESSIONS_PER_WEEK,
      `${weeks}w plan must contain ${weeks * SESSIONS_PER_WEEK} sessions`,
    );
    assert(draft.projectId === null, 'draft plan must not carry a projectId before intent confirmation');
    assert(
      draft.templateVersion === CURRICULUM_TEMPLATE_VERSION,
      'templateVersion must be the frozen template version',
    );
    assertSessionBlocksSumTo60(draft, `${weeks}w`);
    assertObjectiveCap(draft, `${weeks}w`);
    assert(draft.sessions[0]!.practiceObjectiveIds.length === 0, 'first session must be theory-only');

    // 同一形状必须同时通过旧版校验器（plan-api 当前消费的投影）。
    const legacy = validateLearningPlanDraft(toLegacyLearningPlanDraft(draft));
    assert(legacy.ok, `${weeks}w plan must satisfy the legacy validator: ${messages(legacy)}`);

    // 目标措辞是「能力」，且每个实践目标都有同节或更早课次的理论门禁。
    for (const objective of draft.objectives) {
      const wording = validateObjectiveWording(objective.objective);
      assert(wording.ok, `${weeks}w objective wording rejected: ${objective.objective}`);
    }
    const wordingCount = new Set(draft.objectives.map((objective) => objective.objective)).size;
    assert(
      wordingCount === draft.objectives.length,
      `${weeks}w plan repeats objective wording (${wordingCount}/${draft.objectives.length} unique)`,
    );
    const sessionIndexOfObjective = new Map<string, number>();
    for (const session of draft.sessions) {
      for (const objectiveId of sessionObjectiveIds(session)) {
        if (!sessionIndexOfObjective.has(objectiveId)) sessionIndexOfObjective.set(objectiveId, session.index);
      }
    }
    for (const session of draft.sessions) {
      for (const practiceObjectiveId of session.practiceObjectiveIds) {
        const objective = draft.objectives.find((candidate) => candidate.id === practiceObjectiveId)!;
        const theoryPrerequisite = objective.prerequisiteIds.find(
          (candidateId) => draft.objectives.find((candidate) => candidate.id === candidateId)?.type === 'memory'
            || draft.objectives.find((candidate) => candidate.id === candidateId)?.type === 'concept',
        );
        assert(theoryPrerequisite !== undefined, `${practiceObjectiveId} must declare a theory prerequisite`);
        assert(
          (sessionIndexOfObjective.get(theoryPrerequisite) ?? Number.POSITIVE_INFINITY) <= session.index,
          `${practiceObjectiveId} is gated by a theory objective scheduled later than its practice`,
        );
        assert(session.theoryObjectiveIds.length > 0, `${session.id} must declare a same-session theory gate`);
      }
    }
  }

  // --- 确定性：同 seed + 同输入 → 同计划；无 seed 也由输入派生 -----------
  const runA = generateCurriculumPlan({ interest: '用 Python 做一个小游戏', weeks: 8, seed: 20261004, now: NOW });
  const runB = generateCurriculumPlan({ interest: '用 Python 做一个小游戏', weeks: 8, seed: 20261004, now: NOW });
  assert(JSON.stringify(runA) === JSON.stringify(runB), 'same seed must produce an identical plan');
  const runC = generateCurriculumPlan({ interest: '用 Python 做一个小游戏', weeks: 8, now: NOW });
  const runD = generateCurriculumPlan({ interest: '用 Python 做一个小游戏', weeks: 8, now: NOW });
  assert(JSON.stringify(runC) === JSON.stringify(runD), 'derived seed must still be deterministic');
  const runE = generateCurriculumPlan({ interest: '用 Python 做一个小游戏', weeks: 8, seed: 7, now: NOW });
  assert(validateCurriculumPlan(runE.plan).ok, 'a different seed must still produce a valid plan');
  assert(
    runE.plan.sessions.map((session) => session.id).join(',') === runA.plan.sessions.map((session) => session.id).join(','),
    'seed may change wording but must not change the plan skeleton',
  );

  // --- 注入时钟：计划时间戳必须可复现且不早于探索 -----------------------
  const withClock = generateCurriculumPlan(
    { interest: '机器人', weeks: 4, seed: 1 },
    { now: () => '2026-10-04T10:00:00.000Z' },
  );
  assert(withClock.plan.generatedAt === '2026-10-04T10:00:00.000Z', 'injected clock must be used');
  assert(
    withClock.exploration.exploredAt === '2026-10-04T10:00:00.000Z',
    'explore phase must use the injected clock too',
  );

  // --- 严格校验：畸形计划必须被拒绝，且不被静默修补 ---------------------
  const base = plan(8);

  const badMinutes = clonePlan(base);
  badMinutes.sessions[3].blocks[0].minutes += 5;
  assert(
    !validateCurriculumPlan(badMinutes).ok &&
      messages(validateCurriculumPlan(badMinutes)).includes('60'),
    'block minutes not summing to 60 must be rejected',
  );

  const badType = clonePlan(base);
  badType.objectives[0].type = 'topic';
  assert(
    messages(validateCurriculumPlan(badType)).includes('KnowledgeType'),
    'unknown KnowledgeType must be rejected',
  );

  const tooManyObjectives = clonePlan(base);
  tooManyObjectives.sessions[2].blocks[1].objectiveIds.push('extra-1', 'extra-2', 'extra-3');
  assert(
    messages(validateCurriculumPlan(tooManyObjectives)).includes('at most 4 objectives'),
    'the four-objective cap must be enforced',
  );

  const cyclic = clonePlan(base);
  cyclic.objectives[1].prerequisiteIds = [cyclic.objectives[2].id];
  cyclic.objectives[2].prerequisiteIds = [cyclic.objectives[1].id];
  const cyclicResult = validateCurriculumPlan(cyclic);
  assert(!cyclicResult.ok, 'a cyclic prerequisite graph must be rejected');
  assert(messages(cyclicResult).includes('acyclic'), 'cycle rejection must be reported explicitly');

  const practiceBeforeTheory = clonePlan(base);
  const practiceSession = practiceBeforeTheory.sessions[1];
  const practiceObjective = practiceBeforeTheory.objectives.find(
    (objective: { id: string }) => objective.id === practiceSession.practiceObjectiveIds[0],
  );
  const laterTheoryId = practiceBeforeTheory.sessions[10].theoryObjectiveIds[0];
  practiceObjective.prerequisiteIds = [laterTheoryId];
  practiceSession.theoryObjectiveIds = [];
  const gateResult = validateCurriculumPlan(practiceBeforeTheory);
  assert(!gateResult.ok, 'practice gated by a later theory objective must be rejected');
  assert(
    messages(gateResult).includes('same or an earlier session'),
    'the gate rejection must explain the same-or-earlier requirement',
  );

  const reorderedBlocks = clonePlan(base);
  const targetSession = reorderedBlocks.sessions[2];
  targetSession.blocks = [
    targetSession.blocks.find((block: { kind: string }) => block.kind === 'practice'),
    ...targetSession.blocks.filter((block: { kind: string }) => block.kind !== 'practice'),
  ];
  assert(
    messages(validateCurriculumPlan(reorderedBlocks)).includes('after theory and check'),
    'practice block before theory must be rejected',
  );

  const confirmedProject = clonePlan(base);
  confirmedProject.projectId = 'project-1';
  assert(
    messages(validateCurriculumPlan(confirmedProject)).includes('before intent confirmation'),
    'a draft must not carry a projectId',
  );

  const blocked = errorOf(() => assertValidCurriculumPlan(cyclic));
  assert(blocked.code === 'LEARNING_PLAN_INVALID', 'assertValidCurriculumPlan must throw LEARNING_PLAN_INVALID');

  // --- 目标措辞：能力句，不是话题清单 -----------------------------------
  assert(!validateObjectiveWording('变量、循环和函数').ok, 'a topic list must be rejected');
  assert(!validateObjectiveWording('理解变量。知道循环。').ok, 'multiple sentences must be rejected');
  assert(!validateObjectiveWording('').ok, 'empty wording must be rejected');
  assert(
    validateObjectiveWording('能用循环把重复输入限制到 3 次').ok,
    'a one-sentence ability must be accepted',
  );

  // --- 确定性推进：答案优先 → 复习 → 未完成课次 → 完成 ------------------
  const pendingStep = selectNextCurriculumStep(base, {
    masteredObjectiveIds: [],
    pendingQuestionObjectiveId: base.sessions[3]!.practiceObjectiveIds[0]!,
  });
  assert(pendingStep.action === 'answer_pending', 'a pending question must win over everything else');
  assert(pendingStep.practiceUnlocked === false, 'a pending question must not unlock practice');

  const reviewStep = selectNextCurriculumStep(base, {
    masteredObjectiveIds: [],
    dueReviewObjectiveId: base.sessions[2]!.theoryObjectiveIds[0]!,
  });
  assert(reviewStep.action === 'review', 'a due review must win over new objectives');

  const freshStep = selectNextCurriculumStep(base, { masteredObjectiveIds: [] });
  assert(freshStep.sessionIndex === 0, 'a fresh plan must start at the first session');
  assert(freshStep.action === 'probe', `first session is memory-based, expected probe, got ${freshStep.action}`);
  assert(freshStep.theoryMastered === false && freshStep.practiceUnlocked === false, 'practice stays locked before theory');
  assert(typeof freshStep.reason === 'string' && freshStep.reason.length > 0, 'every decision needs a reason');

  const sessionOne = base.sessions[1]!;
  const masteredNodes = [
    ...base.sessions[0]!.theoryObjectiveIds,
    ...sessionOne.theoryObjectiveIds,
  ];
  const practiceStep = selectNextCurriculumStep(base, { masteredObjectiveIds: masteredNodes });
  assert(practiceStep.action === 'practice', `theory mastered should unlock practice, got ${practiceStep.action}`);
  assert(practiceStep.theoryMastered === true && practiceStep.practiceUnlocked === true, 'gate flags must reflect theory mastery');
  assert(
    practiceStep.objectiveId === sessionOne.practiceObjectiveIds[0],
    'practice step must target the first unmastered practice objective',
  );

  const completeStep = selectNextCurriculumStep(base, {
    masteredObjectiveIds: base.objectives.map((objective) => objective.id),
  });
  assert(completeStep.action === 'complete' && completeStep.objectiveId === null, 'a finished plan must report complete');

  const repeatA = selectNextCurriculumStep(base, { masteredObjectiveIds: masteredNodes });
  const repeatB = selectNextCurriculumStep(base, { masteredObjectiveIds: masteredNodes });
  assert(JSON.stringify(repeatA) === JSON.stringify(repeatB), 'next-step selection must be deterministic');

  // --- 意图确认 → 冻结模板版本 → 幂等重放 ------------------------------
  const confirmedAt = '2026-10-05T09:00:00.000Z';
  const first = confirmCurriculumPlan({
    plan: base,
    projectId: 'project-1',
    confirmedAt,
    idempotencyKey: 'confirm-1',
  });
  assert(first.replayed === false, 'first confirmation is not a replay');
  assert(first.plan.projectId === 'project-1', 'confirmation must attach the project id');
  assert(first.plan.templateVersionFrozen === true, 'confirmation must freeze the template version');
  assert(first.plan.templateVersion === CURRICULUM_TEMPLATE_VERSION, 'frozen version must equal the template version');

  const replay = confirmCurriculumPlan({
    plan: base,
    projectId: 'project-1',
    confirmedAt,
    idempotencyKey: 'confirm-1',
    existing: {
      planKey: curriculumPlanKey(base),
      projectId: 'project-1',
      idempotencyKey: 'confirm-1',
      templateVersion: base.templateVersion,
      confirmedAt,
    },
  });
  assert(replay.replayed === true, 'the same idempotency key must replay, not create a second project');
  assert(replay.plan.projectId === 'project-1', 'replay must keep the first project id');

  const conflictingKey = errorOf(() =>
    confirmCurriculumPlan({
      plan: base,
      projectId: 'project-2',
      confirmedAt,
      idempotencyKey: 'confirm-2',
      existing: {
        planKey: curriculumPlanKey(base),
        projectId: 'project-1',
        idempotencyKey: 'confirm-1',
        templateVersion: base.templateVersion,
        confirmedAt,
      },
    }),
  );
  assert(
    conflictingKey.code === 'LEARNING_PLAN_TRANSITION_INVALID',
    'an already-confirmed plan must reject a second confirmation',
  );

  const drifted = errorOf(() =>
    confirmCurriculumPlan({
      plan: base,
      projectId: 'project-1',
      confirmedAt,
      idempotencyKey: 'confirm-1',
      expectedTemplateVersion: 'curriculum-plan-v0',
    }),
  );
  assert(drifted.code === 'LEARNING_PLAN_VERSION_MISMATCH', 'a frozen version must not drift');

  const beforeExplore = errorOf(() =>
    confirmCurriculumPlan({
      plan: base,
      projectId: 'project-1',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'confirm-1',
    }),
  );
  assert(
    beforeExplore.code === 'LEARNING_PLAN_TRANSITION_INVALID',
    'intent confirmation must not precede the explore phase',
  );

  const invalidPlanConfirm = errorOf(() =>
    confirmCurriculumPlan({
      plan: cyclic,
      projectId: 'project-1',
      confirmedAt,
      idempotencyKey: 'confirm-1',
    }),
  );
  assert(invalidPlanConfirm.code === 'LEARNING_PLAN_INVALID', 'an invalid plan must not be confirmed');

  const noIdempotencyKey = errorOf(() =>
    confirmCurriculumPlan({ plan: base, projectId: 'project-1', confirmedAt, idempotencyKey: '' }),
  );
  assert(noIdempotencyKey.code === 'LEARNING_PLAN_INVALID', 'the idempotency key is mandatory');

  // --- 分块表：四段齐全，实践占比逐周上升 -------------------------------
  for (const weeks of [4, 8] as const) {
    const draft = plan(weeks);
    const weekTwo = draft.sessions.find((session) => session.week === 2 && session.day === 1)!;
    assert(
      weekTwo.blocks.map((block) => block.kind).join(',') === 'review,theory,check,practice',
      `${weeks}w sessions must run review → theory → check → practice`,
    );
    const practiceMinutesFor = (week: number): number => {
      const session = draft.sessions.find((candidate) => candidate.week === week && candidate.day === 1)!;
      return session.blocks.find((block) => block.kind === 'practice')?.minutes ?? 0;
    };
    assert(
      practiceMinutesFor(weeks) > practiceMinutesFor(2),
      `${weeks}w plan must shift time towards practice in later weeks`,
    );
  }
}
