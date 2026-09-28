import { RedisUnavailableError } from '../errors';
import type { RedisAdapter, RedisSetOptions } from './types';

/**
 * `live` 模式下未配置 `REDIS_URL` 时的适配器。
 *
 * 关键点：**应用启动不失败**（否则会拖垮不依赖 Redis 的既有接口与启动测试），
 * 只有真正请求 Redis 能力时才 fail-fast 抛 `RedisUnavailableError`。
 * `connect` / `quit` 保持静默，因为生命周期钩子不应因缺配置而阻断启动 / 关闭。
 */
export class UnavailableRedisAdapter implements RedisAdapter {
  readonly kind = 'unavailable' as const;

  constructor(private readonly reason = 'REDIS_URL 未配置') {}

  async connect(): Promise<void> {
    // 生命周期钩子保持静默，启动不因缺 Redis 失败。
  }

  async quit(): Promise<void> {
    // 同上。
  }

  async get(_key: string): Promise<never> {
    return this.fail('get');
  }
  async set(_key: string, _value: string, _options?: RedisSetOptions): Promise<never> {
    return this.fail('set');
  }
  async del(_key: string): Promise<never> {
    return this.fail('del');
  }
  async deleteIfValueMatches(_key: string, _expected: string): Promise<never> {
    return this.fail('deleteIfValueMatches');
  }
  async push(_key: string, _value: string): Promise<never> {
    return this.fail('push');
  }
  async pop(_key: string): Promise<never> {
    return this.fail('pop');
  }
  async move(_from: string, _to: string): Promise<never> {
    return this.fail('move');
  }
  async remove(_key: string, _value: string, _count?: number): Promise<never> {
    return this.fail('remove');
  }
  async listLength(_key: string): Promise<never> {
    return this.fail('listLength');
  }
  async ping(): Promise<never> {
    return this.fail('ping');
  }

  private fail(operation: string): never {
    throw new RedisUnavailableError(
      `Redis 功能不可用（${operation}）：${this.reason}。live 模式下 Redis 是必需依赖；` +
        `请配置 REDIS_URL，或使用显式的 demo/test 数据模式。` +
        ` Redis feature "${operation}" is unavailable because ${this.reason}.`,
    );
  }
}
