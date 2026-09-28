import { randomUUID } from 'node:crypto';
import { RedisQueuePayloadError } from '../errors';
import type { RedisAdapter } from '../redis/types';

/** 队列中的任务信封（JSON 序列化后入队）。 */
export interface QueueJob<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  /** 已尝试次数（首次 enqueue 为 0）。 */
  attempts: number;
  /** 达到该次数后进入死信列表。 */
  maxAttempts: number;
  /** ISO 时间戳。 */
  enqueuedAt: string;
  /** 最近一次失败原因，便于运维观测。 */
  lastError?: string;
}

/** `reserve` 返回：解析后的任务 + 原始信封（用于精确 ack / fail）。 */
export interface ReservedQueueJob<T = unknown> {
  job: QueueJob<T>;
  raw: string;
}

export interface EnqueueQueueJobInput<T = unknown> {
  /** 已带作用域的队列键（不含 :pending 等后缀）。 */
  key: string;
  topic: string;
  payload: T;
  /** 稳定 id；重放同一 id 由消费方按业务幂等处理。缺省随机生成。 */
  id?: string;
  maxAttempts?: number;
}

export type QueueFailureOutcome = 'retried' | 'dead-lettered';

export interface RedisQueueDependencies {
  defaultMaxAttempts?: number;
  clock?: () => number;
}

/** 队列键的列表后缀。 */
const PENDING_SUFFIX = 'pending';
const PROCESSING_SUFFIX = 'processing';
const DEAD_SUFFIX = 'dead';

/**
 * 基于 Redis List 的轻量 at-least-once 队列，面向 outbox worker。
 *
 * 可靠性模型：
 * - 生产：`RPUSH pending`；
 * - 消费：`RPOPLPUSH pending processing` 原子取走，保证任务不丢（进程崩溃后仍
 *   留在 processing，人工 / 巡检可恢复）；
 * - 成功：从 processing `LREM` 删除（ack）；
 * - 失败：未达 `maxAttempts` 回 `pending` 重试，达到则进 `dead` 死信列表，
 *   失败可被运维观测而不是静默丢弃。
 *
 * 该抽象只负责「可靠搬运」，业务幂等仍由消费方（outbox / 领域服务）保证。
 */
export class RedisQueue {
  private readonly defaultMaxAttempts: number;
  private readonly clock: () => number;

  constructor(
    private readonly adapter: RedisAdapter,
    dependencies: RedisQueueDependencies = {},
  ) {
    this.defaultMaxAttempts = dependencies.defaultMaxAttempts ?? 5;
    this.clock = dependencies.clock ?? (() => Date.now());
  }

  async enqueue<T>(input: EnqueueQueueJobInput<T>): Promise<string> {
    const job: QueueJob<T> = {
      id: input.id ?? randomUUID(),
      topic: input.topic,
      payload: input.payload,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
      enqueuedAt: new Date(this.clock()).toISOString(),
    };
    await this.adapter.push(this.pendingKey(input.key), JSON.stringify(job));
    return job.id;
  }

  /** 原子取走一个任务；没有任务时返回 null。 */
  async reserve<T>(key: string): Promise<ReservedQueueJob<T> | null> {
    const raw = await this.adapter.move(this.pendingKey(key), this.processingKey(key));
    if (raw === null) {
      return null;
    }
    return { job: this.parseJob<T>(raw), raw };
  }

  /** 确认任务已处理完成；返回是否确实从 processing 中移除。 */
  async ack(key: string, reserved: ReservedQueueJob): Promise<boolean> {
    const removed = await this.adapter.remove(this.processingKey(key), reserved.raw, 1);
    return removed > 0;
  }

  /**
   * 记录一次失败：达到上限进死信，否则回 pending 重试。
   *
   * 返回 `retried` 或 `dead-lettered`，调用方可据此打点。
   */
  async fail(
    key: string,
    reserved: ReservedQueueJob,
    error: unknown,
  ): Promise<QueueFailureOutcome> {
    await this.adapter.remove(this.processingKey(key), reserved.raw, 1);
    const attempts = reserved.job.attempts + 1;
    const failedJob: QueueJob = {
      ...reserved.job,
      attempts,
      lastError: error instanceof Error ? error.message : String(error),
    };
    if (attempts >= reserved.job.maxAttempts) {
      await this.adapter.push(this.deadKey(key), JSON.stringify(failedJob));
      return 'dead-lettered';
    }
    await this.adapter.push(this.pendingKey(key), JSON.stringify(failedJob));
    return 'retried';
  }

  /** 待处理任务数。 */
  async depth(key: string): Promise<number> {
    return this.adapter.listLength(this.pendingKey(key));
  }

  /** 处理中任务数（用于观测卡住的任务）。 */
  async processingDepth(key: string): Promise<number> {
    return this.adapter.listLength(this.processingKey(key));
  }

  /** 死信任务数。 */
  async deadLetterDepth(key: string): Promise<number> {
    return this.adapter.listLength(this.deadKey(key));
  }

  private parseJob<T>(raw: string): QueueJob<T> {
    try {
      const job = JSON.parse(raw) as QueueJob<T>;
      if (typeof job?.id !== 'string' || typeof job?.topic !== 'string') {
        throw new Error('缺少 id / topic');
      }
      return job;
    } catch (error) {
      throw new RedisQueuePayloadError(`队列任务信封无法解析：${(error as Error).message}`);
    }
  }

  private pendingKey(key: string): string {
    return `${key}:${PENDING_SUFFIX}`;
  }
  private processingKey(key: string): string {
    return `${key}:${PROCESSING_SUFFIX}`;
  }
  private deadKey(key: string): string {
    return `${key}:${DEAD_SUFFIX}`;
  }
}
