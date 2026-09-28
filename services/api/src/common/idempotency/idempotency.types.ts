import type { ApiErrorCode } from '@qitu/contracts';

/**
 * 幂等基础能力的**类型契约**。
 *
 * 本文件是纯类型（无运行时依赖），供 service / module 与调用方共享。
 */

/**
 * 本能力会用到的契约错误码。
 *
 * 只从已冻结的 `ApiErrorCode` 中 `Extract`，**不新增、不修改**任何错误码：
 * - `IDEMPOTENCY_CONFLICT`：同 key 不同 payload，或同 key 的并发请求仍在处理中；
 * - `IDEMPOTENCY_KEY_REQUIRED`：缺少 `Idempotency-Key`，或 scope / requestHash 为空。
 */
export type IdempotencyErrorCode = Extract<
  ApiErrorCode,
  'IDEMPOTENCY_CONFLICT' | 'IDEMPOTENCY_KEY_REQUIRED'
>;

/**
 * `idempotency_keys.status` 的取值（与迁移里的 text 枚举一致）。
 *
 * - `in_progress`：已被某个请求认领，正在执行 handler；
 * - `succeeded`：handler 成功，`response_status` / `response_body` 已保存，可重放；
 * - `failed`：handler 抛错，允许同 key 同 hash **重试**（重新认领并执行）。
 */
export type IdempotencyStatus = 'in_progress' | 'succeeded' | 'failed';

/**
 * handler 的成功结果。
 *
 * - `status`：HTTP 状态码，省略时默认 `200`（如创建资源可显式给 `201`）；
 * - `body`：响应体。**落库前会被递归脱敏**，因此调用方无需自己做凭据过滤，
 *   但也不应把不可 JSON 序列化的对象（Map / Set / 函数）塞进来。
 */
export interface IdempotentResponse<T = unknown> {
  status?: number;
  body: T;
}

/** 一段可幂等执行的业务逻辑。只会在「拿到执行权」时被调用一次（重放不会触发）。 */
export type IdempotentHandler<T = unknown> = () =>
  IdempotentResponse<T> | Promise<IdempotentResponse<T>>;

/** `execute()` 的返回值：状态码、响应体，以及本次是否来自持久化记录的重放。 */
export interface IdempotencyResult<T = unknown> {
  status: number;
  body: T;
  /** `true` 表示命中已保存结果、未再次执行 handler。 */
  replayed: boolean;
}

/** `execute()` 的可选调参（有安全默认值，通常无需传）。 */
export interface IdempotencyExecuteOptions {
  /**
   * 完成后记录的保留时长（毫秒）。到期行可被 `cleanupExpired()` 清理。
   * 默认 24h。
   */
  retentionMs?: number;
  /**
   * `in_progress` 的执行租约（毫秒）。租约到期前，同 key 的并发请求一律冲突；
   * 到期后才允许被回收重试。默认 60s。
   *
   * 注意：租约必须**长于 handler 的最坏耗时**，否则慢请求可能被并发回收而双执行。
   */
  processingLeaseMs?: number;
}
