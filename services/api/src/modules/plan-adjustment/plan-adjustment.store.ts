import type { AuditTransaction } from '../../common/audit/audit.service';
import type {
  KnowledgeType,
  PlanAdjustmentStatus,
  ProjectPlanAdjustment,
  StudentStuckTriggerKey,
} from '@qitu/contracts';
import { PlanAdjustmentError } from './plan-adjustment.errors';

/**
 * 学习计划大纲节点（最小投影）。`isRemedial` 由节点 id 前缀 `remedial:` 推导，
 * 因为 `learning_objectives` 没有补救标记列——这是本切片拥有的约定。
 */
export interface OutlineObjective {
  id: string;
  planId: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  objective: string;
  prerequisiteIds: string[];
  ordinal: number;
  isRemedial: boolean;
}

/** 追加进 outline 的补救节点载荷（持久化于 `remediation_payload`）。 */
export interface RemediationNodePayload extends Omit<OutlineObjective, 'id' | 'planId' | 'isRemedial'> {
  nodeId: string;
  isRemedial: true;
}

/** 计划调整记录（数据库行 + 领域扩展字段）。 */
export interface PlanAdjustmentRecord extends ProjectPlanAdjustment {
  stemNodeId: string;
  triggerKey: StudentStuckTriggerKey;
  remedialDepth: number;
  remediationPayload: RemediationNodePayload | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppendAdjustmentInput {
  adjustment: PlanAdjustmentRecord;
  payload: RemediationNodePayload;
  /** 与业务写入同事务的回调（审计 + outbox）。 */
  commit?: (tx?: AuditTransaction) => Promise<void>;
}

export interface RecommendAdjustmentInput {
  adjustment: PlanAdjustmentRecord;
  commit?: (tx?: AuditTransaction) => Promise<void>;
}

export type CommitAppendResult =
  | { kind: 'applied'; adjustment: PlanAdjustmentRecord }
  | { kind: 'replayed'; adjustment: PlanAdjustmentRecord }
  | { kind: 'conflict'; currentRevision: number };

/**
 * 计划调整的持久化边界。
 *
 * 服务层只依赖这个抽象；测试用内存实现，live 用 PostgreSQL 实现
 * （`plan-adjustment.store.postgres.ts`）。本切片只读 / 追加写
 * `learning_plans` / `learning_objectives`（经 `DATABASE_TOKEN` 直连事务），
 * **不**修改任何 learning-plan 源文件。
 */
export abstract class PlanAdjustmentStore {
  abstract findByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<PlanAdjustmentRecord | null>;

  abstract findByTriggerKey(triggerKey: StudentStuckTriggerKey): Promise<PlanAdjustmentRecord | null>;

  abstract countRemedialAppends(projectId: string, stemNodeId: string): Promise<number>;

  abstract readPlanRevision(planId: string): Promise<number | null>;

  abstract listObjectives(planId: string): Promise<OutlineObjective[]>;

  abstract commitAppend(input: AppendAdjustmentInput): Promise<CommitAppendResult>;

  abstract commitRecommend(input: RecommendAdjustmentInput): Promise<PlanAdjustmentRecord>;
}

function cloneAdjustment(record: PlanAdjustmentRecord): PlanAdjustmentRecord {
  return {
    ...record,
    evidenceRefs: [...record.evidenceRefs],
    remediationPayload: record.remediationPayload === null ? null : { ...record.remediationPayload, prerequisiteIds: [...record.remediationPayload.prerequisiteIds] },
  };
}

/**
 * 内存实现（demo / test）。与 Postgres 实现保持同样的幂等语义：
 * - 唯一 (project_id, idempotency_key) 在同步临界区内检查 + 写入；
 * - 冲突返回 `{ kind: 'conflict', currentRevision }` 而非抛错，交给服务层 rebase。
 */
export class InMemoryPlanAdjustmentStore extends PlanAdjustmentStore {
  private readonly adjustments = new Map<string, PlanAdjustmentRecord>();
  private readonly byIdempotency = new Map<string, string>();
  private readonly byTriggerKey = new Map<string, string>();
  private readonly planRevisions = new Map<string, number>();
  private readonly objectives = new Map<string, OutlineObjective[]>();

  get adjustmentCount(): number {
    return this.adjustments.size;
  }

