import type {
  KnowledgeType,
  LearningPlanBlockActivity,
  LearningPlanWeeks,
  PblSchedule,
  SessionBlockKind,
  SessionMode,
} from '@qitu/contracts';
import { sessionBlockShapeFor, validateLearningPlanDraft } from '@qitu/ai-client';
import { validatePblSchedule } from '@qitu/contracts';

/**
 * 计划结构校验的**唯一**入口（纯函数，零 I/O）。
 *
 * 结构上刻意不 import `plan-generator.ts`：只用结构化类型描述它产出的形状，
 * `GeneratedPlan` 在结构上满足 `SessionPlanShape`。这样校验器可以被单测直接
 * 喂入畸形对象，也不会与生成器形成循环依赖。
 *
 * 设计口径：
 *
 * 1. **收集全部违规，一次抛出**。不早退、不修补——第一条错误只作为 message，
 *    完整列表挂在 `PlanGenerationError.errors` 上。
 * 2. **课次是单元**。`sessionCount` 是显式输入（4 或 8），`weeks` 只是排期容器；
 *    校验同时钉住两者，而不是从其中一个推另一个。
 * 3. **五段**。每节课必须能表达 review / theory / check / practice / reflect，
 *    且分块合计**恰好等于** `minutesPerSession`。
 * 4. **覆盖率**。计划里的每个目标都必须被至少一节课引用（旧版完全没有这一轴，
 *    可以生成「有目标但从未排课」的计划）。
 * 5. **结构化的先理论后实践**。实践目标的 `prerequisiteIds` 必须非空、必须指向
 *    理论目标，实践分块必须携带非空 `prerequisiteObjectiveIds`，实践节必须声明
 *    `theoryObjectiveIds`；违反任一条即拒绝。
 * 6. **可行动的环错误**。DAG 校验返回**环上的顶点路径**，而不是一个裸布尔。
 */

/** 校验器认识的最小形状（结构化，不依赖生成器的具体实现）。 */
export interface SessionPlanShape {
  templateVersion: string;
  /** Legacy calendar duration; omitted by lesson-only templates. */
  weeks?: LearningPlanWeeks;
  lessonCount?: number;
  lessonMinutes?: 60 | 120;
  sessionCount: number;
  minutesPerSession: number;
  schedule?: PblSchedule;
  /** 课程模板 slug；仅课程驱动计划携带（通用计划为 `undefined`）。 */
  curriculumSlug?: string;
  title: string;
  interest: string;
  goal: string;
  modules: readonly PlanModuleShape[];
  objectives: readonly PlanObjectiveShape[];
  sessions: readonly PlanSessionShape[];
}

export interface PlanObjectiveShape {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: readonly string[];
  ordinal: number;
}

export interface PlanModuleShape {
  id: string;
  name: string;
  weekIndex?: number;
  lessonIndex?: number;
  objective: string;
  ordinal: number;
}

export interface PlanBlockShape {
  id: string;
  title: string;
  minutes: number;
  activity: LearningPlanBlockActivity;
  kind: SessionBlockKind;
  objectiveIds: readonly string[];
  prerequisiteObjectiveIds: readonly string[];
}

export interface PlanSessionShape {
  id: string;
  moduleId: string;
  index: number;
  week?: number;
  day?: number;
  lessonIndex?: number;
  title: string;
  blocks: readonly PlanBlockShape[];
  theoryObjectiveIds: readonly string[];
  practiceObjectiveIds: readonly string[];
  mode: SessionMode;
}

export interface PlanViolation {
  path: string;
  message: string;
}

/**
 * 计划校验失败异常。控制器把它翻译成 400 `LEARNING_PLAN_INVALID`。
 *
 * 定义放在本文件（生成器与校验器共同 import 的叶子模块），`plan-generator.ts`
 * 原样 re-export，所以 `service` 与 `controller` 看到的始终是同一个类，
 * `error instanceof PlanGenerationError` 不会因为跨模块复制而失效。
 */
