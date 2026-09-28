/**
 * Redis 相关的 Nest 依赖注入令牌。
 *
 * 与 `OutboxWriter` 的模式一致：调用方按语义注入抽象（缓存 / 锁），而不是
 * 直接拿到底层客户端；这样单测与服务实现解耦。
 */
export const REDIS_RUNTIME = Symbol('REDIS_RUNTIME');
export const REDIS_ADAPTER = Symbol('REDIS_ADAPTER');
export const REDIS_KEY_BUILDER = Symbol('REDIS_KEY_BUILDER');
export const REDIS_JSON_CACHE = Symbol('REDIS_JSON_CACHE');
export const REDIS_DISTRIBUTED_LOCK = Symbol('REDIS_DISTRIBUTED_LOCK');
