import { RedisTtlError } from '../errors';
import type { RedisAdapter } from '../redis/types';

export interface JsonCacheOptions {
  /** 未显式指定 `ttlMs` 时使用的默认 TTL（毫秒）。缺省表示不过期。 */
  defaultTtlMs?: number;
}

export interface JsonCacheSetOptions {
  /** 本次写入的 TTL（毫秒）；覆盖默认值。 */
  ttlMs?: number;
}

function assertValidTtl(ttlMs: number, label: string): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RedisTtlError(`${label} 必须是 > 0 的有限毫秒数，收到 ${ttlMs}。`);
  }
}

/**
 * JSON 缓存：把任意可序列化值以 JSON 字符串写入 Redis，支持 TTL。
 *
 * - 读取到脏 JSON 时按「缓存未命中」处理并顺手删除，避免脏数据反复命中；
 * - TTL 在写入前校验，非法值立即抛 `RedisTtlError`，不把错误 TTL 传给 Redis；
 * - `remember` 提供只读回源 + 回填的常用模式。
 */
export class JsonCache {
  constructor(
    private readonly adapter: RedisAdapter,
    private readonly options: JsonCacheOptions = {},
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.adapter.get(key);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.adapter.del(key);
      return null;
    }
  }

  async set<T>(key: string, value: T, options: JsonCacheSetOptions = {}): Promise<void> {
    const ttlMs = options.ttlMs ?? this.options.defaultTtlMs;
    if (ttlMs !== undefined) {
      assertValidTtl(ttlMs, '缓存 TTL');
    }
    const payload = JSON.stringify(value) ?? 'null';
    await this.adapter.set(key, payload, ttlMs !== undefined ? { ttlMs } : undefined);
  }

  async delete(key: string): Promise<boolean> {
    return (await this.adapter.del(key)) > 0;
  }

  /** 读取缓存；未命中时调用 `factory` 计算并回填（回填使用 `options.ttlMs`）。 */
  async remember<T>(
    key: string,
    factory: () => Promise<T> | T,
    options: JsonCacheSetOptions = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const value = await factory();
    await this.set(key, value, options);
    return value;
  }
}
