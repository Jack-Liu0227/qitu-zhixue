import type { LearningPlanWeeks, PblSchedule, SessionMode } from '@qitu/contracts';
import { sessionBlockShapeFor } from '@qitu/ai-client';
import {
  PLAN_BLOCK_ORDER,
  PlanGenerationError,
  type PlanBlockShape,
  type PlanSessionShape,
  type SessionPlanShape,
} from './session-plan-validator';

/**
 * **大纲（outline）阶段**：计划与「每节教学计划」之间的持久化产物。
 *
 * 在此之前仓库里没有任何 outline 产物：契约里 `SessionMode` 声明了 `'outline'`
 * 但从未被产出过，所有生成的会话都是 `mode: 'study'`。结果是「计划 → 教学计划」
 * 之间只有一次性推导，没有可以冻结、可以审计、可以增量展开的中间层。
 *
 * 本模块补上这一层，语义严格如下：
 *
 * 1. **服务端写**。`buildPlanOutline` 是纯函数，只接受计划结构；调用方在
 *    **确认事务**里调用它并落库（AGENTS.md：计划状态一律服务端写，客户端
 *    不得通过任何路径写入）。
 * 2. **确认后不可变**。`assertOutlineMutable` 在计划已确认时拒绝重建；重建需要
 *    新的计划版本，不能就地覆盖（与 `templateVersion` 冻结同一口径）。
 * 3. **按课次增量展开**。`generateSessionTeachingPlan(outline, sessionIndex)` 一次
 *    只产出一节。8 节课的计划不会预先生成 8 份教学计划——展开是惰性的、按需的。
 * 4. **幂等**。落库键恒为 `outline:<planId>` 与
 *    `session-plan:<planId>:<sessionIndex>`；同一键重复写入返回既有行，不产生
 *    第二份产物。键由本模块的 `outlineIdempotencyKey` /
 *    `sessionPlanIdempotencyKey` 统一构造，调用方不要自己拼字符串。
 * 5. **未成年人数据最小化**。大纲只保留结构（课次序号、目标 id、分块类型与
 *    分钟数、模板版本），不含任何学生作答、对话或语音原文。
 */

/** 大纲里单节课的条目。 */
export interface PlanOutlineSession {
  /** 0 起的课次序号，与 `GeneratedSession.index` 对齐。 */
  sessionIndex: number;
  week: number;
  day: number;
  title: string;
  objectiveIds: string[];
  /** 该节包含的分块类型（有序）。 */
  blockKinds: string[];
  /** 该节分钟数，恒等于计划的 `minutesPerSession`。 */
  minutes: number;
}

/** 一份计划的大纲。确认后不可变。 */
export interface PlanOutline {
  id: string;
  planId: string;
  templateVersion: string;
  weeks: LearningPlanWeeks;
  sessionCount: number;
  minutesPerSession: number;
  schedule?: PblSchedule;
  /** 大纲总目标：与计划「goal」同源，但只作为结构说明，可被教学计划覆盖。 */
  goal: string;
  sessions: PlanOutlineSession[];
  /** 服务端写入时间。 */
  derivedAt: string;
  /** 生成期即冻结：草稿大纲与确认后大纲用同一 `revision`，重建必须换版本。 */
  revision: number;
}

/** 大纲落库的幂等键：`outline:<planId>`。 */
export function outlineIdempotencyKey(planId: string): string {
  return `outline:${planId}`;
}

/** 单节教学计划落库的幂等键：`session-plan:<planId>:<sessionIndex>`。 */
export function sessionPlanIdempotencyKey(planId: string, sessionIndex: number): string {
  return `session-plan:${planId}:${sessionIndex}`;
}

/**
 * 由计划结构推导大纲（纯函数，零 I/O）。
 *
 * 只读结构字段；不读掌握度、不读学生作答、不调模型。
 */
export function buildPlanOutline(
  plan: SessionPlanShape & { id: string },
  now: Date,
  revision = 1,
): PlanOutline {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PlanGenerationError(`大纲 revision 必须是正整数，收到 ${revision}`, [
      { path: 'revision', message: 'revision must be a positive integer' },
    ]);
  }
  const sessions: PlanOutlineSession[] = plan.sessions
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((session) => ({
      sessionIndex: session.index,
      week: session.week ?? Math.ceil((session.index + 1) / 2),
      day: session.day ?? ((session.index % 2) + 1),
      title: session.title,
      objectiveIds: sessionObjectiveIds(session),
      blockKinds: PLAN_BLOCK_ORDER.filter((kind) =>
        session.blocks.some((block) => block.kind === kind),
      ),
      minutes: session.blocks.reduce((sum, block) => sum + block.minutes, 0),
    }));
  return {
    id: `outline:${plan.id}`,
    planId: plan.id,
    templateVersion: plan.templateVersion,
    weeks: plan.weeks ?? 4,
    sessionCount: plan.sessionCount,
    minutesPerSession: plan.minutesPerSession,
    ...(plan.schedule === undefined ? {} : { schedule: plan.schedule }),
    goal: plan.goal,
    sessions,
    derivedAt: now.toISOString(),
    revision,
  };
}

/**
 * 确认后不可变：已确认（有 `confirmedAt`）的计划拒绝重建大纲。
 *
 * 与 `templateVersion` 冻结同一口径——需要改结构就换版本，不就地覆盖。
 */
export function assertOutlineMutable(plan: { confirmedAt: string | null }): void {
  if (plan.confirmedAt !== null) {
    throw new PlanGenerationError('计划确认后大纲不可变，不能重建', [
      { path: 'outline', message: 'outline is immutable after confirmation' },
    ]);
  }
}

