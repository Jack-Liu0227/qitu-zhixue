/** 适配器类别：真实连接 / 显式 no-op（demo/test）/ 不可用（live 但未配置）。 */
export type RedisAdapterKind = 'redis' | 'noop' | 'unavailable';

/** `set` 的可选参数。 */
export interface RedisSetOptions {
  /** TTL（毫秒），对应 Redis `PX`。 */
  ttlMs?: number;
  /** 仅当键不存在时写入，对应 Redis `SET ... NX`。 */
  onlyIfAbsent?: boolean;
}

/**
 * 缓存 / 锁 / 队列所需的最小 Redis 命令面。
 *
 * 之所以先定义这个窄接口，而不是直接依赖 ioredis 实例：
 * - 单测可用内存假实现覆盖锁失败 / 释放、TTL 透传、no-op 行为，无需真实 Redis；
 * - 未来若替换客户端库，只改一个适配器实现。
 */
export interface RedisAdapter {
  readonly kind: RedisAdapterKind;

  /** 建立连接（幂等）。真实适配器为延迟连接，首次命令也会自动连接。 */
  connect(): Promise<void>;

  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<'OK' | null>;
  del(key: string): Promise<number>;

  /** 原子「比较后删除」：仅当值为 `expected` 时删除，用于安全释放锁。 */
  deleteIfValueMatches(key: string, expected: string): Promise<boolean>;

  /** 从列表尾部推入（生产者）。 */
  push(key: string, value: string): Promise<number>;
  /** 从列表头部弹出（消费者），空列表返回 null。 */
  pop(key: string): Promise<string | null>;
  /** 原子地把 `from` 尾部元素移到 `to` 头部；空列表返回 null。 */
  move(from: string, to: string): Promise<string | null>;
  /** 从列表中删除元素，返回删除数量。 */
  remove(key: string, value: string, count?: number): Promise<number>;
  /** 列表长度。 */
  listLength(key: string): Promise<number>;

  /** 健康探针。 */
  ping(): Promise<string>;
  /** 释放连接（幂等），用于应用优雅关闭。 */
  quit(): Promise<void>;
}
