import type {
  KnowledgeType,
  LearningPlanBlockActivity,
  LearningPlanWeeks,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';
import {
  validateLearningPlanDraft,
  type LearningPlanDraft,
} from '@qitu/ai-client';

/**
 * 计划生成 + 不可信模型输出的校验边界（纯函数）。
 *
 * `POST /learning-plans` 的「生成」是一个端口：默认实现是确定性的
 * `DeterministicPlanGenerator`，测试可以注入畸形实现来证明「模型输出不可信，
 * 结构非法必须被拒绝而不是被静默修复」。
 *
 * 这里同时跑两道校验：
 * 1. 复用 `@qitu/ai-client` 的 `validateLearningPlanDraft`（周数、节数、每节 60 分钟、
 *    实践必须引用已掌握的理论、目标数 ≤4、DAG 无环）；
 * 2. `validateGeneratedPlan` 在本产品的模块 / 目标 / 会话维度做更严格的检查，
 *    任何一条不过都抛 `PlanGenerationError`，绝不「修正后继续」。
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
  minutesPerSession: number;
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
}

export class PlanGenerationError extends Error {
  readonly code = 'LEARNING_PLAN_INVALID';
  constructor(
    message: string,
    readonly errors: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'PlanGenerationError';
  }
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
 * 确定性课程模板：理论课与实践课交替，每节 60 分钟。
 *
 * - 理论课：10 分钟「衔接回顾」+ 40 分钟「理论讲解」+ 10 分钟「理解检查」；
 * - 实践课：10 分钟「衔接回顾」+ 50 分钟「动手实践」；
 * - 理论目标类型在 `memory` / `concept` 间轮转，实践目标在 `procedure` / `design` 间轮转，
 *   保证量化与质化两条门槛都被真实覆盖。
 */
export class DeterministicPlanGenerator extends PlanGenerator {
  generate(input: GeneratePlanInput): GeneratedPlan {
    const interest = input.interest.trim();
    const weeks = input.weeks;
    const totalSessions = weeks * 5;
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
    const moduleIdFor = (index: number): string => `mod-w${Math.floor(index / 5) + 1}`;

    for (let index = 0; index < totalSessions; index += 2) {
      const round = index / 2;
      const week = Math.floor(index / 5) + 1;
      const day = (index % 5) + 1;

      const theory: GeneratedObjective = {
        id: `obj-t-${index}`,
        moduleId: moduleIdFor(index),
        name: `${interest} 理论要点 ${round + 1}`,
        type: round % 2 === 0 ? 'memory' : 'concept',
        objective: `能解释并复述「${interest}」的第 ${round + 1} 个理论要点`,
        prerequisiteIds: [],
        ordinal: objectives.length,
      };
      objectives.push(theory);

      const previousPracticeId = index >= 2 ? `obj-p-${index - 1}` : null;
      sessions.push({
        id: `sess-${index + 1}`,
        moduleId: theory.moduleId,
        index,
        week,
        day,
        title: `理论 ${round + 1}：${theory.name}`,
        blocks: [
          {
            id: `blk-${index}-review`,
            title: '衔接回顾',
            minutes: 10,
            activity: 'review',
            objectiveIds: previousPracticeId === null ? [] : [previousPracticeId],
            prerequisiteObjectiveIds: [],
          },
          {
            id: `blk-${index}-learn`,
            title: '理论讲解',
            minutes: 40,
            activity: 'learn',
            objectiveIds: [theory.id],
            prerequisiteObjectiveIds: [],
          },
          {
            id: `blk-${index}-check`,
            title: '理解检查',
            minutes: 10,
            activity: 'reflect',
            objectiveIds: [theory.id],
            prerequisiteObjectiveIds: [],
          },
        ],
        theoryObjectiveIds: [theory.id],
        practiceObjectiveIds: [],
        mode: 'study',
      });

      const practiceIndex = index + 1;
      const practice: GeneratedObjective = {
        id: `obj-p-${practiceIndex}`,
        moduleId: moduleIdFor(practiceIndex),
        name: `${interest} 实践任务 ${round + 1}`,
        type: round % 2 === 0 ? 'procedure' : 'design',
        objective: `完成「${interest}」的第 ${round + 1} 个实践任务并提交证据`,
        prerequisiteIds: [theory.id],
        ordinal: objectives.length,
      };
      objectives.push(practice);

      sessions.push({
        id: `sess-${practiceIndex + 1}`,
        moduleId: practice.moduleId,
        index: practiceIndex,
        week: Math.floor(practiceIndex / 5) + 1,
        day: (practiceIndex % 5) + 1,
        title: `实践 ${round + 1}：${practice.name}`,
        blocks: [
          {
            id: `blk-${practiceIndex}-review`,
            title: '衔接回顾',
            minutes: 10,
            activity: 'review',
            objectiveIds: [theory.id],
            prerequisiteObjectiveIds: [],
          },
          {
            id: `blk-${practiceIndex}-practice`,
            title: '动手实践',
            minutes: 50,
            activity: 'practice',
            objectiveIds: [practice.id],
            prerequisiteObjectiveIds: [theory.id],
          },
        ],
        theoryObjectiveIds: [theory.id],
        practiceObjectiveIds: [practice.id],
        mode: 'study',
      });
    }

    return {
      templateVersion: CURRICULUM_TEMPLATE_VERSION,
      weeks,
      minutesPerSession: MINUTES_PER_SESSION,
      title,
      interest,
      goal,
      modules,
      objectives,
      sessions,
    };
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
      blocks: session.blocks.map((block) => ({
        id: block.id,
        title: block.title,
        minutes: block.minutes,
        objectiveIds: [...block.objectiveIds],
        activity: block.activity,
        prerequisiteObjectiveIds: [...block.prerequisiteObjectiveIds],
      })),
    })),
  };
}

