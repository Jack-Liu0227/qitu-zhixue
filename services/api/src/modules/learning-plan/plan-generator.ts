import type {
  KnowledgeType,
  LearningPlanBlockActivity,
  LearningPlanWeeks,
  PblSchedule,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';
import {
  sessionBlockShapeFor,
  validateLearningPlanDraft,
  type BlockShape,
  type LearningPlanDraft,
} from '@qitu/ai-client';
import { validatePblSchedule } from '@qitu/contracts';
import {
  PlanGenerationError,
  PlanValidationError,
  blockShapesCoverSessionMinutes,
  expectedSessionCount,
  findPrerequisiteCycle,
  scheduleViolations,
  validateGeneratedPlan,
  MAX_OBJECTIVES_PER_SESSION,
  PLAN_BLOCK_ORDER,
  type PlanViolation,
  type SessionPlanShape,
} from './session-plan-validator';

export {
  PlanGenerationError,
  PlanValidationError,
  validateGeneratedPlan,
  findPrerequisiteCycle,
  expectedSessionCount,
  scheduleViolations,
  blockShapesCoverSessionMinutes,
  MAX_OBJECTIVES_PER_SESSION,
  PLAN_BLOCK_ORDER,
  type PlanViolation,
  type SessionPlanShape,
};

/**
 * 显式课次数量。4 与 8 是产品决定，不是调度字段的副产品。
 *
 * 本文件先落地类型，`packages/contracts` 的对应导出是 WS1 的写入边界（此处
 * **不**改 contracts），接线方式见文件末尾的说明与最终报告里的 hand-off。
 */
export type PlanSessionCount = 4 | 8;

/**
 * 计划生成 + 不可信模型输出的校验边界（纯函数）。
 *
 * `POST /learning-plans` 的「生成」是一个端口：默认实现是确定性的
 * `DeterministicPlanGenerator`，测试可以注入畸形实现来证明「模型输出不可信，
 * 结构非法必须被拒绝而不是被静默修复」。
 *
 * 单元：**次课**。`sessionCount`（4 或 8）是显式输入，不再由 `weeks` 乘出。
 * `weeks` 保留只为向后兼容（旧请求没有 `sessionCount`，按 5 节/周摊到各周）。
 *
 * 一节课五段：复习/导入（review）、理论学习（theory）、检查（check）、实践
 * （practice）、反思（reflect）。形状由 `sessionBlockShapeFor(sessionMinutes,
 * ordinal)` 唯一决定——那是 `@qitu/ai-client` 里的**唯一**分块策略，本文件不再
 * 自带第二套（此前 60/120 双档散在这里，与 curriculum.ts 的周索引表分歧）。
 *
 * 校验只有一个入口 `validateGeneratedPlan`，它委托 `session-plan-validator.ts`
 * 收集**全部**违规后一次性抛出。任何一条不过都抛 `PlanGenerationError`
 * （`LEARNING_PLAN_INVALID`），绝不「修正后继续」。
 *
 * 结构采用「理论课 → 实践课」交替：理论课引入理论目标并完成 `TheoryMastered`，
 * 实践课引用**上一节理论课**的目标（`prerequisiteObjectiveIds` 必须已完成，
 * 与 `validateLearningPlanDraft` 的 DAG 语义一致），运行时再按
 * `theoryObjectiveIds` 二次做 `TheoryMastered` 门禁。
 */

/** 冻结的课程模板版本。确认计划时该值不可漂移（计划确认后不可变）。 */
export const CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1';

export const MIN_INTEREST_LENGTH = 1;
export const MAX_INTEREST_LENGTH = 60;
export const MAX_GOAL_LENGTH = 200;
export const MINUTES_PER_SESSION = 60;

/** 允许的显式课次数量。4 与 8 是产品决定，不是调度字段的副产品。 */
export const SESSION_COUNT_OPTIONS: readonly PlanSessionCount[] = [4, 8];

export interface GeneratedObjective {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: string[];
  ordinal: number;
}

export interface GeneratedModule {
  id: string;
  name: string;
  weekIndex: number;
  objective: string;
  ordinal: number;
}

export interface GeneratedBlock {
  id: string;
  title: string;
  minutes: number;
  activity: LearningPlanBlockActivity;
  /**
   * 服务端真源的分块类型。`activity` 是给旧版校验器/旧消费者的投影，两者由
   * 生成期同时写入；`kind` 才能区分 `check` 与 `reflect`（旧投影把两者都压成
   * `reflect`，所以只靠 `activity` 无法还原）。
   */
  kind: SessionBlockKind;
  objectiveIds: string[];
  prerequisiteObjectiveIds: string[];
}

export interface GeneratedSession {
  id: string;
  moduleId: string;
  index: number;
  week: number;
  day: number;
  title: string;
  blocks: GeneratedBlock[];
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  mode: SessionMode;
}

export interface GeneratedPlan {
  templateVersion: string;
  weeks: LearningPlanWeeks;
  /** 显式课次数量。4 或 8；与 `weeks` 并存，不互相推导。 */
  sessionCount: PlanSessionCount;
  minutesPerSession: number;
  /** Explicit PBL timing; omitted for legacy `weeks` requests. */
  schedule?: PblSchedule;
  title: string;
  interest: string;
  goal: string;
  modules: GeneratedModule[];
  objectives: GeneratedObjective[];
  sessions: GeneratedSession[];
}

export interface GeneratePlanInput {
  interest: string;
  weeks: LearningPlanWeeks;
  goal: string | null;
  /** New PBL schedule. Omitted requests retain legacy 5 x 60-minute semantics. */
  schedule?: PblSchedule;
  /**
   * 显式课次数量。省略时按 `weeks * sessionsPerWeek` 回退（旧语义，5 节/周）。
   * 给出时必须与 `weeks` 自洽：4 节 ↔ 4 周，8 节 ↔ 4 周 2 节/周 或 8 周。
   */
  sessionCount?: PlanSessionCount;
}

/**
 * 客户端**绝不允许**提供、服务端**绝不允许**采信的字段。
 *
 * 这些字段是服务端状态（阶段、掌握度、理论门禁、项目归属、版本）。请求体里出现
 * 它们一律 400 `LEARNING_PLAN_INVALID`：既不复用也不静默丢弃，避免调用方误以为
 * 「传了 stage 就能跳阶段」。控制器在写接口第一时间调用
 * `assertNoServerOwnedFields`。
 */
export const SERVER_OWNED_FIELDS: readonly string[] = [
  'stage',
  'mastery',
  'masteryScore',
  'masteryBasisPoints',
  'qualitativeMastered',
  'theoryMastered',
  'practiceUnlocked',
  'projectId',
  'project',
  'status',
  'confirmedAt',
  'completedAt',
  'version',
  'studentUserId',
  'templateVersion',
  'templateVersionId',
  'objectiveStatus',
];

/** 命中服务端专属字段时抛 `PlanGenerationError`（控制器翻译为 400）。 */
export function assertNoServerOwnedFields(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const source = body as Record<string, unknown>;
  const offending = SERVER_OWNED_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(source, field),
  );
  if (offending.length > 0) {
    throw new PlanGenerationError(
      `请求体包含服务端专属字段，已拒绝：${offending.join(', ')}`,
      offending.map((field) => ({ path: field, message: 'server-owned field' })),
    );
  }
}

