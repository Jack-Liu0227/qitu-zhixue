import {
  computeMasteryScore,
  computeTheoryMastered,
  confidenceCapFor,
  deriveObjectiveStatus,
  isObjectiveMastered,
  isQuantitativeMastered,
  nextAction,
  nextReviewSessionIndex,
  qualityBasisPoints,
  reviewIntervalSessions,
  REVIEW_INTERVALS,
  resolveQualityPenalty,
  weightedMastery,
  type AttemptSignal,
} from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function attempt(
  result: AttemptSignal['result'],
  extra: Partial<AttemptSignal> = {},
): AttemptSignal {
  return { result, isCorrect: result === 'correct', hintsUsed: 0, attemptCount: 1, ...extra };
}

/** 掌握度引擎纯函数断言（无 I/O），由 `pnpm --filter @qitu/ai-client test` 调用。 */
export function runMasteryAssertions(): void {
  // 单次答对不能过关：置信上限 0.5
  assert(confidenceCapFor(1) === 0.5, '一次作答的置信上限应为 0.5');
  const once = computeMasteryScore([attempt('correct')]);
  assert(once === 0.5, `一次答对得分应为 0.5，实际 ${once}`);
  assert(!isQuantitativeMastered(once), '一次答对不应通过 0.9 门槛');

  // 两次 0.8 封顶，三次全对过关
  assert(
    computeMasteryScore([attempt('correct'), attempt('correct')]) === 0.8,
    '两次全对应被 0.8 封顶',
  );
  const three = computeMasteryScore([attempt('correct'), attempt('correct'), attempt('correct')]);
  assert(three === 1 && isQuantitativeMastered(three), '三次全对应通过量化门槛');

  // 近期加权
  const wrongThenRight = weightedMastery([attempt('incorrect'), attempt('correct')]);
  const rightThenWrong = weightedMastery([attempt('correct'), attempt('incorrect')]);
  assert(wrongThenRight > rightThenWrong, '近期正确应比近期错误权重更高');

  // 扣分上限
  assert(resolveQualityPenalty(0, 1) === 0, '无提示无额外尝试不扣分');
  assert(resolveQualityPenalty(10, 1) === 0.25, '提示扣分上限 0.25');
  assert(resolveQualityPenalty(0, 10) === 0.2, '尝试扣分上限 0.2');
  assert(resolveQualityPenalty(10, 10) === 0.45, '两项扣分叠加');
  const penalized = computeMasteryScore([
    attempt('correct'),
    attempt('correct'),
    attempt('correct', { hintsUsed: 2, attemptCount: 3 }),
  ]);
  assert(Math.abs(penalized - 0.74) < 1e-9, `扣分后得分应为 0.74，实际 ${penalized}`);

  // 质化目标只看布尔
  assert(!isObjectiveMastered('concept', { score: 1, qualitativeMastered: false }), '概念必须布尔达标');
  assert(isObjectiveMastered('design', { score: 0, qualitativeMastered: true }), '设计只认布尔');
  assert(deriveObjectiveStatus('procedure', { score: 0.95, qualitativeMastered: false }) === 'mastered', '程序 0.95 应掌握');
  assert(deriveObjectiveStatus('concept', { score: 0.2, qualitativeMastered: false }) === 'learning', '有分未达标应为 learning');
  assert(deriveObjectiveStatus('concept', { score: 0, qualitativeMastered: false }) === 'new', '无布尔无分应为 new');

  // 推进优先级
  assert(nextAction({ hasPendingQuestion: true, candidate: { objectiveId: 'o', knowledgeType: 'memory', status: 'new' } }) === 'answer_pending', '有未答题优先');
  assert(nextAction({ hasPendingQuestion: false, dueReviewObjectiveId: 'r', candidate: null }) === 'review', '复习次优先');
  assert(nextAction({ hasPendingQuestion: false, candidate: { objectiveId: 'o', knowledgeType: 'memory', status: 'new' } }) === 'probe', '新目标探测');
  assert(nextAction({ hasPendingQuestion: false, candidate: { objectiveId: 'o', knowledgeType: 'memory', status: 'learning' } }) === 'practice', '量化目标练习');
  assert(nextAction({ hasPendingQuestion: false, candidate: { objectiveId: 'o', knowledgeType: 'concept', status: 'learning' } }) === 'assess', '质化目标评估');
  assert(nextAction({ hasPendingQuestion: false, candidate: null }) === 'complete', '无候选即完成');

  // 复习序列
  assert(reviewIntervalSessions('memory', 0) === 0, 'memory 第 0 间隔为 0');
  assert(reviewIntervalSessions('memory', 2) === 3, 'memory 第 2 间隔为 3');
  assert(nextReviewSessionIndex('memory', 2, 5) === 8, '复习课次 = 当前 + 间隔');
  assert(nextReviewSessionIndex('design', 0, 5) === 19, 'design 首次复习在 +14');
  assert(reviewIntervalSessions('memory', 99) === REVIEW_INTERVALS.memory.at(-1), '越界取最后一个间隔');

  // TheoryMastered 服务端判定
  const states = new Map([
    ['t1', { knowledgeType: 'memory' as const, score: 0.95, qualitativeMastered: false }],
    ['t2', { knowledgeType: 'concept' as const, score: 1, qualitativeMastered: false }],
  ]);
  assert(computeTheoryMastered(['t1'], states), '单个理论目标达标');
  assert(!computeTheoryMastered(['t1', 't2'], states), '任一理论未达标不算通过');
  assert(computeTheoryMastered([], states) === false, '空理论集合不算通过');

  // 基点
  assert(qualityBasisPoints(0.9) === 9000, '0.9 → 9000 基点');
  assert(qualityBasisPoints(1.5) === 10000, '越界夹到 10000');
}
