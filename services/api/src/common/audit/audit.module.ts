import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditService, AuditWriter } from './audit.service';

/**
 * 全局审计模块。
 *
 * - `@Global()`：业务模块无需逐个 import 即可注入 `AuditWriter` / `AuditService`，
 *   符合「审计是横切能力、不能被业务页各自实现」的约束（ADR 0001 / 0002）。
 * - 同时以 `AuditWriter` 抽象类与 `AuditService` 具体类提供同一个实例
 *   （`useExisting`，不会创建第二个实例），调用方可按语义选择注入令牌。
 *
 * 本模块**只**提供写入基础：
 * - 不迁移任何现有控制器；
 * - 不实现幂等、outbox、审计查询接口；
 * - 不新增迁移或修改 `audit_logs` schema。
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService, { provide: AuditWriter, useExisting: AuditService }],
  exports: [AuditService, AuditWriter],
})
export class AuditModule {}