  seedPlan(
    planId: string,
    revision: number,
    objectives: Array<Omit<OutlineObjective, 'isRemedial'> & { isRemedial?: boolean }>,
  ): void {
    this.planRevisions.set(planId, revision);
    this.objectives.set(
      planId,
      objectives.map((objective) => ({
        ...objective,
        isRemedial: objective.isRemedial ?? false,
        prerequisiteIds: [...objective.prerequisiteIds],
      })),
    );
  }

  seedAdjustment(record: PlanAdjustmentRecord): void {
    this.insertAdjustment(record);
  }

  setPlanRevision(planId: string, revision: number): void {
    this.planRevisions.set(planId, revision);
  }

  async findByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<PlanAdjustmentRecord | null> {
    const id = this.byIdempotency.get(this.projectKey(projectId, idempotencyKey));
    return id === undefined ? null : cloneAdjustment(this.adjustments.get(id)!);
  }

  async findByTriggerKey(triggerKey: StudentStuckTriggerKey): Promise<PlanAdjustmentRecord | null> {
    const id = this.byTriggerKey.get(triggerKey);
    return id === undefined ? null : cloneAdjustment(this.adjustments.get(id)!);
  }

  async countRemedialAppends(projectId: string, stemNodeId: string): Promise<number> {
    const active: ReadonlySet<PlanAdjustmentStatus> = new Set(['proposed', 'accepted', 'applied']);
    let count = 0;
    for (const record of this.adjustments.values()) {
      if (
        record.projectId === projectId &&
        record.stemNodeId === stemNodeId &&
        record.action === 'append_optional_remediation' &&
        active.has(record.status)
      ) {
        count += 1;
      }
    }
    return count;
  }

  async readPlanRevision(planId: string): Promise<number | null> {
    return this.planRevisions.get(planId) ?? null;
  }

  async listObjectives(planId: string): Promise<OutlineObjective[]> {
    return (this.objectives.get(planId) ?? []).map((objective) => ({
      ...objective,
      prerequisiteIds: [...objective.prerequisiteIds],
    }));
  }

  async commitAppend(input: AppendAdjustmentInput): Promise<CommitAppendResult> {
    const { adjustment, payload, commit } = input;
    const key = this.projectKey(adjustment.projectId, adjustment.idempotencyKey);
    const existingId = this.byIdempotency.get(key);
    if (existingId !== undefined) {
      return { kind: 'replayed', adjustment: cloneAdjustment(this.adjustments.get(existingId)!) };
    }
    const current = this.planRevisions.get(adjustment.planId);
    if (current === undefined) {
      throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `学习计划不存在：${adjustment.planId}`);
    }
    if (current !== adjustment.baseRevision) {
      return { kind: 'conflict', currentRevision: current };
    }

    // 同步临界区：在第一个 await（commit 回调）之前完成全部状态变更，
    // 保证并发的双重 ingest 只会有一方拿到 applied。
    const objectives = this.objectives.get(adjustment.planId) ?? [];
    this.objectives.set(adjustment.planId, [
      ...objectives,
      {
        id: payload.nodeId,
        planId: adjustment.planId,
        moduleId: payload.moduleId,
        name: payload.name,
        type: payload.type,
        objective: payload.objective,
        prerequisiteIds: [...payload.prerequisiteIds],
        ordinal: payload.ordinal,
        isRemedial: payload.isRemedial,
      },
    ]);
    this.planRevisions.set(adjustment.planId, current + 1);
    this.insertAdjustment(adjustment);
    if (commit !== undefined) await commit(undefined);
    return { kind: 'applied', adjustment: cloneAdjustment(adjustment) };
  }

  async commitRecommend(input: RecommendAdjustmentInput): Promise<PlanAdjustmentRecord> {
    const { adjustment, commit } = input;
    const key = this.projectKey(adjustment.projectId, adjustment.idempotencyKey);
    const existingId = this.byIdempotency.get(key);
    if (existingId !== undefined) {
      return cloneAdjustment(this.adjustments.get(existingId)!);
    }
    this.insertAdjustment(adjustment);
    if (commit !== undefined) await commit(undefined);
    return cloneAdjustment(adjustment);
  }

  private insertAdjustment(record: PlanAdjustmentRecord): void {
    this.adjustments.set(record.id, cloneAdjustment(record));
    this.byIdempotency.set(this.projectKey(record.projectId, record.idempotencyKey), record.id);
    this.byTriggerKey.set(record.triggerKey, record.id);
  }

  private projectKey(projectId: string, idempotencyKey: string): string {
    return `${projectId}\u0000${idempotencyKey}`;
  }
}
