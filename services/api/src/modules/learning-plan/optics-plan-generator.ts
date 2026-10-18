import type {
  KnowledgeType,
  PblSchedule,
  SessionBlockKind,
} from '@qitu/contracts';
import {
  sessionBlockShapeFor,
} from '@qitu/ai-client';
import {
  OPTICS_GATED_OBJECTIVE_IDS,
  OPTICS_OBJECTIVES,
  OPTICS_SCHEDULES,
  OPTICS_TEMPLATE_SPEC,
} from '@qitu/ai-client/quiz-bank';
import {
  OPTICS_SESSION_MODULES,
} from '../templates/content/optics';
import { PlanGenerationError } from './session-plan-validator';
import type {
  GeneratedBlock,
  GeneratedModule,
  GeneratedObjective,
  GeneratedPlan,
  GeneratedSession,
  GeneratePlanInput,
} from './plan-generator';

/**
 * 光学 PBL 课程驱动计划生成器（纯函数，零 I/O）。
 *
 * 与通用 `DeterministicPlanGenerator` 并存：只有当 `GeneratePlanInput.curriculumSlug`
 * 命中光学模板时才由服务层调用本函数。内容单一真源：
 * - `OPTICS_OBJECTIVES` / `OPTICS_GATED_OBJECTIVE_IDS` / `OPTICS_SCHEDULES` /
 *   `OPTICS_TEMPLATE_SPEC` ← `@qitu/ai-client/quiz-bank`；
 * - `OPTICS_SESSION_MODULES` ← `services/api/src/modules/templates/content/optics.ts`。
 *
 * 不在此重新推导目标树 / 课次表；只把冻结的模板内容投影为学习计划形状：
 * - 14 objectives, including scattering/diffraction activities after the theory gate;
 * - `knowledgeType` 来自目标自身字段（与 `OPTICS_KNOWLEDGE_TYPES` 同源；`reflection`
 *   目标为 null，本文件按「永不做门禁 / 永不算分」的定性目标投影为 `design`，
 *   不改内容真源）；
 * - 4 周 × 2 节 × 60 分钟固定排课（与 `OPTICS_SCHEDULES[0]` 一致）。
 */

const OPTICS_SCHEDULE_SOURCE = OPTICS_SCHEDULES[0];
if (OPTICS_SCHEDULE_SOURCE === undefined) {
  throw new Error('光学模板缺少固定排期（OPTICS_SCHEDULES 为空）');
}
/** 课程固定的 PBL 排期（从内容层取出，而不是在此写死第二份）。 */
const OPTICS_SCHEDULE: PblSchedule = {
  durationWeeks: OPTICS_SCHEDULE_SOURCE.durationWeeks,
  weeklyMinutes: OPTICS_SCHEDULE_SOURCE.weeklyMinutes,
  sessionsPerWeek: OPTICS_SCHEDULE_SOURCE.sessionsPerWeek,
  sessionMinutes: OPTICS_SCHEDULE_SOURCE.sessionMinutes,
};

/** reflection 目标没有 `knowledgeType`，学习计划仍需要一个合法 `KnowledgeType`。 */
const REFLECTION_PLAN_TYPE: KnowledgeType = 'design';

export interface OpticsPlanContext {
  /** 模板解析出的版本 id，直接作为 `plan.templateVersion`。 */
  templateVersion: string;
}

function sameSchedule(left: PblSchedule, right: PblSchedule): boolean {
  return (
    left.durationWeeks === right.durationWeeks &&
    left.weeklyMinutes === right.weeklyMinutes &&
    left.sessionsPerWeek === right.sessionsPerWeek &&
    left.sessionMinutes === right.sessionMinutes
  );
}

function reject(path: string, message: string): never {
  throw new PlanGenerationError(message, [{ path, message }]);
}

/** 目标首次出现的周（由课次模块表推导），用于挂到周模块。 */
function objectiveWeekMap(): Map<string, number> {
  const byObjective = new Map<string, number>();
  for (const sessionModule of OPTICS_SESSION_MODULES) {
    for (const objectiveId of sessionModule.objectiveIds) {
      if (!byObjective.has(objectiveId)) byObjective.set(objectiveId, sessionModule.week);
    }
  }
  return byObjective;
}

