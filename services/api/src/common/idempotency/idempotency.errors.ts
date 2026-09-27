import { BadRequestException, ConflictException } from '@nestjs/common';
import type { IdempotencyErrorCode } from './idempotency.types';

/**
 * 幂等层的领域错误。
 *
 * `message` 面向调用方，`code` 直接取自契约 `ApiErrorCode` 的子集。控制器用
 * `throwHttpForIdempotencyError()` 统一翻译成 HTTP 状态码，避免每个写接口各写
 * 一遍 try/catch 导致状态码漂移。
 */
export class IdempotencyError extends Error {
  constructor(
    readonly code: IdempotencyErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

/** 与 `IdempotencyErrorCode` 一一对应的可读错误信息。 */
export const IDEMPOTENCY_ERROR_MESSAGES: Record<IdempotencyErrorCode, string> = {
  IDEMPOTENCY_CONFLICT: '相同 Idempotency-Key 已用于不同请求，或该请求正在处理中',
  IDEMPOTENCY_KEY_REQUIRED: '缺少或非法的 Idempotency-Key',
};

/**
 * 把幂等领域错误翻译成 HTTP 异常。
 *
 * - `IDEMPOTENCY_CONFLICT` → 409；
 * - `IDEMPOTENCY_KEY_REQUIRED` → 400。
 *
 * 非本层错误原样抛出，避免吞掉业务/数据库异常。
 */
export function throwHttpForIdempotencyError(error: unknown): never {
  if (error instanceof IdempotencyError) {
    const body = { code: error.code, message: IDEMPOTENCY_ERROR_MESSAGES[error.code] };
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      throw new ConflictException(body);
    }
    throw new BadRequestException(body);
  }
  throw error;
}