const BLOCK_KINDS: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'practice'];
const KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure', 'design'];

/**
 * 生成结构校验。任何一条不满足都抛 `PlanGenerationError`。
 *
 * 同时调用 `validateLearningPlanDraft`，它的错误会原样并入，保证错误信息一致。
 */
export function validateGeneratedPlan(plan: GeneratedPlan): void {
  const errors: { path: string; message: string }[] = [];
  if (plan.weeks !== 4 && plan.weeks !== 8) {
    errors.push({ path: 'weeks', message: 'weeks 必须是 4 或 8' });
  }
  if (plan.sessions.length !== plan.weeks * 5) {
    errors.push({ path: 'sessions', message: '计划必须恰好包含 weeks*5 节课' });
  }
  if (plan.minutesPerSession !== MINUTES_PER_SESSION) {
    errors.push({ path: 'minutesPerSession', message: '每节必须为 60 分钟' });
  }
  if (plan.interest.trim().length < MIN_INTEREST_LENGTH || plan.interest.length > MAX_INTEREST_LENGTH) {
    errors.push({ path: 'interest', message: `interest 长度必须在 ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH}` });
  }
  if (plan.goal.length > MAX_GOAL_LENGTH) {
    errors.push({ path: 'goal', message: `goal 不能超过 ${MAX_GOAL_LENGTH} 字` });
  }

  const objectiveById = new Map<string, GeneratedObjective>();
  for (const objective of plan.objectives) {
    if (objectiveById.has(objective.id)) {
      errors.push({ path: `objectives.${objective.id}`, message: '目标 id 重复' });
    }
    if (!KNOWLEDGE_TYPES.includes(objective.type)) {
      errors.push({ path: `objectives.${objective.id}.type`, message: '未知的目标类型' });
    }
    objectiveById.set(objective.id, objective);
  }
  for (const objective of plan.objectives) {
    for (const prerequisite of objective.prerequisiteIds) {
      if (!objectiveById.has(prerequisite)) {
        errors.push({
          path: `objectives.${objective.id}.prerequisiteIds`,
          message: `前置目标 ${prerequisite} 不存在`,
        });
      }
    }
  }
  if (hasPrerequisiteCycle(plan.objectives)) {
    errors.push({ path: 'objectives', message: '目标前置关系存在环' });
  }

  const moduleIds = new Set(plan.modules.map((module) => module.id));
  for (const module of plan.modules) {
    if (module.ordinal <= 0) {
      errors.push({ path: `modules.${module.id}.ordinal`, message: '模块序号必须为正' });
    }
  }

  for (const session of plan.sessions) {
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (minutes !== MINUTES_PER_SESSION) {
      errors.push({
        path: `sessions.${session.id}.blocks`,
        message: '每节分块合计必须正好 60 分钟',
      });
    }
    if (!moduleIds.has(session.moduleId)) {
      errors.push({ path: `sessions.${session.id}.moduleId`, message: '会话引用了不存在的模块' });
    }
    for (const block of session.blocks) {
      if (block.minutes <= 0) {
        errors.push({ path: `sessions.${session.id}.blocks.${block.id}`, message: '分块时长必须为正' });
      }
      if (!BLOCK_KINDS.includes(blockKind(block.activity))) {
        errors.push({ path: `sessions.${session.id}.blocks.${block.id}`, message: '未知的分块类型' });
      }
      for (const objectiveId of block.objectiveIds) {
        if (!objectiveById.has(objectiveId)) {
          errors.push({ path: `sessions.${session.id}.blocks.${block.id}`, message: `目标 ${objectiveId} 不存在` });
        }
      }
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        if (!objectiveById.has(prerequisite)) {
          errors.push({ path: `sessions.${session.id}.blocks.${block.id}`, message: `前置 ${prerequisite} 不存在` });
        }
      }
      if (block.activity === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({ path: `sessions.${session.id}.blocks.${block.id}`, message: '实践分块必须引用理论前置' });
      }
    }
    for (const objectiveId of [...session.theoryObjectiveIds, ...session.practiceObjectiveIds]) {
      if (!objectiveById.has(objectiveId)) {
        errors.push({ path: `sessions.${session.id}`, message: `会话引用不存在的目标 ${objectiveId}` });
      }
    }
    for (const objectiveId of session.practiceObjectiveIds) {
      const objective = objectiveById.get(objectiveId);
      if (objective === undefined) continue;
      if (objective.prerequisiteIds.length === 0) {
        errors.push({ path: `sessions.${session.id}`, message: `实践目标 ${objectiveId} 缺少理论前置` });
      }
      if (session.theoryObjectiveIds.length === 0) {
        errors.push({ path: `sessions.${session.id}`, message: `实践会话 ${session.id} 必须声明理论门禁目标` });
      }
    }
    const sessionObjectives = new Set([
      ...session.blocks.flatMap((block) => block.objectiveIds),
      ...session.theoryObjectiveIds,
      ...session.practiceObjectiveIds,
    ]);
    if (sessionObjectives.size > 4) {
      errors.push({ path: `sessions.${session.id}`, message: '单节最多 4 个目标' });
    }
  }

  const legacy = validateLearningPlanDraft(toLearningPlanDraft(plan));
  for (const error of legacy.errors) {
    errors.push({ path: `curriculum.${error.path}`, message: error.message });
  }

  if (errors.length > 0) {
    throw new PlanGenerationError(`生成的学习计划未通过校验：${errors[0]?.message ?? ''}`, errors);
  }
}

function blockKind(activity: LearningPlanBlockActivity): SessionBlockKind {
  switch (activity) {
    case 'review':
      return 'review';
    case 'learn':
      return 'theory';
    case 'reflect':
      return 'check';
    case 'practice':
      return 'practice';
    default:
      return 'theory';
  }
}

function hasPrerequisiteCycle(objectives: readonly GeneratedObjective[]): boolean {
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const status = state.get(id) ?? 0;
    if (status === 1) return true;
    if (status === 2) return false;
    state.set(id, 1);
    for (const prerequisite of byId.get(id)?.prerequisiteIds ?? []) {
      if (visit(prerequisite)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return objectives.some((objective) => visit(objective.id));
}

/** 校验学生输入；非法时抛 `PlanGenerationError`（400）。 */
export function assertGenerateInput(input: {
  interest: unknown;
  weeks: unknown;
  goal?: unknown;
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
  return { interest, weeks: input.weeks, goal };
}