export function generateOpticsPlan(
  input: GeneratePlanInput,
  context: OpticsPlanContext,
): GeneratedPlan {
  // 光学排课是课程内容的一部分：4 周 × 2 节 × 60 分钟。学生输入的 weeks /
  // sessionCount / schedule 与之冲突时拒绝，而不是静默忽略。
  if (input.weeks !== 4) {
    reject('weeks', `光学课程模板固定为 4 周（2 节/周），收到 ${input.weeks} 周`);
  }
  if (input.sessionCount !== undefined && input.sessionCount !== 8) {
    reject('sessionCount', `光学课程模板固定为 8 节（4 周 × 2 节），收到 ${input.sessionCount}`);
  }
  if (input.schedule !== undefined && !sameSchedule(input.schedule, OPTICS_SCHEDULE)) {
    reject(
      'schedule',
      '光学课程模板排课固定为 4 周 × 2 节 × 60 分钟，收到的 schedule 不一致',
    );
  }

  const weeks = 4;
  const minutesPerSession = OPTICS_SCHEDULE.sessionMinutes;
  const totalSessions = weeks * OPTICS_SCHEDULE.sessionsPerWeek; // 8
  const weekOfObjective = objectiveWeekMap();

  const modules: GeneratedModule[] = [];
  for (let week = 1; week <= weeks; week += 1) {
    const weekSessions = OPTICS_SESSION_MODULES.filter((item) => item.week === week);
    const first = weekSessions[0];
    modules.push({
      id: `opt-mod-w${week}`,
      name: `第 ${week} 周 · ${first?.title ?? '光学探究'}`,
      weekIndex: week,
      objective: weekSessions.map((item) => item.title).join('；'),
      ordinal: week,
    });
  }
  const moduleIdForWeek = (week: number): string => `opt-mod-w${week}`;

  const objectives: GeneratedObjective[] = OPTICS_OBJECTIVES.map((objective, index) => {
    const week = weekOfObjective.get(objective.id);
    if (week === undefined) {
      throw new Error(`光学目标 ${objective.id} 未被任何课次模块覆盖`);
    }
    return {
      id: objective.id,
      moduleId: moduleIdForWeek(week),
      name: objective.title,
      type: objective.knowledgeType ?? REFLECTION_PLAN_TYPE,
      objective: objective.description,
      prerequisiteIds: [...objective.prerequisiteIds],
      ordinal: index + 1,
      conceptId: objective.conceptId,
    };
  });

  const previousTaught = (index: number): string[] => {
    const previous = OPTICS_SESSION_MODULES[index - 1];
    return previous === undefined ? [] : [...previous.objectiveIds];
  };

  const sessions: GeneratedSession[] = OPTICS_SESSION_MODULES.map((sessionModule, index) => {
    const shape = sessionBlockShapeFor(minutesPerSession, index);
    const isFirstTheorySession =
      sessionModule.phase === 'concept_mastery' &&
      OPTICS_SESSION_MODULES.findIndex((item) => item.phase === 'concept_mastery') === index;
    const practiceObjectiveIds =
      sessionModule.phase === 'guided_practice' ? [...sessionModule.objectiveIds] : [];
    const theoryObjectiveIds =
      sessionModule.phase === 'concept_mastery'
        ? isFirstTheorySession
          ? [...OPTICS_GATED_OBJECTIVE_IDS]
          : [...sessionModule.objectiveIds]
        : sessionModule.phase === 'guided_practice'
          ? [...OPTICS_GATED_OBJECTIVE_IDS]
          : [];

    const blocks: GeneratedBlock[] = [];
    if (practiceObjectiveIds.length > 0) {
      const prerequisites = [
        ...new Set(
          practiceObjectiveIds.flatMap((id) => {
            const objective = OPTICS_OBJECTIVES.find((item) => item.id === id);
            return objective === undefined ? [] : [...objective.prerequisiteIds];
          }),
        ),
      ];
      const theoryObjectiveIdsForBlock = prerequisites.length > 0 ? prerequisites : [...sessionModule.objectiveIds];
      blocks.push(
        block(index, 'review', shape.review, previousTaught(index)),
        block(index, 'theory', shape.theory, theoryObjectiveIdsForBlock),
        block(index, 'check', shape.check, theoryObjectiveIdsForBlock),
        block(index, 'practice', shape.practice, [...sessionModule.objectiveIds], prerequisites),
        block(index, 'reflect', shape.reflect, [...sessionModule.objectiveIds]),
      );
    } else {
      blocks.push(
        block(index, 'review', shape.review, previousTaught(index)),
        block(index, 'theory', shape.theory + shape.practice, [...sessionModule.objectiveIds]),
        block(index, 'check', shape.check, [...sessionModule.objectiveIds]),
        block(index, 'reflect', shape.reflect, [...sessionModule.objectiveIds]),
      );
    }

    return {
      id: `sess-${index + 1}`,
      moduleId: moduleIdForWeek(sessionModule.week),
      index,
      week: sessionModule.week,
      day: sessionModule.session,
      title: `第 ${index + 1} 节 · ${sessionModule.title}`,
      blocks,
      theoryObjectiveIds,
      practiceObjectiveIds,
      mode: 'study',
    };
  });

  return {
    templateVersion: context.templateVersion,
    weeks,
    sessionCount: 8,
    minutesPerSession,
    schedule: OPTICS_SCHEDULE,
    title: `${input.interest} · ${weeks} 周光学探究计划`,
    interest: input.interest,
    goal: (input.goal ?? '').trim() || OPTICS_TEMPLATE_SPEC.description,
    curriculumSlug: input.curriculumSlug,
    modules,
    objectives,
    sessions,
  };
}

/** 构造一个分块：`kind` 是真源，`activity` 是旧校验器认识的投影（与通用生成器一致）。 */
function block(
  sessionIndex: number,
  kind: SessionBlockKind,
  minutes: number,
  objectiveIds: string[],
  prerequisiteObjectiveIds: string[] = [],
): GeneratedBlock {
  return {
    id: `blk-${sessionIndex}-${kind}`,
    title: BLOCK_TITLES[kind],
    minutes,
    activity: activityForKind(kind),
    kind,
    objectiveIds,
    prerequisiteObjectiveIds,
  };
}

const BLOCK_TITLES: Readonly<Record<SessionBlockKind, string>> = {
  review: '衔接回顾',
  theory: '理论讲解',
  check: '理解检查',
  practice: '动手实践',
  reflect: '反思复盘',
};

function activityForKind(kind: SessionBlockKind): GeneratedBlock['activity'] {
  switch (kind) {
    case 'review':
      return 'review';
    case 'theory':
      return 'learn';
    case 'check':
      return 'reflect';
    case 'practice':
      return 'practice';
    case 'reflect':
      return 'reflect';
  }
}
