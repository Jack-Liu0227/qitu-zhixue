import { randomUUID } from 'node:crypto';
import { RedisTtlError } from '../errors';
import type { RedisAdapter } from '../redis/types';

/** 默认锁 TTL：30s。持锁超过 TTL 后自动释放，防止死锁。 */
export const DEFAULT_LOCK_TTL_MS = 30_000;

export interface DistributedLockOptions {
  /** 本次锁的 TTL（毫秒）。 */
  ttlMs?: number;
  /** 持有者令牌；默认随机生成，测试可注入固定值。 */
  token?: string;
}

export interface DistributedLockHandle {
  readonly key: string;
  readonly token: string;
  readonly expiresAt: number;
  /** 释放锁：仅当值仍等于自己的 token 时删除。重复释放返回 false。 */
  release(): Promise<boolean>;
}

export interface DistributedLockDependencies {
  defaultTtlMs?: number;
  clock?: () => number;
  tokenFactory?: () => string;
}

function assertValidTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RedisTtlError(`锁 TTL 必须是 > 0 的有限毫秒数，收到 ${ttlMs}。`);
  }
}

/**
 * 基于 Redis `SET key token PX ttl NX` 的分布式锁。
 *
 * - **互斥**：`NX` 保证同一时刻最多一个持有者；
 * - **自动过期**：`PX` 防止进程崩溃后死锁；
 * - **安全释放**：使用原子「比较后删除」，只有 token 匹配才删除，避免过期后
 *   误删新持有者的锁；
 * - **no-op 适配器下永不获取成功**，不会产生假互斥。
 */
export class DistributedLock {
  private readonly clock: () => number;
  private readonly tokenFactory: () => string;
  private readonly defaultTtlMs: number;

  constructor(
    private readonly adapter: RedisAdapter,
    dependencies: DistributedLockDependencies = {},
  ) {
    this.clock = dependencies.clock ?? (() => Date.now());
    this.tokenFactory = dependencies.tokenFactory ?? (() => randomUUID());
    this.defaultTtlMs = dependencies.defaultTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  /**
   * 尝试获取锁。成功返回句柄，失败（已被占用 / no-op）返回 null。
   *
   * 这里不抛「锁被占用」异常：锁竞争是正常控制流，调用方自行决定重试或跳过。
   */
  async acquire(
    key: string,
    options: DistributedLockOptions = {},
  ): Promise<DistributedLockHandle | null> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    assertValidTtl(ttlMs);
    const token = options.token ?? this.tokenFactory();
    const result = await this.adapter.set(key, token, { onlyIfAbsent: true, ttlMs });
    if (result !== 'OK') {
      return null;
    }

    let released = false;
    const adapter = this.adapter;
    return {
      key,
      token,
      expiresAt: this.clock() + ttlMs,
      async release(): Promise<boolean> {
        if (released) {
          return false;
        }
        released = true;
        return adapter.deleteIfValueMatches(key, token);
      },
    };
  }

  /**
   * 获取锁后执行 `task`，结束时无论成功失败都释放。
   *
   * 获取不到锁时返回 null，不执行任务。
   */
  async withLock<T>(
    key: string,
    task: () => Promise<T> | T,
    options: DistributedLockOptions = {},
  ): Promise<T | null> {
    const handle = await this.acquire(key, options);
    if (handle === null) {
      return null;
    }
    try {
      return await task();
    } finally {
      await handle.release();
    }
  }
}
