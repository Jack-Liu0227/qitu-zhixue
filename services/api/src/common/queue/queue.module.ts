import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { OutboxQueue } from './outbox-queue.service';

/**
 * outbox 队列模块（全局）。
 *
 * 只提供「投递 / 领取 / 确认 / 失败」的队列门面；**不接线消费者**——
 * `services/workers` 仍是初始化桩，真正的消费与重试调度由后续切片实现。
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [OutboxQueue],
  exports: [OutboxQueue],
})
export class QueueModule {}