export class PlanGenerationError extends Error {
  readonly code = 'LEARNING_PLAN_INVALID';
  constructor(
    message: string,
    readonly errors: readonly PlanViolation[] = [],
  ) {
    super(message);
    this.name = 'PlanGenerationError';
  }
}

/** 校验语境下的别名：与 `PlanGenerationError` 是同一个类（含 instanceof）。 */
export const PlanValidationError = PlanGenerationError;

export const MIN_INTEREST_LENGTH = 1;
export const MAX_INTEREST_LENGTH = 60;
export const MAX_GOAL_LENGTH = 200;
export const MINUTES_PER_SESSION = 60;
/** 单节课最多几个目标（与 `@qitu/ai-client` 的 `MAX_OBJECTIVES_PER_SESSION` 一致）。 */
export const MAX_OBJECTIVES_PER_SESSION = 4;
/** 合法课次数量。 */
export const SESSION_COUNT_OPTIONS: readonly number[] = [4, 8, 16];

const KNOWLEDGE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure', 'design'];
const SESSION_BLOCK_KINDS: readonly SessionBlockKind[] = [
  'review',
  'theory',
  'check',
  'practice',
  'reflect',
];
/**
 * 通用生成器的门禁承载类型：`memory | concept`。
 *
 * 冻结的旧口径，通用计划保持字节不变（`obj-t-2` 是 `concept` 型门禁目标，
 * 现有回归测试依赖它）。**仅**在 `curriculumSlug === undefined` 的计划上生效。
 */
const LEGACY_GATED_THEORY_TYPES: readonly KnowledgeType[] = ['memory', 'concept'];
/**
 * 课程驱动计划的门禁承载类型：`memory | procedure`。
 *
 * 门禁承载目标必须可被确定性判分打开，即 `memory | procedure`。课程驱动计划
 * （光学）的 `opt-theory-lens` 是 `procedure` 型目标，因此这里**不能**沿用旧的
 * `memory | concept` 口径——`concept` 是质化目标，判分打不开门禁。
 */
const GATED_THEORY_TYPES: readonly KnowledgeType[] = ['memory', 'procedure'];
/**
 * 实践目标的合法「理论前置」类型。
 *
 * 与门禁承载不同：通用生成器的实践前置是 `memory | concept`，课程驱动计划的
 * 实践前置（如 `opt-practice-setup` → `opt-theory-lens`）是 `procedure`。两者都
 * 合法，仍拒绝 `design` 前置（回归测试「实践目标的非理论前置被拒」保留）。
 */
const PRACTICE_PREREQUISITE_TYPES: readonly KnowledgeType[] = ['memory', 'concept', 'procedure'];
/** 每一节课都必须出现的分段。实践段只在有实践目标的课次出现（见校验说明）。 */
const REQUIRED_BLOCK_KINDS: readonly SessionBlockKind[] = ['review', 'theory', 'check', 'reflect'];
/** 五段的规范顺序。导出给生成器与测试共用，避免第三份顺序表。 */
export const PLAN_BLOCK_ORDER: readonly SessionBlockKind[] = [
  'review',
  'theory',
  'check',
  'practice',
  'reflect',
];
const BLOCK_ORDER = PLAN_BLOCK_ORDER;

/** 期望的课次数量：显式 `sessionCount`，否则回退旧语义 `weeks * sessionsPerWeek`。 */
export function expectedSessionCount(plan: {
  weeks?: LearningPlanWeeks;
  lessonCount?: number;
  sessionCount?: number;
  schedule?: PblSchedule;
}): number {
  if (typeof plan.lessonCount === 'number') return plan.lessonCount;
  if (typeof plan.sessionCount === 'number' && Number.isInteger(plan.sessionCount)) {
    return plan.sessionCount;
  }
  if (plan.weeks === undefined) return 0;
  return plan.weeks * (plan.schedule?.sessionsPerWeek ?? 5);
}

