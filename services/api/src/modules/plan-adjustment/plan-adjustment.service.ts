import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MAX_AUTO_REBASE_ATTEMPTS,
  MAX_REMEDIAL_DEPTH,
  type DesensitizedStuckSummary,
  type PlanAdjustmentIdempotencyKey,
  type ProjectPlanAdjustment,
  type StudentStuckSignal,
  type StuckSummaryPriority,
} from '@qitu/contracts';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import {
  assertAppendOnlyOutlineMutation,
  buildRemediationNodePayload,
} from './append-only-guard';
import {
  buildDesensitizedStuckSummary,
  desensitizedSummaryDetail,
} from './desensitize';
import { PlanAdjustmentError, isPlanAdjustmentError } from './plan-adjustment.errors';
import {
  PlanAdjustmentStore,
  type OutlineObjective,
  type PlanAdjustmentRecord,
  type RemediationNodePayload,
} from './plan-adjustment.store';

/** 冻结的策略文档版本：解释「为什么当时这样调」。 */
export const PLAN_ADJUSTMENT_POLICY_VERSION = 'pbl.adjustment.v1';

/** 脱敏审计事件动作（api-spec F4.4 / 任务约定）。 */
export const STUCK_SIGNAL_AUDIT_ACTION = 'tutor.stuck_signal.desensitized';

/** 事务性 outbox 主题（与审计动作对齐，供未来 worker 按主题投递）。 */
export const STUCK_SIGNAL_OUTBOX_TOPIC = 'tutor.stuck.signal.desensitized';

/** autoAdjust 的一次结果。 */
export interface PlanAdjustmentResult {
  adjustment: PlanAdjustmentRecord | null;
  summary: DesensitizedStuckSummary;
  /** 命中节点级幂等键 / triggerKey 去重，复用既有行（未产生新写）。 */
  replayed: boolean;
  /** 乐观锁 rebase 耗尽（未写 outline，只落 warning 审计）。 */
  rebaseExhausted: boolean;
}

/** 节点级幂等键：`plan.adjustment:${projectId}:${stemNodeId}:${trigger}`。 */
export function planAdjustmentIdempotencyKey(
  signal: Pick<StudentStuckSignal, 'projectId' | 'stemNodeId' | 'trigger'>,
): PlanAdjustmentIdempotencyKey {
  return `plan.adjustment:${signal.projectId}:${signal.stemNodeId}:${signal.trigger}`;
}

