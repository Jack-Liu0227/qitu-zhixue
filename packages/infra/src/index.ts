/**
 * `@qitu/infra`：启途智学共享基础设施（Redis / 队列）。
 *
 * 设计原则：
 * - **纯核心 + 薄适配**：缓存 / 锁 / 队列逻辑不依赖 Nest，便于服务与 worker 复用；
 * - **按需失败**：缺 `REDIS_URL` 时 live 模式不阻断启动，只在请求能力时抛错；
 * - **诚实降级**：demo/test 缺配置时使用显式 no-op，不假装有锁 / 有队列。
 */
export * from './errors';
export * from './keys';
export * from './redis/types';
export * from './redis/noop.adapter';
export * from './redis/unavailable.adapter';
export * from './redis/ioredis.adapter';
export * from './redis/select';
export * from './cache/json-cache';
export * from './lock/distributed-lock';
export * from './queue/redis-queue';
