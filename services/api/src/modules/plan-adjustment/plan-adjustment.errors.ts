/**
 * 宏观调谐（计划调整）的错误码（api-spec F4.3）。
 *
 * F4 切片没有 HTTP 控制器；服务层抛带稳定 `code` 的错误，由上层（F1 接线）
 * 决定是否映射为 RFC 9457 ProblemDetails。`code` 与 `@qitu/contracts` 的
 * `ApiErrorCode` 字面量保持一致。
 */
export type PlanAdjustmentErrorCode =
  | 'ADJUSTMENT_INVALID'
  | 'ADJUSTMENT_NOT_FOUND'
  | 'ADJUSTMENT_CONFLICT'
  | 'ADJUSTMENT_REBASE_EXHAUSTED'
  | 'ADJUSTMENT_DEPTH_CIRCUIT_BROKEN';

/**
 * 保留错误码说明（api-spec F4.3 声明的码在本切片中暂不产生）。
 *
 * - `ADJUSTMENT_CONFLICT`：保留。F4 没有 HTTP 控制器，也没有单次非 rebase
 *   的提交路径；存储层用 `{ kind: 'conflict', currentRevision }` 返回冲突，
 *   服务层会自动 rebase（`MAX_AUTO_REBASE_ATTEMPTS` 次）而不是把冲突抛给
 *   客户端。未来若暴露同步调整端点，再把最终一次的 conflict 映射为该码。
 *
 * - `ADJUSTMENT_NOT_FOUND`：保留。F4 没有按调整 id 读取的 HTTP 端点；
 *   `findByIdempotencyKey` / `findByTriggerKey` 未命中时返回 `null` 以驱动
 *   重放 / 新建语义，而不是 404。留待未来的调整详情端点使用。
 *
 * - `ADJUSTMENT_DEPTH_CIRCUIT_BROKEN`：保留。深度熔断器（`MAX_REMEDIAL_DEPTH`
 *   已满）在本切片是**优雅降级**：不抛 409，而是产出
 *   `recommend_teacher_support` 调整行 + HIGH 优先级脱敏摘要（人工介入）。
 *   该码用于描述这一熔断条件，目前不向调用方抛出。
 */

/** 计划调整域错误。 */
export class PlanAdjustmentError extends Error {
  constructor(
    readonly code: PlanAdjustmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanAdjustmentError';
  }
}

export function isPlanAdjustmentError(error: unknown): error is PlanAdjustmentError {
  return error instanceof PlanAdjustmentError;
}
