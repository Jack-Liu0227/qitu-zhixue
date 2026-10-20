import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PblSchedule } from '@qitu/contracts';
import { sessionBlockShapeFor } from '@qitu/ai-client';
import {
  DeterministicPlanGenerator,
  MAX_OBJECTIVES_PER_SESSION,
  PlanGenerationError,
  assertGenerateInput,
  blockShapesCoverSessionMinutes,
  expectedSessionCount,
  findPrerequisiteCycle,
  kindForActivity,
  activityForKind,
  validateGeneratedPlan,
  type GeneratedPlan,
} from './plan-generator';
import {
  buildPlanOutline,
  outlineIdempotencyKey,
  persistPlanOutline,
  persistSessionTeachingPlan,
  generateSessionTeachingPlan,
  sessionPlanIdempotencyKey,
  assertOutlineMutable,
  type PlanOutline,
  type PlanOutlineStore,
  type SessionTeachingPlan,
} from './plan-outline';

/* ------------------------------------------------------------------ *
 * 帮助函数
 * ------------------------------------------------------------------ */

function generate(input: {
  lessonCount: 4 | 8;
  schedule?: PblSchedule;
  sessionCount?: 4 | 8;
  interest?: string;
}): GeneratedPlan {
  const parsed = assertGenerateInput({
    interest: input.interest ?? 'Python 小游戏',
    lessonCount: input.lessonCount,
    ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    ...(input.sessionCount === undefined ? {} : { sessionCount: input.sessionCount }),
  });
  return new DeterministicPlanGenerator().generate(parsed);
}

function withPlanId(plan: GeneratedPlan, id = 'plan-1'): GeneratedPlan & { id: string } {
  return { ...plan, id };
}

const SCHEDULE_1x120: PblSchedule = {
  durationWeeks: 4,
  weeklyMinutes: 120,
  sessionsPerWeek: 1,
  sessionMinutes: 120,
};
const SCHEDULE_4w2x60: PblSchedule = {
  durationWeeks: 4,
  weeklyMinutes: 120,
  sessionsPerWeek: 2,
  sessionMinutes: 60,
};
const SCHEDULE_8x120: PblSchedule = {
  durationWeeks: 8,
  weeklyMinutes: 120,
  sessionsPerWeek: 1,
  sessionMinutes: 120,
};

/** 内存版大纲存储，模拟幂等 upsert。 */
class FakeOutlineStore implements PlanOutlineStore {
  outlines = new Map<string, PlanOutline>();
  sessionPlans = new Map<string, SessionTeachingPlan>();
  writes = 0;

