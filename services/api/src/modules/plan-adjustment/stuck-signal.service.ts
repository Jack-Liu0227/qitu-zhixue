import { Injectable } from '@nestjs/common';
import type { StudentStuckSignal } from '@qitu/contracts';
import { buildDesensitizedStuckSummary } from './desensitize';
import { PlanAdjustmentService, type PlanAdjustmentResult } from './plan-adjustment.service';
import { PlanAdjustmentStore } from './plan-adjustment.store';

/** ingest 的结果：在 autoAdjust 结果上追加「是否真的新建了调整行」。 */
export interface IngestStuckSignalResult extends PlanAdjustmentResult {
  /**
   * `false` = 命中 `signal.triggerKey` 去重（first crossing 语义：第二次
   * crossing 直接复用既有行，不再写审计 / outbox）。
   */
  created: boolean;
}

/**
 * 卡点信号入口（api-spec F4.1）。
 *
 * - 按 `signal.triggerKey` 做节点级去重（first crossing 才落调整行）；
 * - 交给 `PlanAdjustmentService.autoAdjust` 做节点级幂等 / 熔断 / rebase；
 * - 事务性写失败时退回 audit-only 兜底并重抛，重放按 audit_logs.idempotency_key
 *   推导（不重复发信号）。
 */
@Injectable()
export class StuckSignalService {
  constructor(
    private readonly store: PlanAdjustmentStore,
    private readonly adjustments: PlanAdjustmentService,
  ) {}

  async ingest(signal: StudentStuckSignal): Promise<IngestStuckSignalResult> {
    const existingByTrigger = await this.store.findByTriggerKey(signal.triggerKey);
    if (existingByTrigger !== null) {
      return {
        adjustment: existingByTrigger,
        summary: buildDesensitizedStuckSummary(
          signal,
          existingByTrigger.action === 'recommend_teacher_support' ? 'high' : 'normal',
        ),
        replayed: true,
        rebaseExhausted: false,
        created: false,
      };
    }

    try {
      const result = await this.adjustments.autoAdjust(signal);
      return { ...result, created: !result.replayed && !result.rebaseExhausted };
    } catch (error) {
      await this.adjustments.writeIngestFailureAudit(signal, error);
      throw error;
    }
  }
}
