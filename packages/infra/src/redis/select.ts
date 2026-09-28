import { NoopRedisAdapter } from './noop.adapter';
import { IoredisAdapter } from './ioredis.adapter';
import { UnavailableRedisAdapter } from './unavailable.adapter';
import type { RedisAdapter } from './types';

/** 与 `DatabaseModule` 的 `DataMode` 对齐的运行时模式。 */
export type RedisRuntimeMode = 'live' | 'demo' | 'test';

export interface RedisAdapterConfig {
  /** `REDIS_URL`；为空表示未配置。 */
  url?: string | null;
  /** 当前数据模式（`QITU_DATA_MODE`）。 */
  mode: RedisRuntimeMode;
  /** ioredis 连接参数（仅真实适配器使用）。 */
  connectTimeoutMs?: number;
  maxRetriesPerRequest?: number;
}

/**
 * 纯函数：根据「是否配置 REDIS_URL + 数据模式」选择适配器。
 *
 * | REDIS_URL | live | demo / test |
 * |-----------|------|-------------|
 * | 有        | 真实 ioredis 适配器 | 真实 ioredis 适配器 |
 * | 无        | `UnavailableRedisAdapter`（按需 fail-fast） | `NoopRedisAdapter`（显式 no-op） |
 *
 * 注意：这里**不建立连接**，只构造对象；因此缺少 Redis 不会导致启动失败。
 */
export function selectRedisAdapter(config: RedisAdapterConfig): RedisAdapter {
  const url = (config.url ?? '').trim();
  if (url !== '') {
    return new IoredisAdapter(url, {
      connectTimeoutMs: config.connectTimeoutMs,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
    });
  }
  if (config.mode === 'live') {
    return new UnavailableRedisAdapter('REDIS_URL 未配置');
  }
  return new NoopRedisAdapter();
}
