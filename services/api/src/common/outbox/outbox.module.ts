import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { OutboxService, OutboxWriter } from './outbox.service';

/**
 * 全局事务性 outbox 模块。
 *
 * - `@Global()`：与 `AuditModule` / `IdempotencyModule` 一致，业务模块无需逐个
 *   import 即可注入 `OutboxWriter`；outbox 是横切能力，不能被业务页各自实现。
 * - 以抽象类 `OutboxWriter` 与具体类 `OutboxService` 提供**同一个实例**
 *   （`useExisting`），调用方可按语义选择注入令牌。
 *
 * 本模块只提供事件**写入 / 状态**能力：
 * - 不接线任何消费者（`services/workers` 仍是初始化桩，事件停留 `pending`）；
 * - 不实现投递、重试调度、通知投影；
 * - 不新增迁移：复用 `packages/database` 中已存在的 `outbox` 表。
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [OutboxService, { provide: OutboxWriter, useExisting: OutboxService }],
  exports: [OutboxService, OutboxWriter],
})
export class OutboxModule {}