  async upsertOutline(outline: PlanOutline) {
    this.writes += 1;
    this.outlines.set(outline.planId, outline);
    return { outline, created: true };
  }
  async findOutline(planId: string) {
    return this.outlines.get(planId) ?? null;
  }
  async upsertSessionTeachingPlan(plan: SessionTeachingPlan) {
    this.writes += 1;
    this.sessionPlans.set(sessionPlanIdempotencyKey(plan.planId, plan.sessionIndex), plan);
    return { plan, created: true };
  }
  async findSessionTeachingPlan(planId: string, sessionIndex: number) {
    return this.sessionPlans.get(sessionPlanIdempotencyKey(planId, sessionIndex)) ?? null;
  }
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('WS4 会话制课程生成器', () => {
  it('显式 sessionCount=4 与 8 都生成恰好 4 节 / 8 节', () => {
    for (const [sessionCount, lessonCount] of [
      [4, 4],
      [8, 4],
      [8, 8],
    ] as const) {
      const plan = generate({ lessonCount, sessionCount });
      assert.equal(plan.sessionCount, sessionCount, `sessionCount=${sessionCount} 应原样保留`);
      assert.equal(plan.sessions.length, sessionCount, `必须恰好 ${sessionCount} 节课`);
      assert.doesNotThrow(() => validateGeneratedPlan(plan));
    }
  });

  it('sessionCount 与 lessonCount × 每周节数不自洽时拒绝', () => {
    // lessonCount=8 + 1 节/周 = 8 节，传 4 节不自洽。
    // 8 周 × 1 节/周 = 8 节，却声明 4 节。
    assert.throws(
      () =>
        assertGenerateInput({
          interest: '机器人',
          lessonCount: 8,
          sessionCount: 4,
          schedule: SCHEDULE_8x120,
        }),
      PlanGenerationError,
    );
    // 4 周 × 2 节/周 = 8 节，却声明 4 节。
    assert.throws(
      () =>
        assertGenerateInput({
          interest: '机器人',
          lessonCount: 4,
          sessionCount: 4,
          schedule: SCHEDULE_4w2x60,
        }),
      PlanGenerationError,
    );
    assert.throws(
      () => assertGenerateInput({ interest: '机器人', lessonCount: 4, sessionCount: 6 }),
      PlanGenerationError,
    );
  });

  it('每节分块合计恰好等于 sessionMinutes，且五段齐全（含 reflect）', () => {
    for (const sessionMinutes of [60, 120] as const) {
      for (const totalSessions of [4, 8, 16, 20, 40] as const) {
        for (const entry of blockShapesCoverSessionMinutes(sessionMinutes, totalSessions)) {
          assert.equal(
            entry.total,
            sessionMinutes,
            `${sessionMinutes} 分钟第 ${entry.ordinal + 1} 节合计为 ${entry.total}`,
          );
          assert.deepEqual(
            entry.kinds,
            ['review', 'theory', 'check', 'practice', 'reflect'],
            `${sessionMinutes} 分钟第 ${entry.ordinal + 1} 节必须五段齐全`,
          );
        }
      }
    }
  });

  it('生成的四节课计划里每节都包含 reflect 段，且与 check 可区分', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4, schedule: SCHEDULE_1x120 });
    for (const session of plan.sessions) {
      const kinds = session.blocks.map((block) => block.kind);
      assert.ok(kinds.includes('reflect'), `${session.id} 缺少 reflect 段`);
      assert.ok(kinds.includes('check'), `${session.id} 缺少 check 段`);
      // 反思与检查是两个不同的分块，不再被折叠成同一个 kind。
      assert.notEqual(
        session.blocks.find((block) => block.kind === 'check')?.id,
        session.blocks.find((block) => block.kind === 'reflect')?.id,
      );
    }
  });

  it('旧 activity 投影不可逆：check 与 reflect 都投成 reflect', () => {
    assert.equal(activityForKind('check'), 'reflect');
    assert.equal(activityForKind('reflect'), 'reflect');
    assert.equal(kindForActivity('reflect'), 'check');
  });

  it('校验消息使用真实期望值，而不是写死的 lessonCount*5 / 60', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4, schedule: SCHEDULE_1x120 });
    // 少一节课：消息必须报 4 节，而不是 lessonCount*5 = 20。
    const missing = { ...plan, sessions: plan.sessions.slice(0, 3) };
    const countError = errorFrom(() => validateGeneratedPlan(missing));
    assert.ok(
      countError.errors.some((error) => error.message.includes('4 节课')),
      `错误消息必须报真实的 4 节：${JSON.stringify(countError.errors)}`,
    );
    assert.ok(
      !countError.errors.some((error) => error.message.includes('20')),
      '不得再出现写死的 lessonCount*5',
    );

    // 每节分钟数被改：消息必须报真实的 120 分钟，而不是写死的 60。
    const wrongMinutes = { ...plan, minutesPerSession: 60 };
    const minuteError = errorFrom(() => validateGeneratedPlan(wrongMinutes));
    assert.ok(
      minuteError.errors.some((error) => error.message.includes('每节必须为 120 分钟')),
      `错误消息必须报真实的 120 分钟：${JSON.stringify(minuteError.errors)}`,
    );
  });

  it('未被任何课次引用的目标是错误（覆盖率轴）', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4 });
    const orphan = {
      ...plan,
      objectives: [
        ...plan.objectives,
        {
          id: 'obj-orphan',
          moduleId: plan.modules[0]!.id,
          name: '孤儿目标',
          type: 'memory' as const,
          objective: '永远不会被排课的目标',
          prerequisiteIds: [],
          ordinal: plan.objectives.length,
        },
      ],
    };
    const error = errorFrom(() => validateGeneratedPlan(orphan));
    assert.ok(
      error.errors.some((item) => item.message.includes('obj-orphan') && item.message.includes('未被任何课次引用')),
      `未覆盖的目标必须被拒：${JSON.stringify(error.errors)}`,
    );
  });

  it('有环的前置图被拒，且错误里带上环上的顶点路径', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4 });
    const theoryIds = plan.objectives
      .filter((objective) => objective.type === 'memory' || objective.type === 'concept')
      .map((objective) => objective.id);
    assert.ok(theoryIds.length >= 2, '至少需要两个理论目标才能构造环');
    const [firstTheory, secondTheory] = theoryIds;
    const cyclic = {
      ...plan,
      objectives: plan.objectives.map((objective) => {
        if (objective.id === firstTheory) return { ...objective, prerequisiteIds: [secondTheory!] };
        if (objective.id === secondTheory) return { ...objective, prerequisiteIds: [firstTheory!] };
        return objective;
      }),
    };
    const error = errorFrom(() => validateGeneratedPlan(cyclic));
    const cycleError = error.errors.find((item) => item.message.includes('存在环'));
    assert.ok(cycleError, `必须有环错误：${JSON.stringify(error.errors)}`);
    assert.ok(cycleError.message.includes('→'), `环错误必须给出路径：${cycleError.message}`);
    assert.ok(
      cycleError.message.includes(firstTheory!) && cycleError.message.includes(secondTheory!),
      `环路径必须包含两个顶点：${cycleError.message}`,
    );
  });

  it('findPrerequisiteCycle 返回闭合路径，无环时返回 null', () => {
    assert.equal(
      findPrerequisiteCycle([
        { id: 'a', prerequisiteIds: [] },
        { id: 'b', prerequisiteIds: ['a'] },
      ]),
      null,
    );
    const cycle = findPrerequisiteCycle([
      { id: 'a', prerequisiteIds: ['b'] },
      { id: 'b', prerequisiteIds: ['a'] },
    ]);
    assert.ok(cycle !== null, '必须检出环');
    assert.equal(cycle[0], cycle[cycle.length - 1], '环路径必须闭合');
    assert.ok(cycle.length >= 2, '环路径至少包含两个顶点');
  });

  it('理论先于实践：每个实践目标的前置恒为同节/更早的理论目标', () => {
    for (const [lessonCount, sessionCount, schedule] of [
      [4, 4, SCHEDULE_1x120],
      [4, 8, undefined],
      [8, 8, SCHEDULE_8x120],
    ] as const) {
      const plan = generate({ lessonCount, sessionCount, ...(schedule === undefined ? {} : { schedule }) });
      const byId = new Map(plan.objectives.map((objective) => [objective.id, objective]));
      for (const session of plan.sessions) {
        for (const objectiveId of session.practiceObjectiveIds) {
          const objective = byId.get(objectiveId);
          assert.ok(objective, `${objectiveId} 必须存在`);
          assert.ok(objective.prerequisiteIds.length > 0, `${objectiveId} 必须有理论前置`);
          const theoryPrerequisite = objective.prerequisiteIds.find((candidateId) =>
            ['memory', 'concept'].includes(byId.get(candidateId)?.type ?? ''),
          );
          assert.ok(theoryPrerequisite, `${objectiveId} 的前置必须是理论目标`);
          assert.ok(
            session.theoryObjectiveIds.length > 0,
            `${session.id} 是实践会话，必须声明理论门禁目标`,
          );
        }
        for (const block of session.blocks) {
          if (block.kind === 'practice') {
            assert.ok(
              block.prerequisiteObjectiveIds.length > 0,
              `${block.id} 实践分块必须携带非空 prerequisiteObjectiveIds`,
            );
          }
        }
      }
    }
  });

  it('实践会话缺少 theoryObjectiveIds 时被拒', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4 });
    const broken = {
      ...plan,
      sessions: plan.sessions.map((session) =>
        session.practiceObjectiveIds.length > 0
          ? { ...session, theoryObjectiveIds: [] }
          : session,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(
      error.errors.some((item) => item.message.includes('必须声明理论门禁目标')),
      `实践会话缺理论门禁必须被拒：${JSON.stringify(error.errors)}`,
    );
  });

  it('单节目标数超过上限被拒', () => {
    const plan = generate({ lessonCount: 4, sessionCount: 4 });
    const bloated = {
      ...plan,
      sessions: plan.sessions.map((session, index) =>
        index === 0
          ? {
              ...session,
              blocks: session.blocks.map((block, position) =>
                position === 0
                  ? { ...block, objectiveIds: ['x-1', 'x-2', 'x-3', 'x-4', 'x-5'] }
                  : block,
              ),
            }
          : session,
      ),
      objectives: [
        ...plan.objectives,
        ...['x-1', 'x-2', 'x-3', 'x-4', 'x-5'].map((id, position) => ({
          id,
          moduleId: plan.modules[0]!.id,
          name: id,
          type: 'memory' as const,
          objective: `额外目标 ${id}`,
          prerequisiteIds: [],
          ordinal: plan.objectives.length + position,
        })),
      ],
    };
    const error = errorFrom(() => validateGeneratedPlan(bloated));
    assert.ok(
      error.errors.some((item) => item.message.includes(`单节最多 ${MAX_OBJECTIVES_PER_SESSION} 个目标`)),
      `目标上限必须被强制：${JSON.stringify(error.errors)}`,
    );
  });

  it('畸形 schedule 抛 LEARNING_PLAN_INVALID，且不写出任何计划', () => {
    for (const bad of [
      { durationWeeks: 8, weeklyMinutes: 120, sessionsPerWeek: 1, sessionMinutes: 120 },
      { durationWeeks: 4, weeklyMinutes: 90, sessionsPerWeek: 1, sessionMinutes: 90 },
      { durationWeeks: 4, weeklyMinutes: 120, sessionsPerWeek: 3, sessionMinutes: 40 },
    ]) {
      assert.throws(
        () => assertGenerateInput({ interest: '机器人', lessonCount: 4, schedule: bad }),
        (error: unknown) => {
          assert.ok(error instanceof PlanGenerationError);
          assert.equal(error.code, 'LEARNING_PLAN_INVALID');
          return true;
        },
      );
    }
  });

  it('expectedSessionCount 优先用显式 sessionCount，否则回退旧语义', () => {
    assert.equal(expectedSessionCount({ lessonCount: 4, sessionCount: 4 }), 4);
    assert.equal(expectedSessionCount({ lessonCount: 4, sessionCount: 8 }), 8);
    // 旧语义：lessonCount * sessionsPerWeek，默认 5 节/周。
    assert.equal(expectedSessionCount({ lessonCount: 4 }), 20);
    assert.equal(expectedSessionCount({ lessonCount: 8, schedule: SCHEDULE_4w2x60 }), 16);
  });

  it('4 节与 8 节计划在 60/120 分钟下都通过完整校验', () => {
    const shapes: Array<{ lessonCount: 4 | 8; sessionCount: 4 | 8; schedule?: PblSchedule }> = [
      { lessonCount: 4, sessionCount: 4, schedule: SCHEDULE_1x120 },
      { lessonCount: 4, sessionCount: 8 },
      { lessonCount: 8, sessionCount: 8, schedule: SCHEDULE_8x120 },
      { lessonCount: 4, sessionCount: 4 },
      { lessonCount: 4, sessionCount: 8, schedule: { ...SCHEDULE_1x120, sessionsPerWeek: 2, durationWeeks: 4, sessionMinutes: 60, weeklyMinutes: 120 } },
    ];
    for (const shape of shapes) {
      const plan = generate(shape.lessonCount === 8 ? { ...shape, lessonCount: 8 } : shape);
      assert.doesNotThrow(
        () => validateGeneratedPlan(plan),
        `${shape.lessonCount} 周 ${shape.sessionCount} 节 ${shape.schedule?.sessionMinutes ?? 60} 分钟必须合法`,
      );
    }
  });

  it('sessionBlockShapeFor 拒绝非法入参', () => {
    assert.throws(() => sessionBlockShapeFor(0, 0), /正整数分钟/);
    assert.throws(() => sessionBlockShapeFor(60, -1), /从 0 起的整数/);
    assert.throws(() => sessionBlockShapeFor(10, 0), /至少要 25 分钟/);
  });
});