/**
 * 排期自洽性校验（纯函数）。
 *
 * `PblSchedule` 的三个字段互相约束，任何一条不成立这个排期都不可用：
 * `weeklyMinutes === sessionsPerWeek × sessionMinutes`、`weeklyMinutes === 120`、
 * `durationWeeks ∈ {4, 8}`。共享的 `validatePblSchedule` 覆盖后两条与乘积；这里
 * 把「`durationWeeks` 必须与本计划的 `weeks` 一致」也纳入，这是共享校验器不知道
 * 的上下文。
 */
export function scheduleViolations(
  schedule: PblSchedule | undefined,
  weeks: LearningPlanWeeks,
): PlanViolation[] {
  if (schedule === undefined) return [];
  const errors: PlanViolation[] = [];
  for (const message of validatePblSchedule(schedule).errors) {
    errors.push({ path: 'schedule', message });
  }
  if (schedule.durationWeeks !== weeks) {
    errors.push({
      path: 'schedule.durationWeeks',
      message: `schedule.durationWeeks=${schedule.durationWeeks} 必须与 weeks=${weeks} 一致`,
    });
  }
  return errors;
}

/**
 * 前置图上的环：返回**环上的顶点路径**（`[a, b, a]`），无环时返回 `null`。
 *
 * 三色 DFS（0 未访问 / 1 在栈上 / 2 已完成）；命中在栈上的节点时，从当前
 * 递归路径里截出实际的环。旧实现只返回布尔，调用方只能报「存在环」，拿到
 * 消息的人无从下手——这里把路径交出去。
 */
export function findPrerequisiteCycle(
  objectives: readonly { id: string; prerequisiteIds: readonly string[] }[],
): string[] | null {
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  const state = new Map<string, 0 | 1 | 2>();
  /** 当前 DFS 栈，用于截取环。 */
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const status = state.get(id) ?? 0;
    if (status === 1) {
      // 命中回边：栈上从该节点起的一段就是环，末尾再补一次形成闭环。
      const start = stack.indexOf(id);
      return [...stack.slice(start >= 0 ? start : 0), id];
    }
    if (status === 2) return null;
    state.set(id, 1);
    stack.push(id);
    for (const prerequisite of byId.get(id)?.prerequisiteIds ?? []) {
      if (!byId.has(prerequisite)) continue;
      const cycle = visit(prerequisite);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };

  for (const objective of objectives) {
    const cycle = visit(objective.id);
    if (cycle !== null) return cycle;
  }
  return null;
}

/**
 * 校验生成结构。任何一条不满足都抛 `PlanValidationError`（`LEARNING_PLAN_INVALID`）。
 *
 * 同时调用 `validateLearningPlanDraft`（旧消费者仍在用），它的错误原样并入。
 */