/** 单节教学计划：由大纲 + 计划结构按课次展开。 */
export interface SessionTeachingPlan {
  id: string;
  planId: string;
  sessionIndex: number;
  week: number;
  day: number;
  title: string;
  /** 与契约 `SessionMode` 对齐；教学计划是 `'study'`，大纲层是 `'outline'`。 */
  mode: SessionMode;
  minutes: number;
  blocks: PlanBlockShape[];
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  requiredEvidenceIds: string[];
}

/**
 * 按课次展开一节教学计划（纯函数）。
 *
 * **一次只产出一节**：调用方按需（学生进入该节时）调用，而不是在生成计划时
 * 预展开全部课次。这样 8 节课的计划不会预先物化 8 份教学计划。
 *
 * `sessionIndex` 越界即拒绝（而不是返回空对象）。
 */
export function generateSessionTeachingPlan(
  outline: PlanOutline,
  plan: SessionPlanShape,
  sessionIndex: number,
  now: Date,
): SessionTeachingPlan {
  if (!Number.isInteger(sessionIndex) || sessionIndex < 0) {
    throw new PlanGenerationError(`课次序号必须是从 0 起的整数，收到 ${sessionIndex}`, [
      { path: 'sessionIndex', message: 'sessionIndex must be a non-negative integer' },
    ]);
  }
  const session = plan.sessions.find((candidate) => candidate.index === sessionIndex);
  if (session === undefined) {
    throw new PlanGenerationError(
      `计划 ${plan.templateVersion} 里没有第 ${sessionIndex + 1} 节课`,
      [{ path: 'sessionIndex', message: `session ${sessionIndex} does not exist in the plan` }],
    );
  }
  const outlineEntry = outline.sessions.find((entry) => entry.sessionIndex === sessionIndex);
  if (outlineEntry === undefined) {
    throw new PlanGenerationError(
      `大纲里没有第 ${sessionIndex + 1} 节课，不能展开教学计划`,
      [{ path: 'outline', message: `outline is missing session ${sessionIndex}` }],
    );
  }
  void now;
  return {
    id: sessionPlanIdempotencyKey(outline.planId, sessionIndex),
    planId: outline.planId,
    sessionIndex,
    week: session.week ?? outlineEntry.week,
    day: session.day ?? outlineEntry.day,
    title: session.title,
    mode: 'study',
    minutes: session.blocks.reduce((sum, block) => sum + block.minutes, 0),
    blocks: session.blocks.map((block) => ({
      ...block,
      objectiveIds: [...block.objectiveIds],
      prerequisiteObjectiveIds: [...block.prerequisiteObjectiveIds],
    })),
    theoryObjectiveIds: [...session.theoryObjectiveIds],
    practiceObjectiveIds: [...session.practiceObjectiveIds],
    requiredEvidenceIds: session.practiceObjectiveIds.map(
      (objectiveId) => `evidence:${objectiveId}`,
    ),
  };
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
 * 大纲落库端口。
 *
 * 实现放在 `learning-plan.service.ts`（WS2 的写入边界），本模块只定义端口与
 * 幂等键。**服务端写**：没有任何客户端可调用的路径能到达这个端口。
 */
export interface PlanOutlineStore {
  /** 幂等 upsert：同 `outlineIdempotencyKey(planId)` 已存在时返回既有行。 */
  upsertOutline(outline: PlanOutline): Promise<{ outline: PlanOutline; created: boolean }>;
  findOutline(planId: string): Promise<PlanOutline | null>;
  /** 幂等 upsert：同 `(planId, sessionIndex)` 已存在时返回既有行。 */
  upsertSessionTeachingPlan(
    plan: SessionTeachingPlan,
  ): Promise<{ plan: SessionTeachingPlan; created: boolean }>;
  findSessionTeachingPlan(
    planId: string,
    sessionIndex: number,
  ): Promise<SessionTeachingPlan | null>;
}

/**
 * 落库一次大纲（幂等）。已确认的计划调用前必须先过 `assertOutlineMutable`。
 *
 * 这个函数**不**改数据库，只负责「先查再写、同键返回既有行」的编排；
 * 真正的持久化由注入的 store 完成。
 */
export async function persistPlanOutline(
  store: PlanOutlineStore,
  outline: PlanOutline,
): Promise<{ outline: PlanOutline; created: boolean }> {
  const existing = await store.findOutline(outline.planId);
  if (existing !== null) {
    return { outline: existing, created: false };
  }
  return store.upsertOutline(outline);
}

/**
 * 按课次落库一节教学计划（幂等）。重复调用返回既有行，不产生第二份。
 */
export async function persistSessionTeachingPlan(
  store: PlanOutlineStore,
  plan: SessionTeachingPlan,
): Promise<{ plan: SessionTeachingPlan; created: boolean }> {
  const existing = await store.findSessionTeachingPlan(plan.planId, plan.sessionIndex);
  if (existing !== null) {
    return { plan: existing, created: false };
  }
  return store.upsertSessionTeachingPlan(plan);
}

/** 形状覆盖自检：4/8 节课、60/120 分钟下五段齐全且合计恰好。 */
export function outlineShapeSummary(
  sessionMinutes: number,
  totalSessions: number,
): { ordinal: number; total: number; kinds: string[] }[] {
  const out: { ordinal: number; total: number; kinds: string[] }[] = [];
  for (let ordinal = 0; ordinal < totalSessions; ordinal += 1) {
    const shape = sessionBlockShapeFor(sessionMinutes, ordinal);
    const total =
      shape.review + shape.theory + shape.check + shape.practice + shape.reflect;
    out.push({
      ordinal,
      total,
      kinds: PLAN_BLOCK_ORDER.filter((kind) => shape[kind] > 0),
    });
  }
  return out;
}
