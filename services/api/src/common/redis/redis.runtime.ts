import {
  DistributedLock,
  JsonCache,
  RedisKeyBuilder,
  selectRedisAdapter,
  type RedisAdapter,
  type RedisRuntimeMode,
} from '@qitu/infra';

export interface RedisRuntimeConfig {
  /** `REDIS_URL`；为空表示未配置。 */
  url?: string | null;
  /** 数据模式，复用 `QITU_DATA_MODE`（live | demo | test）。 */
  mode: RedisRuntimeMode;
  /** 键前缀，来自 `REDIS_KEY_PREFIX`；缺省 `qitu`。 */
  namespace?: string | null;
  /** 默认缓存 TTL（毫秒），来自 `REDIS_CACHE_TTL_MS`。 */
  defaultCacheTtlMs?: number;
  /** 默认锁 TTL（毫秒），来自 `REDIS_LOCK_TTL_MS`。 */
  defaultLockTtlMs?: number;
}

export interface RedisRuntime {
  adapter: RedisAdapter;
  keys: RedisKeyBuilder;
  cache: JsonCache;
  lock: DistributedLock;
}

/** 解析正整数的环境变量；非法 / 缺失返回 undefined（走库内默认）。 */
export function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * 纯函数：把配置组装成运行时对象（不建立连接）。
 *
 * 与 `resolveDatabaseBinding` 同样是「依赖注入阶段」的纯逻辑，便于单测覆盖
 * 三种模式：有 URL（真实）/ live 无 URL（按需失败）/ demo·test 无 URL（no-op）。
 */
export function createRedisRuntime(config: RedisRuntimeConfig): RedisRuntime {
  const namespace = (config.namespace ?? '').trim();
  const adapter = selectRedisAdapter({ url: config.url, mode: config.mode });
  const keys = new RedisKeyBuilder(namespace === '' ? undefined : namespace);
  const cache = new JsonCache(
    adapter,
    config.defaultCacheTtlMs !== undefined && config.defaultCacheTtlMs > 0
      ? { defaultTtlMs: config.defaultCacheTtlMs }
      : {},
  );
  const lock = new DistributedLock(
    adapter,
    config.defaultLockTtlMs !== undefined && config.defaultLockTtlMs > 0
      ? { defaultTtlMs: config.defaultLockTtlMs }
      : {},
  );
  return { adapter, keys, cache, lock };
}