export function validateGeneratedPlan(plan: SessionPlanShape): void {
  const errors: PlanViolation[] = [];
  const schedule = plan.schedule;
  const lessonOnly = plan.weeks === undefined && plan.lessonCount !== undefined;
  if (lessonOnly) {
    if (!Number.isSafeInteger(plan.lessonCount) || plan.lessonCount! < 1 || plan.lessonCount! > 128) {
      errors.push({ path: 'lessonCount', message: 'lessonCount must be an integer between 1 and 128' });
    }
    if (schedule !== undefined) errors.push({ path: 'schedule', message: 'lesson-only plans must not contain calendar schedule' });
    if (plan.lessonMinutes !== 60 && plan.lessonMinutes !== 120) {
      errors.push({ path: 'lessonMinutes', message: 'lessonMinutes must be 60 or 120' });
    }
    if (plan.sessionCount !== plan.lessonCount) {
      errors.push({ path: 'sessionCount', message: 'sessionCount must equal lessonCount for lesson-only plans' });
    }
  } else if (schedule !== undefined) {
    // 排期自洽性（字段间约束 + 与 weeks 一致）。旧路径只在生成器里做这件事，
    // 校验器侧此前完全没有这一轴。
    for (const violation of scheduleViolations(schedule, plan.weeks!)) {
      errors.push(violation);
    }
  }
  if (!lessonOnly && (plan.lessonCount !== undefined || plan.lessonMinutes !== undefined)) {
    errors.push({ path: 'lessonCount', message: 'weekly plans must not contain lesson-only schedule fields' });
  }
  const expectedCount = expectedSessionCount(plan);
  /**
   * 期望的单节分钟数。
   *
   * 有 schedule 时以 schedule 为准（它是显式输入）；否则是遗留网格的 60 分钟。
   * **不能**回退到 `plan.minutesPerSession`——那正是被校验的字段之一，用它当
   * 期望值会让 `minutesPerSession` 写错时反而检查不出任何问题（自证循环）。
   */
  const expectedMinutes = lessonOnly ? plan.lessonMinutes! : schedule?.sessionMinutes ?? MINUTES_PER_SESSION;
  const sessionsPerWeek = schedule?.sessionsPerWeek ?? (plan.weeks !== undefined && plan.weeks > 0 ? expectedCount / plan.weeks : 0);

  /* ---------- 信封 ---------- */

  if (!lessonOnly && plan.weeks !== 4 && plan.weeks !== 8) {
    errors.push({ path: 'weeks', message: 'weeks 必须是 4 或 8' });
  }
  // 排期自洽性已在上面经 `scheduleViolations` 收集，此处不再重复。
  // 声明的课次数必须与「周 × 每周节数」一致。每周节数取 schedule 的显式值，
  // 否则用计划的课次数除以周数（遗留 5 节/周也走这条）。这样 4 / 8 / 16 / 20 / 40
  // 都各自合法，而被硬编码成「只能是 4 或 8」会把 8 周 × 2 节 = 16 节误判为非法。
  const declaredCount = plan.sessionCount;
  if (!lessonOnly && typeof declaredCount === 'number') {
    const weekly = schedule?.sessionsPerWeek ?? (plan.weeks !== undefined && plan.weeks > 0 ? expectedCount / plan.weeks : 0);
    const implied = (plan.weeks ?? 0) * weekly;
    if (!Number.isInteger(declaredCount) || declaredCount <= 0 || declaredCount !== implied) {
      errors.push({
        path: 'sessionCount',
        message:
          `sessionCount 必须等于 weeks × 每周节数（${plan.weeks ?? 0} × ${weekly} = ${implied}），` +
          `收到 ${declaredCount}`,
      });
    }
    if (declaredCount !== expectedCount) {
      errors.push({
        path: 'sessionCount',
        message: `sessionCount=${declaredCount} 与课次数期望值 ${expectedCount} 不一致`,
      });
    }
  }
  // 课次数量按真实期望值报错（旧实现把 `weeks*5` 写死在消息里，sessionsPerWeek=1
  // 时消息也在说谎）。
  if (plan.sessions.length !== expectedCount) {
    errors.push({
      path: 'sessions',
      message: `计划必须恰好包含 ${expectedCount} 节课，实际 ${plan.sessions.length} 节`,
    });
  }
  if (plan.minutesPerSession !== expectedMinutes) {
    errors.push({
      path: 'minutesPerSession',
      message: `每节必须为 ${expectedMinutes} 分钟，实际 ${plan.minutesPerSession} 分钟`,
    });
  }
  if (plan.interest.trim().length < MIN_INTEREST_LENGTH || plan.interest.length > MAX_INTEREST_LENGTH) {
    errors.push({
      path: 'interest',
      message: `interest 长度必须在 ${MIN_INTEREST_LENGTH}..${MAX_INTEREST_LENGTH}`,
    });
  }
  if (plan.goal.length > MAX_GOAL_LENGTH) {
    errors.push({ path: 'goal', message: `goal 不能超过 ${MAX_GOAL_LENGTH} 字` });
  }

  /* ---------- Module order ---------- */

  if ((!lessonOnly && plan.modules.length !== plan.weeks) || (lessonOnly && plan.modules.length !== plan.lessonCount)) {
    errors.push({
      path: 'modules',
      message: lessonOnly
        ? `lesson-only plan must contain ${plan.lessonCount} lesson modules, got ${plan.modules.length}`
        : `计划必须包含 ${plan.weeks} 个周模块，实际 ${plan.modules.length} 个`,
    });
  }
  const moduleIds = new Set<string>();
  for (const module of plan.modules) {
    if (moduleIds.has(module.id)) {
      errors.push({ path: `modules.${module.id}`, message: '模块 id 重复' });
    }
    moduleIds.add(module.id);
    if (module.ordinal <= 0) {
      errors.push({ path: `modules.${module.id}.ordinal`, message: '模块序号必须为正' });
    }
    if (lessonOnly && module.weekIndex !== undefined) {
      errors.push({ path: `modules.${module.id}.weekIndex`, message: 'lesson-only modules must not contain weekIndex' });
    }
    const order = lessonOnly ? module.lessonIndex : module.weekIndex;
    if (!Number.isInteger(order) || order! < 1 || order! > (lessonOnly ? plan.lessonCount! : plan.weeks!)) {
      errors.push({ path: `modules.${module.id}.weekIndex`, message: '模块周序号越界' });
    }
  }

  /* ---------- 目标 ---------- */

  const objectiveById = new Map<string, PlanObjectiveShape>();
  for (const objective of plan.objectives) {
    if (objectiveById.has(objective.id)) {
      errors.push({ path: `objectives.${objective.id}`, message: '目标 id 重复' });
    }
    if (!KNOWLEDGE_TYPES.includes(objective.type)) {
      errors.push({ path: `objectives.${objective.id}.type`, message: '未知的目标类型' });
    }
    if (!moduleIds.has(objective.moduleId)) {
      errors.push({
        path: `objectives.${objective.id}.moduleId`,
        message: `目标引用了不存在的模块 ${objective.moduleId}`,
      });
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
  // 环错误必须指出环上的顶点，否则拿到 400 的人无从修模板。
  const cycle = findPrerequisiteCycle(plan.objectives);
  if (cycle !== null) {
    errors.push({
      path: 'objectives',
      message: `目标前置关系存在环：${cycle.join(' → ')}`,
    });
  }

  /* ---------- 课次 ---------- */

  /** 目标 → 首次出现在第几节课（用于「理论不晚于实践」的结构判断）。 */
  const objectiveSessionIndex = new Map<string, number>();
  for (const session of plan.sessions) {
    for (const objectiveId of sessionObjectiveIds(session)) {
      if (!objectiveSessionIndex.has(objectiveId)) {
        objectiveSessionIndex.set(objectiveId, session.index);
      }
    }
  }

  for (const session of plan.sessions) {
    const sessionPath = `sessions.${session.id}`;
    const minutes = session.blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (minutes !== expectedMinutes) {
      errors.push({
        path: `${sessionPath}.blocks`,
        message: `每节分块合计必须正好 ${expectedMinutes} 分钟，实际 ${minutes} 分钟`,
      });
    }
    if (!moduleIds.has(session.moduleId)) {
      errors.push({ path: `${sessionPath}.moduleId`, message: '会话引用了不存在的模块' });
    }
    if (session.index !== plan.sessions.indexOf(session)) {
      errors.push({ path: `${sessionPath}.index`, message: '课次下标必须与其在计划中的位置一致' });
    }
    if (lessonOnly) {
      if (session.week !== undefined || session.day !== undefined) {
        errors.push({ path: sessionPath, message: 'lesson-only sessions must not contain week/day' });
      }
      if (session.lessonIndex !== session.index + 1) {
        errors.push({ path: `${sessionPath}.lessonIndex`, message: 'lessonIndex must be contiguous one-based order' });
      }
    } else {
      if (session.week === undefined || session.week < 1 || session.week > plan.weeks!) {
        errors.push({ path: `${sessionPath}.week`, message: '课次周序号越界' });
      }
      if (Number.isInteger(sessionsPerWeek) && sessionsPerWeek > 0) {
        if (session.day === undefined || session.day < 1 || session.day > sessionsPerWeek) {
          errors.push({
            path: `${sessionPath}.day`,
            message: `课次日序号必须在 1..${sessionsPerWeek}`,
          });
        }
      }
    }

    // 每节课必须有 review / theory / check / reflect；实践段按「本节是否有实践
    // 目标」要求。这样理论课不会因为空实践段而变成畸形结构，而**有实践目标却
    // 没有实践段**的计划仍然被拒。
    const kinds = session.blocks.map((block) => block.kind);
    for (const required of REQUIRED_BLOCK_KINDS) {
      if (!kinds.includes(required)) {
        errors.push({
          path: sessionPath,
          message: `每节课必须包含 ${required} 段，实际缺少`,
        });
      }
    }
    const hasPracticeBlock = kinds.includes('practice');
    if (session.practiceObjectiveIds.length > 0 && !hasPracticeBlock) {
      errors.push({
        path: sessionPath,
        message: `实践会话 ${session.id} 必须包含 practice 分块`,
      });
    }
    if (session.practiceObjectiveIds.length === 0 && hasPracticeBlock) {
      errors.push({
        path: sessionPath,
        message: `课次 ${session.id} 没有实践目标，不应包含 practice 分块`,
      });
    }
    // 顺序：见 BLOCK_ORDER；只有实际出现的段参与比较。
    const present = kinds.filter((kind, position) => kinds.indexOf(kind) === position);
    const expectedOrder = BLOCK_ORDER.filter((kind) => present.includes(kind));
    if (present.join(',') !== expectedOrder.join(',')) {
      errors.push({
        path: `${sessionPath}.blocks`,
        message: `分块顺序必须是 ${expectedOrder.join(' → ')}`,
      });
    }
    const practicePosition = kinds.indexOf('practice');
    const theoryPosition = kinds.indexOf('theory');
    const checkPosition = kinds.indexOf('check');
    if (practicePosition !== -1 && theoryPosition !== -1 && practicePosition < theoryPosition) {
      errors.push({ path: `${sessionPath}.blocks`, message: '实践分块必须排在理论之后' });
    }
    if (practicePosition !== -1 && checkPosition !== -1 && practicePosition < checkPosition) {
      errors.push({ path: `${sessionPath}.blocks`, message: '实践分块必须排在检查之后' });
    }
    const reflectPosition = kinds.lastIndexOf('reflect');
    if (reflectPosition !== -1 && reflectPosition !== kinds.length - 1) {
      errors.push({ path: `${sessionPath}.blocks`, message: '反思分块必须是最后一节' });
    }

    for (const block of session.blocks) {
      const blockPath = `${sessionPath}.blocks.${block.id}`;
      if (!Number.isInteger(block.minutes) || block.minutes <= 0) {
        errors.push({ path: blockPath, message: '分块时长必须是正整数' });
      }
      if (!SESSION_BLOCK_KINDS.includes(block.kind)) {
        errors.push({ path: blockPath, message: '未知的分块类型' });
      }
      for (const objectiveId of block.objectiveIds) {
        if (!objectiveById.has(objectiveId)) {
          errors.push({ path: blockPath, message: `目标 ${objectiveId} 不存在` });
        }
      }
      for (const prerequisite of block.prerequisiteObjectiveIds) {
        if (!objectiveById.has(prerequisite)) {
          errors.push({ path: blockPath, message: `前置 ${prerequisite} 不存在` });
        }
      }
      if (block.kind === 'practice' && block.prerequisiteObjectiveIds.length === 0) {
        errors.push({ path: blockPath, message: '实践分块必须引用理论前置' });
      }
    }

    for (const objectiveId of [...session.theoryObjectiveIds, ...session.practiceObjectiveIds]) {
      if (!objectiveById.has(objectiveId)) {
        errors.push({ path: sessionPath, message: `会话引用不存在的目标 ${objectiveId}` });
      }
    }
    for (const objectiveId of session.theoryObjectiveIds) {
      const objective = objectiveById.get(objectiveId);
      // 课程驱动计划只允许 `memory | procedure` 承载门禁；通用计划保持冻结的
      // `memory | concept` 旧口径（不改旧计划的字节与回归行为）。
      const gatedTypes = plan.curriculumSlug === undefined ? LEGACY_GATED_THEORY_TYPES : GATED_THEORY_TYPES;
      if (objective !== undefined && !gatedTypes.includes(objective.type)) {
        errors.push({
          path: sessionPath,
          message:
            plan.curriculumSlug === undefined
              ? `理论门禁目标 ${objectiveId} 必须是 memory 或 concept`
              : `理论门禁目标 ${objectiveId} 必须是 memory 或 procedure`,
        });
      }
    }
    if (session.practiceObjectiveIds.length > 0) {
      // (a) 理论先于实践：结构化的三连检查。
      if (session.theoryObjectiveIds.length === 0) {
        errors.push({
          path: sessionPath,
          message: `实践会话 ${session.id} 必须声明理论门禁目标`,
        });
      }
      for (const objectiveId of session.practiceObjectiveIds) {
        const objective = objectiveById.get(objectiveId);
        if (objective === undefined) continue;
        if (objective.prerequisiteIds.length === 0) {
          errors.push({ path: sessionPath, message: `实践目标 ${objectiveId} 缺少理论前置` });
          continue;
        }
        const theoryPrerequisites = objective.prerequisiteIds.filter((candidateId) => {
          const candidate = objectiveById.get(candidateId);
          return candidate !== undefined && PRACTICE_PREREQUISITE_TYPES.includes(candidate.type);
        });
        if (theoryPrerequisites.length === 0) {
          errors.push({
            path: sessionPath,
            message: `实践目标 ${objectiveId} 的前置必须是理论目标`,
          });
          continue;
        }
        const gated = theoryPrerequisites.some(
          (candidateId) =>
            (objectiveSessionIndex.get(candidateId) ?? Number.POSITIVE_INFINITY) <= session.index,
        );
        if (!gated) {
          errors.push({
            path: sessionPath,
            message: `实践目标 ${objectiveId} 的理论前置必须排在同节或更早的课次`,
          });
        }
      }
    }
    const sessionObjectives = sessionTaughtObjectiveIds(session);
    if (sessionObjectives.length > MAX_OBJECTIVES_PER_SESSION) {
      errors.push({
        path: sessionPath,
        message: `单节最多 ${MAX_OBJECTIVES_PER_SESSION} 个目标，实际 ${sessionObjectives.length} 个`,
      });
    }
  }

  /* ---------- 覆盖率：每个目标都必须被排进至少一节课 ---------- */

  const referenced = new Set<string>();
  for (const session of plan.sessions) {
    for (const objectiveId of sessionObjectiveIds(session)) referenced.add(objectiveId);
  }
  for (const objective of plan.objectives) {
    if (!referenced.has(objective.id)) {
      errors.push({
        path: `objectives.${objective.id}`,
        message: `目标 ${objective.id} 未被任何课次引用`,
      });
    }
  }
  if (plan.objectives.length === 0) {
    errors.push({ path: 'objectives', message: '计划必须至少包含一个目标' });
  }

  /* ---------- 旧版校验器（旧消费者仍在用） ---------- */

  // 旧校验器写死了「每周 5 节 + 每节 60 分钟」。它只在**真正是旧形状**的计划上
  // 有权威性：没有 schedule，且课次数就是 weeks × 5。显式 sessionCount（4 或 8）
  // 声明的正是「这不是 5 节/周网格」，拿旧网格去否决它属于误报——所以这里按
  // 形状决定是否调用，而不是无条件调用后把错误并进来。
  const legacyShaped =
    !lessonOnly && schedule === undefined && plan.weeks !== undefined
      && plan.sessions.length === plan.weeks * 5 && plan.minutesPerSession === MINUTES_PER_SESSION;
  if (legacyShaped) {
    const legacy = validateLearningPlanDraft(toLegacyDraft(plan));
    for (const error of legacy.errors) {
      const duplicated = errors.some((existing) => existing.path.endsWith(error.path));
      if (duplicated) continue;
      errors.push({ path: `curriculum.${error.path}`, message: error.message });
    }
  }

  if (errors.length > 0) {
    throw new PlanValidationError(
      `生成的学习计划未通过校验：${errors[0]?.message ?? ''}`,
      errors,
    );
  }
}

/** 课次涉及的全部目标（分块引用 + 理论门禁 + 实践），按出现顺序去重。 */
function sessionObjectiveIds(session: PlanSessionShape): string[] {
  return [
    ...new Set([
      ...session.blocks.flatMap((block) => [...block.objectiveIds]),
      ...session.theoryObjectiveIds,
      ...session.practiceObjectiveIds,
    ]),
  ];
}

/**
 * 课次「实际讲授 / 实践」的目标（分块引用 + 实践），按出现顺序去重。
 *
 * `MAX_OBJECTIVES_PER_SESSION` 计数**不包含理论门禁引用**：课程驱动计划里
 * 实践课需要把 4 个门禁承载目标全部挂进 `theoryObjectiveIds`（`TheoryMastered`
 * 按该集合计算），但那些是「回顾 / 门禁」而不是本节新教目标；若计入会误伤
 * 「4 门禁 + 2 实践」的合法光学实践课。覆盖率和 `objectiveSessionIndex` 仍用
 * 完整集合 `sessionObjectiveIds`。
 */
function sessionTaughtObjectiveIds(session: PlanSessionShape): string[] {
  return [
    ...new Set([
      ...session.blocks.flatMap((block) => [...block.objectiveIds]),
      ...session.practiceObjectiveIds,
    ]),
  ];
}

function toLegacyDraft(plan: SessionPlanShape): import('@qitu/ai-client').LearningPlanDraft {
  if (plan.weeks === undefined) throw new Error('legacy draft requires weeks');
  return {
    templateVersion: plan.templateVersion,
    weeks: plan.weeks,
    title: plan.title,
    interest: plan.interest,
    sessions: plan.sessions.map((session) => ({
      id: session.id,
      week: session.week ?? 1,
      day: session.day ?? 1,
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

/**
 * 形状表覆盖测试的入口：对每种合法形状断言
 * `Σ minutes === sessionMinutes` 且五段齐全。返回每种形状的合计值。
 */
export function blockShapesCoverSessionMinutes(
  sessionMinutes: number,
  totalSessions: number,
): { ordinal: number; total: number; kinds: string[] }[] {
  const out: { ordinal: number; total: number; kinds: string[] }[] = [];
  for (let ordinal = 0; ordinal < totalSessions; ordinal += 1) {
    const shape = sessionBlockShapeFor(sessionMinutes, ordinal);
    const kinds = PLAN_BLOCK_ORDER.filter((kind) => shape[kind] > 0);
    out.push({
      ordinal,
      total: shape.review + shape.theory + shape.check + shape.practice + shape.reflect,
      kinds,
    });
  }
  return out;
}
