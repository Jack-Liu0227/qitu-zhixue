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