/** 计划生成端口。实现可以是模型，也可以是确定性模板；输出一律不可信。 */
export abstract class PlanGenerator {
  abstract generate(input: GeneratePlanInput): GeneratedPlan;
}

/**
 * 由次课数量与周数推出「每周几节」。
 *
 * 课次是单元，周只是排期容器：4 节摊进 4 周即每周 1 节；8 节摊进 4 周即每周 2 节。
 */
export function sessionsPerWeekFor(weeks: LearningPlanWeeks, sessionCount: number): number {
  if (sessionCount % weeks !== 0) {
    throw new PlanGenerationError(
      `${sessionCount} 节课无法均分到 ${weeks} 周`,
      [{ path: 'sessionCount', message: `sessionCount ${sessionCount} is not divisible by weeks ${weeks}` }],
    );
  }
  return sessionCount / weeks;
}

/**
 * 确定性课程模板：理论课与实践课交替，每节课五段。
 *
 * - 形状来自唯一策略 `sessionBlockShapeFor(minutesPerSession, ordinal)`；
 * - 理论目标类型在 `memory` / `concept` 间轮转，实践目标在 `procedure` / `design`
 *   间轮转，保证量化与质化两条门槛都被真实覆盖；
 * - 每个实践目标的前置恒为**同节理论目标**（`prerequisiteIds = [theory.id]`），
 *   结构上不存在「实践排在其理论之前」。
 */
