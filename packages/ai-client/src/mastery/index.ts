import type {
  KnowledgeType,
  LearningErrorType,
  NextAction,
  ObjectiveStatus,
} from '@qitu/contracts';

/**
 * 掌握度引擎（纯函数，零 I/O，不写状态）。
 *
 * 移植自 DeepTutor 的两条机制，并叠加本产品自有的提示阶梯代价：
 * - 类型化门槛：量化 `memory | procedure >= 0.9`；质化 `concept | design` 只看存储布尔；
 * - 近期加权掌握度 `(0.5, 0.7, 0.85, 0.95, 1.0)` + 置信上限 `{1: 0.5, 2: 0.8}`，
 *   保证「一次答对不能过关」；
 * - 提示 / 尝试扣分 `min(0.25, hints*0.08)` 与 `min(0.2, (attempts-1)*0.05)`；
 * - 固定推进优先级：`answer_pending → review → probe → practice/assess → complete`。
 *
 * 这一层**永不**返回或接受客户端提供的 stage / mastery；调用方（plan-api）负责持久化
 * 与 `TheoryMastered` 事件，但判定逻辑全部在这里。
 */

/** 量化目标的门槛：0.9。 */
export const QUANTITATIVE_THRESHOLD = 0.9;

/** 近期加权的权重，最早一次 0.5、最近一次 1.0（DT `learning/mastery.py`）。 */
export const RECENCY_WEIGHTS = [0.5, 0.7, 0.85, 0.95, 1.0] as const;

/** 置信上限：只有 1 次 / 2 次作答时，掌握度不可能超过 0.5 / 0.8。 */
export const CONFIDENCE_CAP: Readonly<Record<1 | 2, number>> = { 1: 0.5, 2: 0.8 };

/** 每次提示的扣分与上限。 */
export const HINT_PENALTY_PER = 0.08;
export const HINT_PENALTY_MAX = 0.25;

/** 每次额外尝试的扣分与上限。 */
export const ATTEMPT_PENALTY_PER = 0.05;
export const ATTEMPT_PENALTY_MAX = 0.2;

/**
 * 间隔复习序列，按目标类型（DT `learning/scheduler.py`）。
 *
 * 本产品课次为每周 5 节（迁移 0008 + 现有 curriculum 校验器：`weeks * 5` 节），
 * 因此**1 天间隔 == 1 个课次下标**。`design` 沿用 DT 的 `14,28`。
 */
export const REVIEW_INTERVALS: Readonly<Record<KnowledgeType, readonly number[]>> = {
  memory: [0, 1, 3, 7, 14, 30, 60],
  concept: [0, 1, 3, 7, 14, 30],
  procedure: [0, 1, 2, 4, 8, 15],
  design: [14, 28],
};

/** 回合作答信号（服务端判分后的最小输入，与 `mastery_attempts` 对应）。 */
export interface AttemptSignal {
  result: 'correct' | 'incorrect' | 'partial';
  isCorrect: boolean;
  hintsUsed: number;
  /** 该目标累计作答次数（含本次）；用于尝试扣分。 */
  attemptCount: number;
  /** 可选的错误归类，仅用于诊断，不参与掌握度计算。 */
  errorType?: LearningErrorType | null;
}

/** 掌握度记录的纯输入投影（来自 `mastery_records`）。 */
export interface ObjectiveMasteryState {
  objectiveId: string;
  knowledgeType: KnowledgeType;
  score: number;
  status: ObjectiveStatus;
  qualitativeMastered: boolean;
  /** 间隔复习序列下标。 */
  intervalIndex: number;
  /** 该记录对应的课次下标（用于复习到期判定）。 */
  lastSessionIndex?: number | null;
}

/** 推进判定输入。 */
export interface NextActionState {
  hasPendingQuestion: boolean;
  /** 有到期的复习目标时给出其 id。 */
  dueReviewObjectiveId?: string | null;
  /** 下一个未掌握目标（按计划顺序）。 */
  candidate?: {
    objectiveId: string;
    knowledgeType: KnowledgeType;
    status: ObjectiveStatus;
  } | null;
}

