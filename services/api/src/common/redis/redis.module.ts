import { Global, Inject, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseModule, DATA_MODE_TOKEN, type DataMode } from '../../database';
import {
  REDIS_ADAPTER,
  REDIS_DISTRIBUTED_LOCK,
  REDIS_JSON_CACHE,
  REDIS_KEY_BUILDER,
  REDIS_RUNTIME,
} from './redis.constants';
import { createRedisRuntime, parsePositiveIntEnv, type RedisRuntime } from './redis.runtime';

/**
 * Redis 基础设施模块（全局）。
 *
 * 连接策略（与数据模式对齐，见 `DatabaseModule`）：
 * - 配置 `REDIS_URL`：使用真实 ioredis 适配器，生命周期在 `onModuleInit` 连接、
 *   `onModuleDestroy` 优雅 `quit`；连接失败只告警不阻断启动，首次命令会重试。
 * - **live 且未配置 `REDIS_URL`**：注入 `UnavailableRedisAdapter`，启动正常，
 *   **只有请求缓存 / 锁 / 队列能力时才 fail-fast 抛 `RedisUnavailableError`**。
 * - **demo / test 且未配置 `REDIS_URL`**：注入显式 `NoopRedisAdapter`，不假装成功。
 *
 * 环境变量在 provider 工厂（依赖注入阶段）读取，不在模块 import 时读取，便于单测。
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: REDIS_RUNTIME,
      useFactory: (mode: DataMode): RedisRuntime =>
        createRedisRuntime({
          url: process.env.REDIS_URL,
          mode,
          namespace: process.env.REDIS_KEY_PREFIX,
          defaultCacheTtlMs: parsePositiveIntEnv(process.env.REDIS_CACHE_TTL_MS),
          defaultLockTtlMs: parsePositiveIntEnv(process.env.REDIS_LOCK_TTL_MS),
        }),
      inject: [DATA_MODE_TOKEN],
    },
    {
      provide: REDIS_ADAPTER,
      useFactory: (rt: RedisRuntime) => rt.adapter,
      inject: [REDIS_RUNTIME],
    },
    {
      provide: REDIS_KEY_BUILDER,
      useFactory: (rt: RedisRuntime) => rt.keys,
      inject: [REDIS_RUNTIME],
    },
    {
      provide: REDIS_JSON_CACHE,
      useFactory: (rt: RedisRuntime) => rt.cache,
      inject: [REDIS_RUNTIME],
    },
    {
      provide: REDIS_DISTRIBUTED_LOCK,
      useFactory: (rt: RedisRuntime) => rt.lock,
      inject: [REDIS_RUNTIME],
    },
  ],
  exports: [
    REDIS_RUNTIME,
    REDIS_ADAPTER,
    REDIS_KEY_BUILDER,
    REDIS_JSON_CACHE,
    REDIS_DISTRIBUTED_LOCK,
  ],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_RUNTIME) private readonly runtime: RedisRuntime) {}

  async onModuleInit(): Promise<void> {
    if (this.runtime.adapter.kind === 'redis') {
      try {
        await this.runtime.adapter.connect();
        this.logger.log('Redis 客户端已连接。');
      } catch (error) {
        // 连接失败不阻断启动：保留应用可用性，首次命令会自动重试并由调用方感知。
        this.logger.warn(`Redis 连接失败，将在首次请求时重试：${(error as Error).message}`);
      }
      return;
    }
    if (this.runtime.adapter.kind === 'noop') {
      this.logger.warn(
        'REDIS_URL 未配置且为 demo/test 模式：Redis 能力使用显式 no-op（缓存不保存、锁不可获取）。',
      );
      return;
    }
    this.logger.warn(
      'REDIS_URL 未配置且为 live 模式：Redis 能力将在被请求时 fail-fast（不再静默降级）。',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime.adapter.quit();
  }
}
