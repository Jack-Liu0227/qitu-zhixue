import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PblSchedule } from '@qitu/contracts';
import { sessionBlockShapeFor } from '@qitu/ai-client';
import {
  MAX_OBJECTIVES_PER_SESSION,
  PLAN_BLOCK_ORDER,
  PlanGenerationError,
  PlanValidationError,
  blockShapesCoverSessionMinutes,
  expectedSessionCount,
  findPrerequisiteCycle,
  validateGeneratedPlan,
  type SessionPlanShape,
} from './session-plan-validator';
import {
  DeterministicPlanGenerator,
  assertGenerateInput,
} from './plan-generator';

/* ------------------------------------------------------------------ *
 * 帮助
 * ------------------------------------------------------------------ */

const SCHEDULE_1x120: PblSchedule = {
  durationWeeks: 4,
  weeklyMinutes: 120,
  sessionsPerWeek: 1,
  sessionMinutes: 120,
};
/**
 * 排期常量。注意 `durationWeeks × sessionsPerWeek === sessionCount`：
 * 「8 周 × 2 节」是 16 节，「4 周 × 2 节」才是 8 节——这正是必须显式给
 * `sessionCount` 的原因。
 */
const SCHEDULE_8x120: PblSchedule = {
  durationWeeks: 8,
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

function generate(input: {
  weeks: 4 | 8;
  sessionCount?: 4 | 8;
  schedule?: PblSchedule;
}): SessionPlanShape {
  return new DeterministicPlanGenerator().generate(
    assertGenerateInput({
      interest: 'Python 小游戏',
      weeks: input.weeks,
      ...(input.sessionCount === undefined ? {} : { sessionCount: input.sessionCount }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    }),
  );
}

function errorFrom(run: () => unknown): PlanGenerationError {
  try {
    run();
  } catch (error) {
    if (error instanceof PlanGenerationError) return error;
    throw error;
  }
  throw new Error('预期抛出 PlanGenerationError，但调用正常返回');
}

function messages(error: PlanGenerationError): string {
  return error.errors.map((item) => item.message).join(' | ');
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('WS4 会话计划校验器', () => {
  it('校验器抛出的错误与生成器是同一个类（instanceof 不失效）', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const error = errorFrom(() => validateGeneratedPlan({ ...plan, weeks: 5 as unknown as 4 }));
    assert.ok(error instanceof PlanGenerationError, '必须是 PlanGenerationError');
    assert.ok(error instanceof PlanValidationError, '别名必须是同一个类');
    assert.equal(error.code, 'LEARNING_PLAN_INVALID');
  });

  it('合法形状全部通过：4/8 节 × 60/120 分钟', () => {
    const shapes: Array<{ weeks: 4 | 8; sessionCount?: 4 | 8; schedule?: PblSchedule }> = [
      { weeks: 4, sessionCount: 4, schedule: SCHEDULE_1x120 },
      { weeks: 4, sessionCount: 8, schedule: SCHEDULE_4w2x60 },
      { weeks: 8, sessionCount: 8, schedule: SCHEDULE_8x120 },
      // 遗留语义：不给 sessionCount 时按 schedule / 5 节每周回退。
      { weeks: 8, schedule: SCHEDULE_8x120 },
      { weeks: 4 },
    ];
    for (const shape of shapes) {
      assert.doesNotThrow(
        () => validateGeneratedPlan(generate(shape)),
        `${shape.weeks}w/${shape.sessionCount}节/${shape.schedule?.sessionMinutes ?? 60}min 必须合法`,
      );
    }
  });

  it('分块合计必须**恰好**等于 sessionMinutes（4 节与 8 节都覆盖）', () => {
    for (const [weeks, sessionCount, schedule, minutes] of [
      [4, 4, SCHEDULE_1x120, 120],
      [8, 8, SCHEDULE_8x120, 120],
      [4, 8, SCHEDULE_4w2x60, 60],
      [8, 8, undefined, 60],
    ] as const) {
      const plan = generate({
        weeks: weeks as 4 | 8,
        sessionCount: sessionCount as 4 | 8,
        ...(schedule === undefined ? {} : { schedule }),
      });
      for (const session of plan.sessions) {
        const total = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
        assert.equal(total, minutes, `${session.id} 分块合计应为 ${minutes}，实际 ${total}`);
      }
      // 差一分钟就必须被拒。
      const off = {
        ...plan,
        sessions: plan.sessions.map((session, index) =>
          index === 0
            ? { ...session, blocks: session.blocks.map((b) => ({ ...b, minutes: b.minutes + 1 })) }
            : session,
        ),
      };
      assert.throws(() => validateGeneratedPlan(off), /正好 \d+ 分钟/);
    }
  });

  it('每节五段齐全：review / theory / check / practice / reflect', () => {
    for (const minutes of [60, 120] as const) {
      for (const total of [4, 8, 16, 20, 40] as const) {
        for (const entry of blockShapesCoverSessionMinutes(minutes, total)) {
          assert.equal(entry.total, minutes, `${minutes}min 第 ${entry.ordinal + 1} 节合计应为 ${minutes}`);
          assert.deepEqual(
            entry.kinds,
            [...PLAN_BLOCK_ORDER],
            `${minutes}min 第 ${entry.ordinal + 1} 节必须五段齐全`,
          );
        }
      }
    }
  });

  it('生成的计划里 check 与 reflect 是两个独立分块', () => {
    for (const shape of [
      { weeks: 4 as const, sessionCount: 4 as const, schedule: SCHEDULE_1x120 },
      { weeks: 8 as const, sessionCount: 8 as const, schedule: SCHEDULE_8x120 },
    ]) {
      const plan = generate(shape);
      for (const session of plan.sessions) {
        const check = session.blocks.find((block) => block.kind === 'check');
        const reflect = session.blocks.find((block) => block.kind === 'reflect');
        assert.ok(check, `${session.id} 缺少 check 分块`);
        assert.ok(reflect, `${session.id} 缺少 reflect 分块`);
        assert.notEqual(check.id, reflect.id, 'check 与 reflect 不能是同一分块');
      }
    }
  });

  it('缺少 reflect 段的分块集合被拒', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const noReflect = {
      ...plan,
      sessions: plan.sessions.map((session, index) =>
        index === 0
          ? {
              ...session,
              blocks: session.blocks.map((block) =>
                block.kind === 'reflect' ? { ...block, kind: 'check' as const } : block,
              ),
            }
          : session,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(noReflect));
    assert.ok(
      error.errors.some((item) => item.message.includes('必须包含 reflect 段')),
      `缺 reflect 必须被拒：${messages(error)}`,
    );
  });

  it('反思段必须是最后一节', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const reflectFirst = {
      ...plan,
      sessions: plan.sessions.map((session, index) => {
        if (index !== 0) return session;
        const reflect = session.blocks.filter((block) => block.kind === 'reflect');
        const rest = session.blocks.filter((block) => block.kind !== 'reflect');
        return { ...session, blocks: [...reflect, ...rest] };
      }),
    };
    const error = errorFrom(() => validateGeneratedPlan(reflectFirst));
    assert.ok(
      error.errors.some((item) => item.message.includes('反思分块必须是最后一节')),
      `反思段位置错误必须被拒：${messages(error)}`,
    );
  });

  it('课次数量错误报真实期望值，不再硬编码 weeks*5', () => {
    const oneByOneTwenty = generate({ weeks: 4, sessionCount: 4 });
    const missing = { ...oneByOneTwenty, sessions: oneByOneTwenty.sessions.slice(0, 3) };
    const error = errorFrom(() => validateGeneratedPlan(missing));
    assert.ok(
      error.errors.some((item) => item.message.includes('恰好包含 4 节课')),
      `必须报真实的 4 节：${messages(error)}`,
    );
    assert.ok(!messages(error).includes('weeks*5'), '消息里不得出现 weeks*5');

    const twoBySixty = generate({ weeks: 8, sessionCount: 8, schedule: SCHEDULE_8x120 });
    const extra = { ...twoBySixty, sessions: twoBySixty.sessions.slice(0, 7) };
    const eightError = errorFrom(() => validateGeneratedPlan(extra));
    assert.ok(
      eightError.errors.some((item) => item.message.includes('恰好包含 8 节课')),
      `必须报真实的 8 节：${messages(eightError)}`,
    );
  });

  it('每节分钟数错误报真实的 sessionMinutes', () => {
    const plan = generate({ weeks: 4, sessionCount: 4, schedule: SCHEDULE_1x120 });
    const wrongPlanMinutes = { ...plan, minutesPerSession: 90 };
    const error = errorFrom(() => validateGeneratedPlan(wrongPlanMinutes));
    assert.ok(
      error.errors.some((item) => item.message.includes('每节必须为 120 分钟')),
      `必须报真实的 120 分钟：${messages(error)}`,
    );
    assert.ok(
      error.errors.some((item) => item.message.includes('实际 90 分钟')),
      `分块合计消息必须报实际值：${messages(error)}`,
    );

    // 60 分钟计划（无 schedule 的遗留形状）必须报 60，而不是别的数。
    const sixty = generate({ weeks: 4 });
    const sixtyError = errorFrom(() => validateGeneratedPlan({ ...sixty, minutesPerSession: 120 }));
    assert.ok(
      sixtyError.errors.some((item) => item.message.includes('每节必须为 60 分钟')),
      `60 分钟计划必须报 60：${messages(sixtyError)}`,
    );
    // 分块合计的消息也必须带上真实的 sessionMinutes。
    const offBlocks = {
      ...sixty,
      sessions: sixty.sessions.map((session, index) =>
        index === 0
          ? { ...session, blocks: session.blocks.map((b) => ({ ...b, minutes: b.minutes + 7 })) }
          : session,
      ),
    };
    const offError = errorFrom(() => validateGeneratedPlan(offBlocks));
    assert.ok(
      offError.errors.some((item) => item.message.includes('正好 60 分钟')),
      `分块合计消息必须报真实的 60 分钟：${messages(offError)}`,
    );
  });

  it('覆盖率轴：模板目标必须被至少一节课引用', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const orphan = {
      ...plan,
      objectives: [
        ...plan.objectives,
        {
          id: 'obj-never-scheduled',
          moduleId: plan.modules[0]!.id,
          name: '孤儿目标',
          type: 'memory' as const,
          objective: '从未被排进任何一节的目标',
          prerequisiteIds: [],
          ordinal: plan.objectives.length,
        },
      ],
    };
    const error = errorFrom(() => validateGeneratedPlan(orphan));
    assert.ok(
      error.errors.some(
        (item) => item.message.includes('obj-never-scheduled') && item.message.includes('未被任何课次引用'),
      ),
      `未覆盖的目标必须被拒：${messages(error)}`,
    );
  });

  it('覆盖率轴对 8 节计划同样生效', () => {
    const plan = generate({ weeks: 8, sessionCount: 8, schedule: SCHEDULE_8x120 });
    const orphan = {
      ...plan,
      objectives: [
        ...plan.objectives,
        {
          id: 'obj-orphan-8',
          moduleId: plan.modules[3]!.id,
          name: '孤儿目标',
          type: 'concept' as const,
          objective: '8 节计划里未被排课的目标',
          prerequisiteIds: [],
          ordinal: plan.objectives.length,
        },
      ],
    };
    const error = errorFrom(() => validateGeneratedPlan(orphan));
    assert.ok(
      error.errors.some((item) => item.message.includes('obj-orphan-8')),
      `8 节计划也必须检出未覆盖目标：${messages(error)}`,
    );
  });

  it('全部目标都被覆盖时该轴不误报', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const referenced = new Set(
      plan.sessions.flatMap((session) => [
        ...session.blocks.flatMap((block) => block.objectiveIds),
        ...session.theoryObjectiveIds,
        ...session.practiceObjectiveIds,
      ]),
    );
    for (const objective of plan.objectives) {
      assert.ok(referenced.has(objective.id), `${objective.id} 应被某节课引用`);
    }
    assert.doesNotThrow(() => validateGeneratedPlan(plan));
  });

  it('DAG 环错误带上完整顶点路径（可行动）', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const ids = plan.objectives.map((objective) => objective.id);
    const cyclic = {
      ...plan,
      objectives: plan.objectives.map((objective) => {
        if (objective.id === ids[1]) return { ...objective, prerequisiteIds: [ids[3]!] };
        if (objective.id === ids[3]) return { ...objective, prerequisiteIds: [ids[1]!] };
        return objective;
      }),
    };
    const error = errorFrom(() => validateGeneratedPlan(cyclic));
    const cycleError = error.errors.find((item) => item.message.includes('存在环'));
    assert.ok(cycleError, `必须有环错误：${messages(error)}`);
    assert.ok(cycleError.message.includes('→'), `环错误必须给出路径箭头：${cycleError.message}`);
    assert.ok(
      cycleError.message.includes(ids[1]!) && cycleError.message.includes(ids[3]!),
      `环路径必须点名顶点：${cycleError.message}`,
    );
  });

  it('findPrerequisiteCycle 返回闭合路径；无环返回 null', () => {
    assert.equal(
      findPrerequisiteCycle([
        { id: 'a', prerequisiteIds: [] },
        { id: 'b', prerequisiteIds: ['a'] },
        { id: 'c', prerequisiteIds: ['b'] },
      ]),
      null,
      '链式 DAG 无环',
    );
    const cycle = findPrerequisiteCycle([
      { id: 'a', prerequisiteIds: ['c'] },
      { id: 'b', prerequisiteIds: ['a'] },
      { id: 'c', prerequisiteIds: ['b'] },
    ]);
    assert.ok(cycle !== null, '三节点环必须被检出');
    assert.equal(cycle[0], cycle[cycle.length - 1], '路径必须闭合');
    assert.ok(cycle.length >= 3, '三节点环至少 4 个元素（含闭合）');
  });

  it('自环被检出', () => {
    const cycle = findPrerequisiteCycle([{ id: 'a', prerequisiteIds: ['a'] }]);
    assert.ok(cycle !== null, '自环必须被检出');
    assert.deepEqual(cycle, ['a', 'a']);
  });

  it('理论先于实践：实践节缺理论门禁被拒', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const broken = {
      ...plan,
      sessions: plan.sessions.map((session) =>
        session.practiceObjectiveIds.length > 0 ? { ...session, theoryObjectiveIds: [] } : session,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(
      error.errors.some((item) => item.message.includes('必须声明理论门禁目标')),
      `实践节缺理论门禁必须被拒：${messages(error)}`,
    );
  });

  it('理论先于实践：实践目标的非理论前置被拒', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const practiceObjective = plan.objectives.find(
      (objective) => objective.type === 'procedure' || objective.type === 'design',
    );
    assert.ok(practiceObjective, '必须存在实践目标');
    const otherPractice = plan.objectives.find(
      (objective) =>
        objective.id !== practiceObjective.id &&
        (objective.type === 'procedure' || objective.type === 'design'),
    );
    assert.ok(otherPractice, '必须存在第二个实践目标');
    const broken = {
      ...plan,
      objectives: plan.objectives.map((objective) =>
        objective.id === practiceObjective.id
          ? { ...objective, prerequisiteIds: [otherPractice.id] }
          : objective,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(
      error.errors.some((item) => item.message.includes('前置必须是理论目标')),
      `实践目标的前置必须是理论目标：${messages(error)}`,
    );
  });

  it('实践分块必须携带非空 prerequisiteObjectiveIds', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const broken = {
      ...plan,
      sessions: plan.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) =>
          block.kind === 'practice' ? { ...block, prerequisiteObjectiveIds: [] } : block,
        ),
      })),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(
      error.errors.some((item) => item.message.includes('实践分块必须引用理论前置')),
      `空前置的实践分块必须被拒：${messages(error)}`,
    );
  });

  it('单节目标数上限被强制', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const extraIds = ['x-1', 'x-2', 'x-3', 'x-4', 'x-5'];
    const bloated = {
      ...plan,
      objectives: [
        ...plan.objectives,
        ...extraIds.map((id, position) => ({
          id,
          moduleId: plan.modules[0]!.id,
          name: id,
          type: 'memory' as const,
          objective: `额外目标 ${id}`,
          prerequisiteIds: [],
          ordinal: plan.objectives.length + position,
        })),
      ],
      sessions: plan.sessions.map((session, index) =>
        index === 0
          ? {
              ...session,
              blocks: session.blocks.map((block, position) =>
                position === 0 ? { ...block, objectiveIds: extraIds } : block,
              ),
            }
          : session,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(bloated));
    assert.ok(
      error.errors.some((item) =>
        item.message.includes(`单节最多 ${MAX_OBJECTIVES_PER_SESSION} 个目标`),
      ),
      `目标上限必须被强制：${messages(error)}`,
    );
  });

  it('残留 practice 分块但无实践目标被拒', () => {
    const plan = generate({ weeks: 4, sessionCount: 4 });
    const practiceSessionIndex = plan.sessions.findIndex(
      (session) => session.practiceObjectiveIds.length > 0,
    );
    assert.ok(practiceSessionIndex >= 0);
    const broken = {
      ...plan,
      sessions: plan.sessions.map((session, index) =>
        index === practiceSessionIndex
          ? {
              ...session,
              practiceObjectiveIds: [],
              theoryObjectiveIds: [session.theoryObjectiveIds[0]!],
            }
          : session,
      ),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(
      error.errors.some((item) => item.message.includes('不应包含 practice 分块')),
      `无实践目标却保留 practice 分块必须被拒：${messages(error)}`,
    );
  });

  it('全部违规被收集后一次性抛出（不是只报第一条）', () => {
    const plan = generate({ weeks: 4, sessionCount: 4, schedule: SCHEDULE_1x120 });
    const broken = {
      ...plan,
      minutesPerSession: 60,
      interest: '',
      goal: 'x'.repeat(400),
      sessions: plan.sessions.slice(0, 3),
    };
    const error = errorFrom(() => validateGeneratedPlan(broken));
    assert.ok(error.errors.length >= 3, `必须收集全部违规，实际 ${error.errors.length} 条`);
    assert.ok(
      messages(error).includes('恰好包含 4 节课') && messages(error).includes('每节必须为 120 分钟'),
      `必须同时报课次与时长：${messages(error)}`,
    );
  });

  it('expectedSessionCount：显式 sessionCount 优先，否则回退旧语义', () => {
    assert.equal(expectedSessionCount({ weeks: 4, sessionCount: 4 }), 4);
    assert.equal(expectedSessionCount({ weeks: 4, sessionCount: 8 }), 8);
    assert.equal(expectedSessionCount({ weeks: 4 }), 20);
    assert.equal(expectedSessionCount({ weeks: 8 }), 40);
    assert.equal(expectedSessionCount({ weeks: 8, schedule: SCHEDULE_4w2x60 }), 16);
    assert.equal(expectedSessionCount({ weeks: 4, schedule: SCHEDULE_1x120 }), 4);
  });

  it('sessionBlockShapeFor 拒绝非法入参并保持整数', () => {
    assert.throws(() => sessionBlockShapeFor(0, 0), /正整数分钟/);
    assert.throws(() => sessionBlockShapeFor(60, -1), /从 0 起的整数/);
    assert.throws(() => sessionBlockShapeFor(10, 0), /至少要 25 分钟/);
    for (const minutes of [60, 120]) {
      for (let ordinal = 0; ordinal < 40; ordinal += 1) {
        const shape = sessionBlockShapeFor(minutes, ordinal);
        const total = shape.review + shape.theory + shape.check + shape.practice + shape.reflect;
        assert.equal(total, minutes, `${minutes}min ordinal=${ordinal} 合计 ${total}`);
        for (const [segment, value] of Object.entries(shape)) {
          assert.ok(Number.isInteger(value) && value > 0, `${segment} 必须是正整数，实际 ${value}`);
        }
      }
    }
  });
});
