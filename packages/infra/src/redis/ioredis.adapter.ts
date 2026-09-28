import { Redis } from 'ioredis';
import type { RedisAdapter, RedisSetOptions } from './types';

/**
 * 原子「比较后删除」Lua 脚本。
 *
 * `GET` 与 `DEL` 必须原子完成，否则锁过期后旧持有者仍可能删掉新持有者的锁。
 */
const DELETE_IF_VALUE_MATCHES = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

/** 真实 Redis 适配器（基于 ioredis）。 */
export class IoredisAdapter implements RedisAdapter {
  readonly kind = 'redis' as const;

  private readonly client: Redis;

  constructor(
    url: string,
    options: { connectTimeoutMs?: number; maxRetriesPerRequest?: number } = {},
  ) {
    if (url.trim() === '') {
      throw new Error('IoredisAdapter 需要非空的 REDIS_URL。');
    }
    this.client = new Redis(url, {
      // 延迟连接：没有 Redis 时应用也能启动；首次命令触发连接。
      lazyConnect: true,
      connectTimeout: options.connectTimeoutMs ?? 5_000,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 1,
      // 收集 error 事件，避免未处理的 error 让进程崩溃。
      enableOfflineQueue: true,
    });
    this.client.on('error', (error: Error) => {
      console.warn(`[IoredisAdapter] Redis 连接错误：${error.message}`);
    });
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<'OK' | null> {
    const ttlMs = options.ttlMs;
    if (ttlMs !== undefined) {
      return options.onlyIfAbsent
        ? this.client.set(key, value, 'PX', ttlMs, 'NX')
        : this.client.set(key, value, 'PX', ttlMs);
    }
    return options.onlyIfAbsent ? this.client.set(key, value, 'NX') : this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async deleteIfValueMatches(key: string, expected: string): Promise<boolean> {
    const result = await this.client.eval(DELETE_IF_VALUE_MATCHES, 1, key, expected);
    return Number(result) > 0;
  }

  async push(key: string, value: string): Promise<number> {
    return this.client.rpush(key, value);
  }

  async pop(key: string): Promise<string | null> {
    return this.client.lpop(key);
  }

  async move(from: string, to: string): Promise<string | null> {
    const moved = await this.client.rpoplpush(from, to);
    return moved ?? null;
  }

  async remove(key: string, value: string, count = 1): Promise<number> {
    return this.client.lrem(key, count, value);
  }

  async listLength(key: string): Promise<number> {
    return this.client.llen(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async quit(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }
    if (this.client.status === 'wait') {
      this.client.disconnect();
      return;
    }
    try {
      await this.client.quit();
    } catch (error) {
      console.warn(`[IoredisAdapter] Redis quit 失败，强制断开：${(error as Error).message}`);
      this.client.disconnect();
    }
  }
}
