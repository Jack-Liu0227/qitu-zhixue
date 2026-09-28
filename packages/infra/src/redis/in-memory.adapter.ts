import type { RedisAdapter, RedisAdapterKind, RedisSetOptions } from './types';

interface Entry {
  value: string;
  expiresAt: number | null;
}

export interface SetCall {
  key: string;
  value: string;
  options?: RedisSetOptions;
}

/**
 * 内存版 Redis 适配器，仅供单测使用（不导出到公共 API）。
 *
 * 覆盖本包需要的命令子集：字符串读写 / NX / PX TTL、列表 push/pop/move/remove/len、
 * 原子比较删除。`clock` 可注入以便测试 TTL 过期而无需真的等待。
 */
export class InMemoryRedisAdapter implements RedisAdapter {
  readonly kind: RedisAdapterKind = 'redis';

  private readonly strings = new Map<string, Entry>();
  private readonly lists = new Map<string, string[]>();
  private now: number;

  /** 记录每次 `set` 的入参，供 TTL 透传断言。 */
  readonly setCalls: SetCall[] = [];

  constructor(clock: () => number = () => Date.now()) {
    this.now = clock();
  }

  advanceClock(ms: number): void {
    this.now += ms;
  }

  async connect(): Promise<void> {}
  async quit(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, options?: RedisSetOptions): Promise<'OK' | null> {
    this.setCalls.push({ key, value, options });
    const resolved = options ?? {};
    const existing = await this.get(key);
    if (resolved.onlyIfAbsent && existing !== null) {
      return null;
    }
    this.strings.set(key, {
      value,
      expiresAt: resolved.ttlMs !== undefined ? this.now + resolved.ttlMs : null,
    });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.strings.delete(key) ? 1 : 0;
  }

  async deleteIfValueMatches(key: string, expected: string): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== expected) {
      return false;
    }
    this.strings.delete(key);
    return true;
  }

  async push(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async pop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) {
      return null;
    }
    const value = list.shift() ?? null;
    if (list.length === 0) {
      this.lists.delete(key);
    }
    return value;
  }

  async move(from: string, to: string): Promise<string | null> {
    const value = await this.pop(from);
    if (value === null) {
      return null;
    }
    await this.push(to, value);
    return value;
  }

  async remove(key: string, value: string, count = 1): Promise<number> {
    const list = this.lists.get(key);
    if (!list) {
      return 0;
    }
    let removed = 0;
    for (let index = 0; index < list.length && removed < count;) {
      if (list[index] === value) {
        list.splice(index, 1);
        removed += 1;
      } else {
        index += 1;
      }
    }
    if (list.length === 0) {
      this.lists.delete(key);
    }
    return removed;
  }

  async listLength(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}