describe('WS4 大纲阶段（outline）', () => {
  it('大纲由计划结构推导，逐节列出目标与分块类型', () => {
    const generated = generate({ lessonCount: 4, sessionCount: 4, schedule: SCHEDULE_1x120 });
    const plan = withPlanId(generated);
    const outline = buildPlanOutline(plan, new Date('2026-10-15T00:00:00.000Z'));
    assert.equal(outline.planId, 'plan-1');
    assert.equal(outline.id, 'outline:plan-1');
    assert.equal(outline.sessions.length, 4);
    assert.equal(outline.sessionCount, 4);
    assert.equal(outline.minutesPerSession, 120);
    assert.equal(outline.revision, 1);
    for (const entry of outline.sessions) {
      assert.equal(entry.minutes, 120, `第 ${entry.sessionIndex + 1} 节大纲分钟数必须是 120`);
      assert.ok(entry.objectiveIds.length > 0, '大纲条目必须列出目标');
      // 理论课没有实践目标，因此不排 practice 分块；实践课五段齐全。
      const expectedKinds = entry.blockKinds.includes('practice')
        ? ['review', 'theory', 'check', 'practice', 'reflect']
        : ['review', 'theory', 'check', 'reflect'];
      assert.deepEqual(entry.blockKinds, expectedKinds, `第 ${entry.sessionIndex + 1} 节分块形状`);
    }
    const withPractice = outline.sessions.filter((entry) => entry.blockKinds.includes('practice'));
    assert.equal(withPractice.length, 2, '4 节计划里应有 2 节实践课');
  });

  it('大纲本身不含任何学生作答或对话内容（最小化）', () => {
    const plan = withPlanId(generate({ lessonCount: 4, sessionCount: 4 }));
    const outline = buildPlanOutline(plan, new Date());
    const serialized = JSON.stringify(outline);
    for (const forbidden of ['answer', 'expectedAnswer', 'transcript', 'utterance', 'content']) {
      assert.ok(!serialized.includes(forbidden), `大纲不得出现 ${forbidden}`);
    }
  });

  it('落库幂等：同一计划重复写入返回既有大纲，不产生第二份', async () => {
    const store = new FakeOutlineStore();
    const plan = withPlanId(generate({ lessonCount: 4, sessionCount: 4 }));
    const outline = buildPlanOutline(plan, new Date());
    const first = await persistPlanOutline(store, outline);
    const second = await persistPlanOutline(store, buildPlanOutline(plan, new Date()));
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(store.writes, 1, '第二次写入必须是重放，不新增行');
    assert.equal(await store.findOutline('plan-1'), first.outline);
  });

  it('确认后大纲不可变：拒绝重建', () => {
    assert.throws(
      () => assertOutlineMutable({ confirmedAt: '2026-10-15T00:00:00.000Z' }),
      PlanGenerationError,
    );
    assert.doesNotThrow(() => assertOutlineMutable({ confirmedAt: null }));
  });

  it('教学计划按课次展开：8 节计划不会一次物化 8 份', async () => {
    const store = new FakeOutlineStore();
    const plan = withPlanId(generate({ lessonCount: 8, sessionCount: 8 }));
    const outline = buildPlanOutline(plan, new Date());
    assert.equal(outline.sessions.length, 8);

    // 只展开第 0 节。
    const first = generateSessionTeachingPlan(outline, plan, 0, new Date());
    assert.equal(first.sessionIndex, 0);
    assert.equal(first.id, 'session-plan:plan-1:0');
    assert.equal(first.mode, 'study');
    await persistSessionTeachingPlan(store, first);
    assert.equal(store.sessionPlans.size, 1, '只展开了 1 节，落库只应有 1 行');

    // 幂等：同一课次重复展开返回既有行。
    const replay = await persistSessionTeachingPlan(
      store,
      generateSessionTeachingPlan(outline, plan, 0, new Date()),
    );
    assert.equal(replay.created, false);
    assert.equal(store.sessionPlans.size, 1);

    // 按需展开第 5 节。
    const fifth = generateSessionTeachingPlan(outline, plan, 5, new Date());
    await persistSessionTeachingPlan(store, fifth);
    assert.equal(store.sessionPlans.size, 2);
  });

  it('教学计划保留先理论后实践结构：实践节声明理论门禁与证据引用', () => {
    const plan = withPlanId(generate({ lessonCount: 4, sessionCount: 4 }));
    const outline = buildPlanOutline(plan, new Date());
    const practiceSession = plan.sessions.find((session) => session.practiceObjectiveIds.length > 0);
    assert.ok(practiceSession, '4 节计划里必须有实践节');
    const teaching = generateSessionTeachingPlan(outline, plan, practiceSession.index, new Date());
    assert.ok(teaching.theoryObjectiveIds.length > 0, '实践节必须声明理论门禁');
    assert.ok(teaching.practiceObjectiveIds.length > 0, '实践节必须有实践目标');
    assert.deepEqual(
      teaching.requiredEvidenceIds,
      teaching.practiceObjectiveIds.map((id) => `evidence:${id}`),
    );
    assert.ok(
      teaching.blocks.some((block) => block.kind === 'practice'),
      '实践节必须含 practice 分块',
    );
  });

  it('越界课次被拒，而不是静默返回空计划', () => {
    const plan = withPlanId(generate({ lessonCount: 4, sessionCount: 4 }));
    const outline = buildPlanOutline(plan, new Date());
    assert.throws(
      () => generateSessionTeachingPlan(outline, plan, 9, new Date()),
      PlanGenerationError,
    );
    assert.throws(
      () => generateSessionTeachingPlan(outline, plan, -1, new Date()),
      PlanGenerationError,
    );
  });

  it('幂等键形状稳定', () => {
    assert.equal(outlineIdempotencyKey('plan-9'), 'outline:plan-9');
    assert.equal(sessionPlanIdempotencyKey('plan-9', 3), 'session-plan:plan-9:3');
  });
});

/* ------------------------------------------------------------------ *
 * 断言帮助
 * ------------------------------------------------------------------ */

function errorFrom(run: () => unknown): PlanGenerationError {
  try {
    run();
  } catch (error) {
    if (error instanceof PlanGenerationError) return error;
    throw error;
  }
  throw new Error('预期抛出 PlanGenerationError，但调用正常返回');
}
