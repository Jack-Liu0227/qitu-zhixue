import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  learningObjectives,
  learningPlans,
  projectPlanAdjustments,
  withTransaction,
  type Database,
} from '@qitu/database';
import type {
  KnowledgeType,
  PlanAdjustmentAction,
  PlanAdjustmentStatus,
  PlanAdjustmentTrigger,
  StudentStuckTriggerKey,
} from '@qitu/contracts';
import { PlanAdjustmentError } from './plan-adjustment.errors';
import {
  PlanAdjustmentStore,
  type AppendAdjustmentInput,
  type CommitAppendResult,
  type OutlineObjective,
  type PlanAdjustmentRecord,
  type RecommendAdjustmentInput,
  type RemediationNodePayload,
} from './plan-adjustment.store';

const PG_UNIQUE_VIOLATION = '23505';
const REMEDIAL_NODE_PREFIX = 'remedial:';

type AdjustmentRow = typeof projectPlanAdjustments.$inferSelect;
type ObjectiveRow = typeof learningObjectives.$inferSelect;

/**
 * live 持久化实现。映射迁移 0033 的 `project_plan_adjustments` 表。
 *
 * 两个必须在该层保证的不变式：
 * 1. `commitAppend` 在事务内 `SELECT ... FOR UPDATE` 锁住学习计划行，再校验
 *    `version === base_revision`，不匹配则返回 conflict（服务层 rebase），
 *    绝不静默覆盖并发写入；
 * 2. 本层只**追加** `learning_objectives`（isRemedial 节点）并递增
 *    `learning_plans.version`，从不 UPDATE/DELETE 任何模板必需目标。
 */
export class PostgresPlanAdjustmentStore extends PlanAdjustmentStore {
  constructor(private readonly db: Database) {
    super();
  }

  async findByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<PlanAdjustmentRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectPlanAdjustments)
      .where(and(
        eq(projectPlanAdjustments.projectId, projectId),
        eq(projectPlanAdjustments.idempotencyKey, idempotencyKey),
      ))
      .limit(1);
    return row === undefined ? null : mapAdjustment(row);
  }

  async findByTriggerKey(triggerKey: StudentStuckTriggerKey): Promise<PlanAdjustmentRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectPlanAdjustments)
      .where(eq(projectPlanAdjustments.triggerKey, triggerKey))
      .limit(1);
    return row === undefined ? null : mapAdjustment(row);
  }

  async countRemedialAppends(projectId: string, stemNodeId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectPlanAdjustments)
      .where(and(
        eq(projectPlanAdjustments.projectId, projectId),
        eq(projectPlanAdjustments.stemNodeId, stemNodeId),
        eq(projectPlanAdjustments.action, 'append_optional_remediation'),
        inArray(projectPlanAdjustments.status, ['proposed', 'accepted', 'applied']),
      ));
    return row?.count ?? 0;
  }

  async readPlanRevision(planId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ version: learningPlans.version })
      .from(learningPlans)
      .where(eq(learningPlans.id, planId))
      .limit(1);
    return row === undefined ? null : row.version;
  }

  async listObjectives(planId: string): Promise<OutlineObjective[]> {
    const rows = await this.db
      .select()
      .from(learningObjectives)
      .where(eq(learningObjectives.planId, planId))
      .orderBy(asc(learningObjectives.ordinal));
    return rows.map(mapObjective);
  }

  async commitAppend(input: AppendAdjustmentInput): Promise<CommitAppendResult> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const [plan] = await tx
          .select({ id: learningPlans.id, version: learningPlans.version })
          .from(learningPlans)
          .where(eq(learningPlans.id, input.adjustment.planId))
          .for('update')
          .limit(1);
        if (plan === undefined) {
          throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `学习计划不存在：${input.adjustment.planId}`);
        }
        if (plan.version !== input.adjustment.baseRevision) {
          return { kind: 'conflict', currentRevision: plan.version };
        }

        await tx.insert(learningObjectives).values({
          id: input.payload.nodeId,
          planId: input.adjustment.planId,
          moduleId: input.payload.moduleId,
          name: input.payload.name,
          type: input.payload.type,
          objective: input.payload.objective,
          prerequisiteIds: [...input.payload.prerequisiteIds],
          ordinal: input.payload.ordinal,
        });
        await tx
          .update(learningPlans)
          .set({ version: plan.version + 1, updatedAt: new Date() })
          .where(eq(learningPlans.id, input.adjustment.planId));
        await tx.insert(projectPlanAdjustments).values(mapAdjustmentToRow(input.adjustment));
        if (input.commit !== undefined) await input.commit(tx);
        return { kind: 'applied', adjustment: input.adjustment };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // 并发写入同 (project_id, idempotency_key)：事务已回滚，重读既有行复用。
        const existing = await this.findByIdempotencyKey(
          input.adjustment.projectId,
          input.adjustment.idempotencyKey,
        );
        if (existing !== null) return { kind: 'replayed', adjustment: existing };
      }
      throw error;
    }
  }

  async commitRecommend(input: RecommendAdjustmentInput): Promise<PlanAdjustmentRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        await tx.insert(projectPlanAdjustments).values(mapAdjustmentToRow(input.adjustment));
        if (input.commit !== undefined) await input.commit(tx);
        return input.adjustment;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(
          input.adjustment.projectId,
          input.adjustment.idempotencyKey,
        );
        if (existing !== null) return existing;
      }
      throw error;
    }
  }
}

function mapAdjustment(row: AdjustmentRow): PlanAdjustmentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    planId: row.planId,
    stemNodeId: row.stemNodeId,
    baseRevision: row.baseRevision,
    nextRevision: row.nextRevision,
    trigger: row.trigger as PlanAdjustmentTrigger,
    evidenceRefs: row.evidenceRefs ?? [],
    action: row.action as PlanAdjustmentAction,
    status: row.status as PlanAdjustmentStatus,
    policyVersion: row.policyVersion,
    idempotencyKey: row.idempotencyKey,
    triggerKey: row.triggerKey as StudentStuckTriggerKey,
    remedialDepth: row.remedialDepth,
    remediationPayload:
      row.remediationPayload === null || row.remediationPayload === undefined
        ? null
        : (row.remediationPayload as unknown as RemediationNodePayload),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdjustmentToRow(record: PlanAdjustmentRecord): typeof projectPlanAdjustments.$inferInsert {
  return {
    id: record.id,
    projectId: record.projectId,
    planId: record.planId,
    stemNodeId: record.stemNodeId,
    baseRevision: record.baseRevision,
    nextRevision: record.nextRevision,
    trigger: record.trigger,
    evidenceRefs: [...record.evidenceRefs],
    action: record.action,
    status: record.status,
    policyVersion: record.policyVersion,
    idempotencyKey: record.idempotencyKey,
    remedialDepth: record.remedialDepth,
    remediationPayload:
      record.remediationPayload === null ? null : (record.remediationPayload as unknown as Record<string, unknown>),
    triggerKey: record.triggerKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapObjective(row: ObjectiveRow): OutlineObjective {
  return {
    id: row.id,
    planId: row.planId,
    moduleId: row.moduleId,
    name: row.name,
    type: row.type as KnowledgeType,
    objective: row.objective,
    prerequisiteIds: row.prerequisiteIds ?? [],
    ordinal: row.ordinal,
    isRemedial: row.id.startsWith(REMEDIAL_NODE_PREFIX),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}