/** 确定性调整 id（同幂等键重放得到同一 id）。 */
export function adjustmentId(idempotencyKey: string): string {
  return `padj_${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

/**
 * 宏观调谐服务：卡点信号 → 计划调整（api-spec F4.2 / pedagogy-spec §7）。
 *
 * 只做两件事：
 * 1. 节点级幂等：同 (project, stemNode, trigger) 只产生一个调整；
 * 2. 首次卡点追加补救节点；同 stem node 已有补救节点时熔断为
 *    `recommend_teacher_support` + HIGH 优先级（不写 outline）。
 *
 * 乐观锁：apply 前读 `learning_plans.version`，冲突自动 rebase（最多 3 次）；
 * 耗尽 → 只写 `ADJUSTMENT_REBASE_EXHAUSTED` warning 审计，不向客户端抛 409。
 */
@Injectable()
export class PlanAdjustmentService {
  constructor(
    private readonly store: PlanAdjustmentStore,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async findByTriggerKey(signal: StudentStuckSignal): Promise<PlanAdjustmentRecord | null> {
    return this.store.findByTriggerKey(signal.triggerKey);
  }

  async autoAdjust(signal: StudentStuckSignal): Promise<PlanAdjustmentResult> {
    const idempotencyKey = planAdjustmentIdempotencyKey(signal);

    const existing = await this.store.findByIdempotencyKey(signal.projectId, idempotencyKey);
    if (existing !== null) {
      return {
        adjustment: existing,
        summary: buildDesensitizedStuckSummary(signal, priorityFor(existing)),
        replayed: true,
        rebaseExhausted: false,
      };
    }

    for (let attempt = 0; attempt < MAX_AUTO_REBASE_ATTEMPTS; attempt += 1) {
      // 循环内再查一次：并发创建可能已在上一轮之间落库。
      const replay = await this.store.findByIdempotencyKey(signal.projectId, idempotencyKey);
      if (replay !== null) {
        return {
          adjustment: replay,
          summary: buildDesensitizedStuckSummary(signal, priorityFor(replay)),
          replayed: true,
          rebaseExhausted: false,
        };
      }

      const revision = await this.store.readPlanRevision(signal.planId);
      if (revision === null) {
        throw new PlanAdjustmentError('ADJUSTMENT_INVALID', `学习计划不存在：${signal.planId}`);
      }

      const remedialDepth = await this.store.countRemedialAppends(signal.projectId, signal.stemNodeId);
      if (remedialDepth >= MAX_REMEDIAL_DEPTH) {
        return this.recommendTeacherSupport(signal, revision, remedialDepth, idempotencyKey);
      }

      const objectives = await this.store.listObjectives(signal.planId);
      const payload = buildRemediationNodePayload(signal, objectives);
      const appendedObjective: OutlineObjective = {
        id: payload.nodeId,
        planId: signal.planId,
        moduleId: payload.moduleId,
        name: payload.name,
        type: payload.type,
        objective: payload.objective,
        prerequisiteIds: payload.prerequisiteIds,
        ordinal: payload.ordinal,
        isRemedial: payload.isRemedial,
      };
      assertAppendOnlyOutlineMutation(objectives, [...objectives, appendedObjective]);

      const adjustment = buildAppendAdjustment(signal, revision, remedialDepth, idempotencyKey, payload);
      const result = await this.store.commitAppend({
        adjustment,
        payload,
        commit: (tx) => this.commitEvents(adjustment, signal, tx),
      });

      if (result.kind === 'applied') {
        return {
          adjustment: result.adjustment,
          summary: buildDesensitizedStuckSummary(signal, 'normal'),
          replayed: false,
          rebaseExhausted: false,
        };
      }
      if (result.kind === 'replayed') {
        return {
          adjustment: result.adjustment,
          summary: buildDesensitizedStuckSummary(signal, priorityFor(result.adjustment)),
          replayed: true,
          rebaseExhausted: false,
        };
      }
      // result.kind === 'conflict' → autoRebase：下一轮以最新 revision 重试。
    }

    return this.exhaustRebase(signal, idempotencyKey);
  }

  /** 深度熔断器：不写 outline，直接建议班主任介入 + HIGH 优先级。 */
  private async recommendTeacherSupport(
    signal: StudentStuckSignal,
    revision: number,
    remedialDepth: number,
    idempotencyKey: PlanAdjustmentIdempotencyKey,
  ): Promise<PlanAdjustmentResult> {
    const adjustment = buildRecommendAdjustment(signal, revision, remedialDepth, idempotencyKey);
    const record = await this.store.commitRecommend({
      adjustment,
      commit: (tx) => this.commitEvents(adjustment, signal, tx),
    });
    return {
      adjustment: record,
      summary: buildDesensitizedStuckSummary(signal, 'high'),
      replayed: false,
      rebaseExhausted: false,
    };
  }

  private async exhaustRebase(
    signal: StudentStuckSignal,
    idempotencyKey: PlanAdjustmentIdempotencyKey,
  ): Promise<PlanAdjustmentResult> {
    const summary = buildDesensitizedStuckSummary(signal, 'high');
    try {
      await this.audit.write({
        action: STUCK_SIGNAL_AUDIT_ACTION,
        targetType: 'project_plan_adjustment',
        targetId: signal.planId,
        idempotencyKey: `rebase-exhausted:${idempotencyKey}`,
        detail: {
          ...desensitizedSummaryDetail(summary),
          code: 'ADJUSTMENT_REBASE_EXHAUSTED',
          severity: 'warning',
        },
      });
    } catch (error) {
      // 并发耗尽时同幂等键可能已由另一路写入（audit_logs.idempotency_key 唯一）；
      // 命中唯一冲突视为已记录，不掩盖「耗尽」这一业务结果。
      if (!isUniqueViolation(error)) throw error;
    }
    return { adjustment: null, summary, replayed: false, rebaseExhausted: true };
  }

  /** 与业务写入同事务的审计 + outbox（仅在新行真正落库时调用）。 */
  private async commitEvents(
    adjustment: PlanAdjustmentRecord,
    signal: StudentStuckSignal,
    tx?: AuditTransaction,
  ): Promise<void> {
    const summary = buildDesensitizedStuckSummary(signal, priorityFor(adjustment));
    const detail = desensitizedSummaryDetail(summary);
    await this.audit.write(
      {
        action: STUCK_SIGNAL_AUDIT_ACTION,
        targetType: 'project_plan_adjustment',
        targetId: adjustment.id,
        idempotencyKey: adjustment.idempotencyKey,
        detail,
      },
      tx,
    );
    await this.outbox.write(
      {
        id: `stuck-summary:${adjustment.idempotencyKey}`,
        topic: STUCK_SIGNAL_OUTBOX_TOPIC,
        payload: detail,
      },
      tx,
    );
  }

  /** ingest 失败时的审计兜底（audit-only，不吞原错误；重放路径见文档）。 */
  async writeIngestFailureAudit(signal: StudentStuckSignal, error: unknown): Promise<void> {
    try {
      const summary = buildDesensitizedStuckSummary(signal, 'high');
      await this.audit.write({
        action: STUCK_SIGNAL_AUDIT_ACTION,
        targetType: 'project_plan_adjustment',
        targetId: signal.planId,
        idempotencyKey: `ingest-failed:${signal.triggerKey}`,
        detail: {
          ...desensitizedSummaryDetail(summary),
          code: 'PLAN_ADJUSTMENT_INGEST_FAILED',
          errorCode: errorCodeOf(error),
        },
      });
    } catch {
      // best-effort：审计本身失败时绝不掩盖原始业务错误。
    }
  }
}

function priorityFor(adjustment: Pick<ProjectPlanAdjustment, 'action'>): StuckSummaryPriority {
  return adjustment.action === 'recommend_teacher_support' ? 'high' : 'normal';
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === '23505';
}

function errorCodeOf(error: unknown): string {
  if (isPlanAdjustmentError(error)) return error.code;
  if (error !== null && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

function buildAppendAdjustment(
  signal: StudentStuckSignal,
  revision: number,
  remedialDepth: number,
  idempotencyKey: PlanAdjustmentIdempotencyKey,
  payload: RemediationNodePayload,
): PlanAdjustmentRecord {
  return {
    id: adjustmentId(idempotencyKey),
    projectId: signal.projectId,
    planId: signal.planId,
    stemNodeId: signal.stemNodeId,
    baseRevision: revision,
    nextRevision: revision + 1,
    trigger: signal.trigger,
    evidenceRefs: [...signal.evidenceRefs],
    action: 'append_optional_remediation',
    status: 'applied',
    policyVersion: PLAN_ADJUSTMENT_POLICY_VERSION,
    idempotencyKey,
    triggerKey: signal.triggerKey,
    remedialDepth,
    remediationPayload: payload,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildRecommendAdjustment(
  signal: StudentStuckSignal,
  revision: number,
  remedialDepth: number,
  idempotencyKey: PlanAdjustmentIdempotencyKey,
): PlanAdjustmentRecord {
  return {
    id: adjustmentId(idempotencyKey),
    projectId: signal.projectId,
    planId: signal.planId,
    stemNodeId: signal.stemNodeId,
    baseRevision: revision,
    nextRevision: revision,
    trigger: signal.trigger,
    evidenceRefs: [...signal.evidenceRefs],
    action: 'recommend_teacher_support',
    status: 'proposed',
    policyVersion: PLAN_ADJUSTMENT_POLICY_VERSION,
    idempotencyKey,
    triggerKey: signal.triggerKey,
    remedialDepth,
    remediationPayload: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
