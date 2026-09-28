import type { RedisAdapter, RedisSetOptions } from './types';

/**
 * 显式 no-op Redis 适配器。
 *
 * 使用场景：`demo` / `test` 数据模式下**没有配置 `REDIS_URL`**。此时后端仍然
 * 可以启动并服务，但 Redis 相关能力是「诚实不可用」而不是「假装成功」：
 * - 读一律 miss（`get`/`pop`/`move` 返回 null）；
 * - 写一律丢弃（`set`/`push`/`del` 不落任何数据）；
 * - **分布式锁永远获取失败**（`set NX` 返回 null），绝不假装持锁，避免在
 *   多副本部署中产生互相踩踏的假互斥。
 *
 * 需要「有真实语义」的环境（如集成测试）必须显式提供 `REDIS_URL`。
 */
export class NoopRedisAdapter implements RedisAdapter {
  readonly kind = 'noop' as const;

  async connect(): Promise<void> {
    // 无连接可建。
  }

  async get(_key: string): Promise<string | null> {
    return null;
  }

  async set(_key: string, _value: string, options?: RedisSetOptions): Promise<'OK' | null> {
    // 非 NX 的普通写入在 no-op 下视为成功（值被丢弃）；NX 永远失败——没有后端，
    // 不能声称「只有我拿到了锁」。
    return options?.onlyIfAbsent ? null : 'OK';
  }

  async del(_key: string): Promise<number> {
    return 0;
  }

  async deleteIfValueMatches(_key: string, _expected: string): Promise<boolean> {
    return false;
  }

  async push(_key: string, _value: string): Promise<number> {
    return 0;
  }

  async pop(_key: string): Promise<string | null> {
    return null;
  }

  async move(_from: string, _to: string): Promise<string | null> {
    return null;
  }

  async remove(_key: string, _value: string, _count?: number): Promise<number> {
    return 0;
  }

  async listLength(_key: string): Promise<number> {
    return 0;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<void> {
    // 无连接可释放。
  }
}