export class DeterministicPlanGenerator extends PlanGenerator {
  generate(input: GeneratePlanInput): GeneratedPlan {
    const interest = input.interest.trim();
    const weeks = input.weeks;
    const schedule = input.schedule;
    const minutesPerSession = schedule?.sessionMinutes ?? MINUTES_PER_SESSION;
    const explicitCount = input.sessionCount;
    const derivedCount = weeks * (schedule?.sessionsPerWeek ?? 5);
    const sessionCount = explicitCount ?? derivedCount;
    if (!Number.isInteger(sessionCount) || sessionCount <= 0) {
      throw new PlanGenerationError(`课次数量非法：${sessionCount}`, [
        { path: 'sessionCount', message: 'sessionCount must be a positive integer' },
      ]);
    }
    const sessionsPerWeek = sessionsPerWeekFor(weeks, sessionCount);
    const totalSessions = sessionCount;
    const title = `${interest} · ${weeks} 周学习计划`;
    const goal = (input.goal ?? '').trim() || `用 ${weeks} 周时间掌握「${interest}」的核心知识与实践能力`;

    const modules: GeneratedModule[] = [];
    for (let week = 1; week <= weeks; week += 1) {
      modules.push({
        id: `mod-w${week}`,
        name: `第 ${week} 周 · ${interest}`,
        weekIndex: week,
        objective: `完成第 ${week} 周的理论理解与实践任务`,
        ordinal: week,
      });
    }

    const objectives: GeneratedObjective[] = [];
    const sessions: GeneratedSession[] = [];
    const moduleIdFor = (index: number): string => `mod-w${Math.floor(index / sessionsPerWeek) + 1}`;

    for (let index = 0; index < totalSessions; index += 1) {
      const day = (index % sessionsPerWeek) + 1;
      const week = Math.floor(index / sessionsPerWeek) + 1;
      const moduleId = moduleIdFor(index);
      const ordinal = Math.floor(index / 2);
      const isTheorySession = index % 2 === 0;
      const shape = sessionBlockShapeFor(minutesPerSession, index);

      if (isTheorySession) {
        const theory: GeneratedObjective = {
          id: `obj-t-${index}`,
          moduleId,
          name: `${interest} 理论要点 ${ordinal + 1}`,
          type: ordinal % 2 === 0 ? 'memory' : 'concept',
          objective: `能解释并复述「${interest}」的第 ${ordinal + 1} 个理论要点`,
          prerequisiteIds: [],
          ordinal: objectives.length,
        };
        objectives.push(theory);

        const previousPracticeId = index >= 2 ? `obj-p-${index - 1}` : null;
        // 理论课**不**排 practice 分块：那一节没有实践目标，而实践分块必须携带
        // 非空 prerequisiteObjectiveIds（结构化的先理论后实践）。形状里的实践份额
        // 并入理论讲解，合计仍然恰好等于 minutesPerSession。
        sessions.push({
          id: `sess-${index + 1}`,
          moduleId,
          index,
          week,
          day,
          title: `理论 ${ordinal + 1}：${theory.name}`,
          blocks: [
            block(index, 'review', shape.review, previousPracticeId === null ? [] : [previousPracticeId]),
            block(index, 'theory', shape.theory + shape.practice, [theory.id]),
            block(index, 'check', shape.check, [theory.id]),
            block(index, 'reflect', shape.reflect, [theory.id]),
          ],
          theoryObjectiveIds: [theory.id],
          practiceObjectiveIds: [],
          mode: 'study',
        });
        continue;
      }

      const theoryId = `obj-t-${index - 1}`;
      const practice: GeneratedObjective = {
        id: `obj-p-${index}`,
        moduleId,
        name: `${interest} 实践任务 ${ordinal + 1}`,
        type: ordinal % 2 === 0 ? 'procedure' : 'design',
        objective: `完成「${interest}」的第 ${ordinal + 1} 个实践任务并提交证据`,
        prerequisiteIds: [theoryId],
        ordinal: objectives.length,
      };
      objectives.push(practice);

      sessions.push({
        id: `sess-${index + 1}`,
        moduleId,
        index,
        week,
        day,
        title: `实践 ${ordinal + 1}：${practice.name}`,
        blocks: [
          block(index, 'review', shape.review, [theoryId]),
          block(index, 'theory', shape.theory, [theoryId]),
          block(index, 'check', shape.check, [theoryId]),
          block(index, 'practice', shape.practice, [practice.id], [theoryId]),
          block(index, 'reflect', shape.reflect, [practice.id]),
        ],
        theoryObjectiveIds: [theoryId],
        practiceObjectiveIds: [practice.id],
        mode: 'study',
      });
    }

    return {
      templateVersion: CURRICULUM_TEMPLATE_VERSION,
      weeks,
      sessionCount: sessionCount as PlanSessionCount,
      minutesPerSession,
      ...(schedule === undefined ? {} : { schedule }),
      title,
      interest,
      goal,
      modules,
      objectives,
      sessions,
    };
  }
}

