/**
 * 共享基础设施（Redis / 队列）的稳定错误码。
 *
 * 与 `packages/contracts` 的 `ApiErrorCode` 不同：这些是**服务端内部**错误，
 * 只有在映射到 HTTP 时才会转成 503 等对外状态；错误码保持稳定便于日志告警。
 */
export type InfraErrorCode =
  'REDIS_UNAVAILABLE' | 'REDIS_KEY_INVALID' | 'REDIS_TTL_INVALID' | 'REDIS_QUEUE_PAYLOAD_INVALID';

export class InfraError extends Error {
  constructor(
    readonly code: InfraErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InfraError';
  }
}

/**
 * Redis 后端功能被请求，但当前没有可用的 Redis（未配置 `REDIS_URL`）。
 *
 * 这是「按需失败」：应用启动不受影响，只有真正调用缓存 / 锁 / 队列时才抛错，
 * 绝不静默降级假装成功。
 */
export class RedisUnavailableError extends InfraError {
  constructor(message: string) {
    super('REDIS_UNAVAILABLE', message);
    this.name = 'RedisUnavailableError';
  }
}

/** 键名或键段非法（空、含分隔符 `/` 或 Redis 通配符等）。 */
export class RedisKeyError extends InfraError {
  constructor(message: string) {
    super('REDIS_KEY_INVALID', message);
    this.name = 'RedisKeyError';
  }
}

/** TTL 选项非法（非有限数或 <= 0）。 */
export class RedisTtlError extends InfraError {
  constructor(message: string) {
    super('REDIS_TTL_INVALID', message);
    this.name = 'RedisTtlError';
  }
}

/** 队列中的任务信封无法解析（脏数据）。 */
export class RedisQueuePayloadError extends InfraError {
  constructor(message: string) {
    super('REDIS_QUEUE_PAYLOAD_INVALID', message);
    this.name = 'RedisQueuePayloadError';
  }
}