export function attemptValue(result: AttemptSignal['result']): number {
  if (result === 'correct') return 1;
  if (result === 'partial') return 0.5;
  return 0;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 提示 / 尝试扣分：`min(0.25, hints*0.08) + min(0.2, (attempts-1)*0.05)`。 */
export function resolveQualityPenalty(hintsUsed: number, attemptCount: number): number {
  const hints = Math.max(0, Math.floor(hintsUsed));
  const attempts = Math.max(1, Math.floor(attemptCount));
  const hintPenalty = Math.min(HINT_PENALTY_MAX, hints * HINT_PENALTY_PER);
  const attemptPenalty = Math.min(ATTEMPT_PENALTY_MAX, (attempts - 1) * ATTEMPT_PENALTY_PER);
  return hintPenalty + attemptPenalty;
}

/**
 * 置信上限：作答次数不足时封顶。
 *
 * 1 次 → 0.5；2 次 → 0.8；>=3 次 → 1。
 */
export function confidenceCapFor(attemptCount: number): number {
  if (attemptCount <= 1) return CONFIDENCE_CAP[1];
  if (attemptCount === 2) return CONFIDENCE_CAP[2];
  return 1;
}

/**
 * 近期加权掌握度。
 *
 * 取最近的 `RECENCY_WEIGHTS.length` 条作答，最早一条配最小权重，最近一条配 1.0。
 * 不足 5 条时使用权重数组的**尾部**（即最近几档较大的权重），保证「越近越重」。
 */
export function weightedMastery(attempts: readonly AttemptSignal[]): number {
  if (attempts.length === 0) return 0;
  const window = attempts.slice(-RECENCY_WEIGHTS.length);
  const weights = RECENCY_WEIGHTS.slice(RECENCY_WEIGHTS.length - window.length);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < window.length; i += 1) {
    const weight = weights[i] ?? 0;
    numerator += weight * attemptValue(window[i]!.result);
    denominator += weight;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * 服务端掌握度：加权 → 置信上限 → 提示 / 尝试扣分，最后夹到 `[0, 1]`。
 *
 * 这是写入 `mastery_records.mastery_basis_points` 的唯一公式。
 */
export function computeMasteryScore(
  attempts: readonly AttemptSignal[],
  latest?: Pick<AttemptSignal, 'hintsUsed' | 'attemptCount'>,
): number {
  if (attempts.length === 0) return 0;
  const raw = weightedMastery(attempts);
  const capped = Math.min(raw, confidenceCapFor(attempts.length));
  const last = latest ?? attempts[attempts.length - 1]!;
  const penalty = resolveQualityPenalty(last.hintsUsed, last.attemptCount);
  return clamp01(capped - penalty);
}

/** 是否通过量化门槛。 */
export function isQuantitativeMastered(
  score: number,
  threshold: number = QUANTITATIVE_THRESHOLD,
): boolean {
  return score >= threshold;
}

/**
 * 目标是否掌握：
 * - `memory | procedure` 看量化分是否达标；
 * - `concept | design` 只看服务端布尔（Feynman 式检查），分数不参与。
 */
export function isObjectiveMastered(
  knowledgeType: KnowledgeType,
  state: Pick<ObjectiveMasteryState, 'score' | 'qualitativeMastered'>,
  threshold: number = QUANTITATIVE_THRESHOLD,
): boolean {
  if (knowledgeType === 'concept' || knowledgeType === 'design') {
    return state.qualitativeMastered === true;
  }
  return isQuantitativeMastered(state.score, threshold);
}

/** 由量化分 / 布尔推导目标状态。 */
export function deriveObjectiveStatus(
  knowledgeType: KnowledgeType,
  state: Pick<ObjectiveMasteryState, 'score' | 'qualitativeMastered'>,
  threshold: number = QUANTITATIVE_THRESHOLD,
): ObjectiveStatus {
  if (isObjectiveMastered(knowledgeType, state, threshold)) return 'mastered';
  if (state.score > 0 || state.qualitativeMastered) return 'learning';
  return 'new';
}

/** 固定推进优先级：`answer_pending → review → probe → practice/assess → complete`。 */
export function nextAction(state: NextActionState): NextAction {
  if (state.hasPendingQuestion) return 'answer_pending';
  if (state.dueReviewObjectiveId !== null && state.dueReviewObjectiveId !== undefined) {
    return 'review';
  }
  const candidate = state.candidate;
  if (candidate === null || candidate === undefined) return 'complete';
  if (candidate.status === 'new') return 'probe';
  if (candidate.knowledgeType === 'concept' || candidate.knowledgeType === 'design') {
    return 'assess';
  }
  return 'practice';
}

/** 按类型取间隔序列中第 `intervalIndex` 个间隔；越界取最后一个。 */
export function reviewIntervalSessions(
  knowledgeType: KnowledgeType,
  intervalIndex: number,
): number {
  const sequence = REVIEW_INTERVALS[knowledgeType];
  const index = Math.max(0, Math.floor(intervalIndex));
  const clamped = Math.min(index, sequence.length - 1);
  return sequence[clamped] ?? sequence[sequence.length - 1] ?? 0;
}

/**
 * 下一次复习所在的课次下标。
 *
 * 课次是每周 5 节，因此「天」与「课次」一一对应（迁移 0008 的计划密度）。
 */
export function nextReviewSessionIndex(
  knowledgeType: KnowledgeType,
  intervalIndex: number,
  currentSessionIndex: number,
): number {
  return currentSessionIndex + reviewIntervalSessions(knowledgeType, intervalIndex);
}

/** 是否到达复习课次。`lastSessionIndex` 为空视为立即到期（新目标先探测）。 */
export function isReviewDue(state: ObjectiveMasteryState, currentSessionIndex: number): boolean {
  if (state.lastSessionIndex === null || state.lastSessionIndex === undefined) return true;
  const due = nextReviewSessionIndex(
    state.knowledgeType,
    state.intervalIndex,
    state.lastSessionIndex,
  );
  return currentSessionIndex >= due;
}

/**
 * 服务端独占的 `TheoryMastered` 判定：**本节全部理论目标**都达标才返回 true。
 *
 * 空的理论目标集合返回 false —— 没有理论就谈不上「理论已掌握」，避免把
 * 「无理论」误判成「已解锁实践」。
 */
export function computeTheoryMastered(
  theoryObjectiveIds: readonly string[],
  states: ReadonlyMap<
    string,
    Pick<ObjectiveMasteryState, 'knowledgeType' | 'score' | 'qualitativeMastered'>
  >,
  threshold: number = QUANTITATIVE_THRESHOLD,
): boolean {
  if (theoryObjectiveIds.length === 0) return false;
  return theoryObjectiveIds.every((objectiveId) => {
    const state = states.get(objectiveId);
    if (state === undefined) return false;
    return isObjectiveMastered(state.knowledgeType, state, threshold);
  });
}

/** 质量分 → 基点（0..10000），写入 `mastery_records` / `mastery_attempts`。 */
export function qualityBasisPoints(quality: number): number {
  return Math.round(clamp01(quality) * 10_000);
}

/** 掌握度 → 基点。 */
export function masteryBasisPoints(score: number): number {
  return qualityBasisPoints(score);
}
