import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IdempotencyService, IdempotencyStore } from './idempotency.service';

/**
 * 全局幂等基础模块。
 *
 * - `@Global()`：业务模块无需逐个 import 即可注入 `IdempotencyStore` /
 *   `IdempotencyService`，与 AccessModule / AuditModule 的横切能力定位一致。
 * - 以抽象类 `IdempotencyStore` 与具体类 `IdempotencyService` 提供**同一个实例**
 *   （`useExisting`），调用方可按语义选择注入令牌。
 *
 * 本模块**只**提供基础能力：
 * - 不迁移任何现有控制器（parent / directory-admin / teacher 的写接口保持原样）；
 * - 不实现 outbox、审计查询、定时清理调度；
 * - 不新增迁移、不修改 `idempotency_keys` schema。
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [IdempotencyService, { provide: IdempotencyStore, useExisting: IdempotencyService }],
  exports: [IdempotencyService, IdempotencyStore],
})
export class IdempotencyModule {}