/** 构造一个分块：`kind` 是真源，`activity` 是旧校验器认识的投影。 */
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

/** 分块中文标题（学生侧可读）。 */
const BLOCK_TITLES: Readonly<Record<SessionBlockKind, string>> = {
  review: '衔接回顾',
  theory: '理论讲解',
  check: '理解检查',
  practice: '动手实践',
  reflect: '反思复盘',
};

/**
 * `SessionBlockKind` → 旧版 `activity` 投影。
 *
 * `check` 与 `reflect` 都投成 `reflect`（旧枚举没有「检查」这个值），所以旧投影
 * **不可逆**；需要区分时必须读 `GeneratedBlock.kind`。
 */
export function activityForKind(kind: SessionBlockKind): LearningPlanBlockActivity {
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

/** 反向投影：旧路径 `activity` → `kind`。仅供读旧数据时使用。 */
export function kindForActivity(activity: LearningPlanBlockActivity): SessionBlockKind {
  switch (activity) {
    case 'review':
      return 'review';
    case 'learn':
      return 'theory';
    case 'reflect':
      return 'check';
    case 'practice':
      return 'practice';
    case 'explore':
      return 'theory';
  }
}

/** 把生成结构投影为 `@qitu/ai-client` 校验器认识的草稿形状。 */
export function toLearningPlanDraft(plan: GeneratedPlan): LearningPlanDraft {
  return {
    templateVersion: plan.templateVersion,
    weeks: plan.weeks,
    title: plan.title,
    interest: plan.interest,
    sessions: plan.sessions.map((session) => ({
      id: session.id,
      week: session.week,
      day: session.day,
      title: session.title,
      blocks: session.blocks.map((blockItem) => ({
        id: blockItem.id,
        title: blockItem.title,
        minutes: blockItem.minutes,
        objectiveIds: [...blockItem.objectiveIds],
        activity: blockItem.activity,
        prerequisiteObjectiveIds: [...blockItem.prerequisiteObjectiveIds],
      })),
    })),
  };
}

export type { BlockShape };

/**
 * 校验学生输入；非法时抛 `PlanGenerationError`（400）。
 *
 * `sessionCount` 与 `schedule` 可以并存，但必须自洽：
 * `sessionCount === weeks * sessionsPerWeek`。给出 `sessionCount` 时它**就是**课次
 * 数量（不再由 `weeks` 乘出）；两者冲突时拒绝，而不是挑一个。
 */
export function assertGenerateInput(input: {
  interest: unknown;
  weeks: unknown;
  goal?: unknown;
  schedule?: unknown;
  sessionCount?: unknown;
}): GeneratePlanInput {
  const interest = typeof input.interest === 'string' ? input.interest.trim() : '';
  if (interest.length < MIN_INTEREST_LENGTH || interest.length > MAX_INTEREST_LENGTH) {
    throw new PlanGenerationError(`interest 长度必须在 ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH} 之间`, [
      { path: 'interest', message: 'invalid length' },
    ]);
  }
  if (input.weeks !== 4 && input.weeks !== 8) {
    throw new PlanGenerationError('weeks 必须是 4 或 8', [{ path: 'weeks', message: 'invalid weeks' }]);
  }
  let goal: string | null = null;
  if (input.goal !== undefined && input.goal !== null) {
    if (typeof input.goal !== 'string') {
      throw new PlanGenerationError('goal 必须是字符串', [{ path: 'goal', message: 'invalid goal' }]);
    }
    const trimmed = input.goal.trim();
    if (trimmed.length > MAX_GOAL_LENGTH) {
      throw new PlanGenerationError(`goal 不能超过 ${MAX_GOAL_LENGTH} 字`, [
        { path: 'goal', message: 'goal too long' },
      ]);
    }
    goal = trimmed.length === 0 ? null : trimmed;
  }
  let schedule: PblSchedule | undefined;
  if (input.schedule !== undefined && input.schedule !== null) {
    if (typeof input.schedule !== 'object') {
      throw new PlanGenerationError('schedule 必须是对象', [
        { path: 'schedule', message: 'invalid schedule' },
      ]);
    }
    const candidate = input.schedule as Record<string, unknown>;
    if (
      (candidate.durationWeeks !== 4 && candidate.durationWeeks !== 8) ||
      candidate.weeklyMinutes !== 120 ||
      (candidate.sessionsPerWeek !== 1 && candidate.sessionsPerWeek !== 2) ||
      (candidate.sessionMinutes !== 60 && candidate.sessionMinutes !== 120)
    ) {
      throw new PlanGenerationError('schedule 不符合项目式学习时间合同', [
        { path: 'schedule', message: 'invalid PblSchedule' },
      ]);
    }
    schedule = {
      durationWeeks: candidate.durationWeeks,
      weeklyMinutes: 120,
      sessionsPerWeek: candidate.sessionsPerWeek,
      sessionMinutes: candidate.sessionMinutes,
    } as PblSchedule;
    const result = validatePblSchedule(schedule);
    if (!result.valid || schedule.durationWeeks !== input.weeks) {
      throw new PlanGenerationError('schedule 必须与 weeks 一致且每周总时长为 120 分钟', [
        { path: 'schedule', message: result.errors.join('; ') || 'durationWeeks mismatch' },
      ]);
    }
  }
  let sessionCount: PlanSessionCount | undefined;
  if (input.sessionCount !== undefined && input.sessionCount !== null) {
    if (input.sessionCount !== 4 && input.sessionCount !== 8) {
      throw new PlanGenerationError('sessionCount 只能是 4 或 8', [
        { path: 'sessionCount', message: 'invalid sessionCount' },
      ]);
    }
    sessionCount = input.sessionCount;
    // 课次是单元，周只是排期容器：给出 sessionCount 时它就是课次总数，
    // 每周几节由它除以 weeks 推出。只有**同时**给出 schedule 时才要求两者一致，
    // 否则同一个请求会有两个互相矛盾的课次数。
    if (schedule !== undefined && sessionCount !== input.weeks * schedule.sessionsPerWeek) {
      throw new PlanGenerationError(
        `sessionCount=${sessionCount} 与 schedule 不一致：` +
          `${input.weeks} 周 × 每周 ${schedule.sessionsPerWeek} 节应为 ${input.weeks * schedule.sessionsPerWeek} 节`,
        [
          {
            path: 'sessionCount',
            message: `sessionCount must equal weeks * schedule.sessionsPerWeek (${input.weeks * schedule.sessionsPerWeek})`,
          },
        ],
      );
    }
  }
  return { interest, weeks: input.weeks, goal, schedule, sessionCount };
}
