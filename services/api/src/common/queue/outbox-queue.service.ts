import { Inject, Injectable } from '@nestjs/common';
import { RedisKeyError, RedisQueue } from '@qitu/infra';
import type { QueueFailureOutcome, ReservedQueueJob } from '@qitu/infra';
import { REDIS_RUNTIME } from '../redis/redis.constants';
import type { RedisRuntime } from '../redis/redis.runtime';

/** 队列作用域：可全局、按学校、或按学校 + 学生隔离。 */
export interface OutboxQueueScope {
  schoolId?: string;
  studentId?: string;
}

export interface OutboxQueueEnqueueInput<T = unknown> extends OutboxQueueScope {
  topic: string;
  payload: T;
  /** 稳定 id（由幂等指纹派生时，消费方按业务幂等处理重放）。 */
  id?: string;
  maxAttempts?: number;
}

/**
 * 面向 outbox worker 的队列门面。
 *
 * 只做「可靠搬运」，不实现消费者（`services/workers` 仍是初始化桩）。
 * 提供两种投递路径：
 * - 现有事务性 outbox 事件（Postgres）仍由 `OutboxWriter` 负责落库；
 * - 需要低延迟 / 非事务场景可经本队列投递，任务在 Redis List 中 at-least-once。
 *
 * 键按「全局 / 学校 / 学校 + 学生」作用域构造，避免跨租户串队列。学生作用域
 * 必须同时提供学校 id，否则拒绝（fail closed）。
 */
@Injectable()
export class OutboxQueue {
  private readonly queue: RedisQueue;

  constructor(@Inject(REDIS_RUNTIME) private readonly runtime: RedisRuntime) {
    this.queue = new RedisQueue(runtime.adapter);
  }

  async enqueue<T>(input: OutboxQueueEnqueueInput<T>): Promise<string> {
    return this.queue.enqueue({
      key: this.keyFor(input.topic, input),
      topic: input.topic,
      payload: input.payload,
      id: input.id,
      maxAttempts: input.maxAttempts,
    });
  }

  async reserve<T>(
    topic: string,
    scope: OutboxQueueScope = {},
  ): Promise<ReservedQueueJob<T> | null> {
    return this.queue.reserve<T>(this.keyFor(topic, scope));
  }

  async ack(topic: string, scope: OutboxQueueScope, reserved: ReservedQueueJob): Promise<boolean> {
    return this.queue.ack(this.keyFor(topic, scope), reserved);
  }

  async fail(
    topic: string,
    scope: OutboxQueueScope,
    reserved: ReservedQueueJob,
    error: unknown,
  ): Promise<QueueFailureOutcome> {
    return this.queue.fail(this.keyFor(topic, scope), reserved, error);
  }

  async depth(topic: string, scope: OutboxQueueScope = {}): Promise<number> {
    return this.queue.depth(this.keyFor(topic, scope));
  }

  /** 便于测试 / 观测：返回某个作用域下某 topic 的队列键。 */
  keyFor(topic: string, scope: OutboxQueueScope = {}): string {
    if (scope.studentId !== undefined && scope.studentId !== '') {
      if (scope.schoolId === undefined || scope.schoolId === '') {
        throw new RedisKeyError('学生作用域队列必须同时提供 schoolId，避免跨校串队列。');
      }
      return this.runtime.keys.student(scope.schoolId, scope.studentId, 'queue', 'outbox', topic);
    }
    if (scope.schoolId !== undefined && scope.schoolId !== '') {
      return this.runtime.keys.school(scope.schoolId, 'queue', 'outbox', topic);
    }
    return this.runtime.keys.global('queue', 'outbox', topic);
  }
}
