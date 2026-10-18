import type { KnowledgeType, StudentStuckSignal } from '@qitu/contracts';
import { PlanAdjustmentError } from './plan-adjustment.errors';
import type { OutlineObjective, RemediationNodePayload } from './plan-adjustment.store';

export const REMEDIAL_NODE_PREFIX = 'remedial:';

/**
 * 为卡点信号构造待追加的补救节点载荷。
 *
 * - 补救节点 id 确定性：`remedial:${planId}:${stemNodeId}`（同一 stem node 最多
 *   一个补救节点，由深度熔断器 MAX_REMEDIAL_DEPTH=1 保证）；
 * - `isRemedial` 恒为 true；`prerequisiteIds = [stemNodeId]`；
 * - `type` 固定 `procedure`（补救练习是操作型目标）；
 * - 名称与目标文本只引用模板节点名（服务端拥有的模板文本），绝不含学生原文。
 */
export function buildRemediationNodePayload(
  signal: StudentStuckSignal,
  objectives: ReadonlyArray<OutlineObjective>,
): RemediationNodePayload {
  const stem = objectives.find((objective) => objective.id === signal.stemNodeId);
  if (stem === undefined) {
    throw new PlanAdjustmentError(
      'ADJUSTMENT_INVALID',
      `卡点节点不在计划大纲中：${signal.stemNodeId}`,
    );
  }
  const moduleObjectives = objectives.filter((objective) => objective.moduleId === stem.moduleId);
  const maxOrdinal = moduleObjectives.reduce(
    (max, objective) => Math.max(max, objective.ordinal),
    0,
  );
  const label = stem.name === '' ? signal.stemNodeId : stem.name;
  return {
    nodeId: `${REMEDIAL_NODE_PREFIX}${signal.planId}:${signal.stemNodeId}`,
    moduleId: stem.moduleId,
    name: `补救练习：${label}`,
    type: 'procedure' as const,
    objective: `针对「${label}」的补偿练习（不替代模板必需目标）`,
    prerequisiteIds: [signal.stemNodeId],
    ordinal: maxOrdinal + 1,
    isRemedial: true,
  };
}

/**
 * Append-only 不变量守卫（api-spec F4.1 红线）。
 *
 * 允许的 outline 变更只有一种：在既有目标集合后**追加**一个 `isRemedial` 节点。
 * - 删除任何既有目标 → `ADJUSTMENT_INVALID`；
 * - 改写既有目标的 name / type / objective / prerequisiteIds → `ADJUSTMENT_INVALID`；
 * - 追加非补救节点、或补救节点缺少前置 → `ADJUSTMENT_INVALID`。
 */
export function assertAppendOnlyOutlineMutation(
  before: ReadonlyArray<OutlineObjective>,
  after: ReadonlyArray<OutlineObjective>,
): void {
  const beforeById = new Map(before.map((objective) => [objective.id, objective]));
  const afterById = new Map(after.map((objective) => [objective.id, objective]));

  for (const previous of before) {
    const next = afterById.get(previous.id);
    if (next === undefined) {
      throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `模板必需目标不可删除：${previous.id}`);
    }
    if (
      next.name !== previous.name ||
      next.type !== previous.type ||
      next.objective !== previous.objective ||
      next.moduleId !== previous.moduleId ||
      next.ordinal !== previous.ordinal ||
      !sameIds(next.prerequisiteIds, previous.prerequisiteIds)
    ) {
      throw new PlanAdjustmentError(
        'ADJUSTMENT_INVALID',
        `模板必需目标不可削弱或改写：${previous.id}`,
      );
    }
  }

  for (const next of after) {
    if (beforeById.has(next.id)) continue;
    if (!next.isRemedial) {
      throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `只允许追加补救节点：${next.id}`);
    }
    if (next.prerequisiteIds.length === 0) {
      throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `补救节点必须声明前置节点：${next.id}`);
    }
    for (const prerequisite of next.prerequisiteIds) {
      if (!beforeById.has(prerequisite) && !afterById.has(prerequisite)) {
        throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `补救节点前置不存在：${prerequisite}`);
      }
    }
  }
}

function sameIds(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** 类型护栏：保证 payload 的 type 字段是合法 KnowledgeType。 */
export function assertKnowledgeType(value: string): asserts value is KnowledgeType {
  if (value !== 'memory' && value !== 'concept' && value !== 'procedure' && value !== 'design') {
    throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `非法知识类型：${value}`);
  }
}
