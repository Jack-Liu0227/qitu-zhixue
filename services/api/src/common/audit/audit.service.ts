import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { auditLogs, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import type { AuditEntry } from './audit-entry';
import { buildAuditDetail } from './audit-entry';

/**
 * Drizzle 事务句柄类型。
 *
 * 直接从 `withTransaction()` 的签名推导，避免在 `packages/database` 里新增导出
 * （本任务范围外）。业务层调用 `withTransaction(db, (tx) => ...)` 后把同一个
 * `tx` 透传给 `AuditWriter.write(entry, tx)`，即可让业务写入与审计写入落在
 * **同一个事务**里，不会出现「业务成功、审计丢失」的裂缝。
 */
export type AuditTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * 审计写入的抽象接口，作为 Nest DI 的稳定注入令牌。
 *
 * 业务模块应注入本类型（或 `AuditService`）而不是自己 insert `audit_logs`，
 * 保证脱敏、字段映射、事务优先只有一份实现。
 */
export abstract class AuditWriter {
  /**
   * 写入一条审计记录，返回生成的 `audit_logs.id`。
   *
   * @param entry 审计入参（写入前会被递归脱敏）
   * @param tx    可选事务句柄。**传入时优先使用**：审计与业务写入应共用同一个
   *              事务；不传时才退回连接池直写。
   */
  abstract write(entry: AuditEntry, tx?: AuditTransaction): Promise<string>;
}

/**
 * 持久化审计写入服务。
 *
 * 关键设计：
 * - **事务句柄优先**：`write(entry, tx)` 优先用调用方事务，避免业务与审计分离。
 * - **无 DATABASE_URL 时诚实失败**：不写内存、不静默吞掉，而是记录清晰告警并抛
 *   `ServiceUnavailableException`（503）。这样调用方不会误以为「审计已记录」。
 * - **敏感值不落库、不落日志**：detail 经 `redactSensitive` 递归脱敏；本服务的
 *   日志只包含 action / targetType 等非敏感元数据，绝不打印 entry 原文。
 */
@Injectable()
export class AuditService extends AuditWriter {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {
    super();
  }

  async write(entry: AuditEntry, tx?: AuditTransaction): Promise<string> {
    // 事务句柄优先：有 tx 用 tx，没有才退回池化连接。
    const executor: Database | AuditTransaction | null = tx ?? this.db;
    if (!executor) {
      // 明确的无数据库行为：不假装成功、不落内存。
      this.logger.error(
        `审计写入被拒绝：DATABASE_URL 未配置，无法持久化审计（action=${entry.action}, targetType=${entry.targetType}）。审计不会落入内存。`,
      );
      throw new ServiceUnavailableException(
        '审计存储不可用：未配置 DATABASE_URL，审计记录无法持久化',
      );
    }

    const id = randomUUID();
    const detail = buildAuditDetail(entry);

    await executor.insert(auditLogs).values({
      id,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      detail,
      idempotencyKey: entry.idempotencyKey ?? null,
    });

    return id;
  }
}
