import type { Role } from '@qitu/contracts';
import { redactSensitive } from './audit-redaction';

/**
 * 一条审计记录的业务入参。
 *
 * 字段与 `audit_logs` 表的映射（**不新增列、不改 schema**）：
 *
 * | AuditEntry 字段        | audit_logs 列         |
 * |------------------------|-----------------------|
 * | `actorId`              | `actor_id`            |
 * | `action`               | `action`              |
 * | `targetType`           | `target_type`         |
 * | `targetId`             | `target_id`           |
 * | `detail` + 上下文       | `detail`（JSONB）     |
 * | `idempotencyKey`       | `idempotency_key`     |
 *
 * `id` 与 `at` 由写入层生成：`id` 用 `randomUUID()`，`at` 走数据库默认值。
 *
 * `actorRole` / `reason` / `requestId` / `ip` 在表里没有独立列，统一放进
 * `detail` 的上下文区（见 `buildAuditDetail`），并且**整体递归脱敏**。
 */
export interface AuditEntry {
  /** 主体 ID；系统动作可为 `null`。 */
  actorId?: string | null;
  /** 主体角色；无独立列，落 `detail.actorRole`。 */
  actorRole?: Role | null;
  /** 动作标识，例如 `mentor.assign`、`admin.model.update`。 */
  action: string;
  /** 目标对象类型，例如 `student`、`model_provider`。 */
  targetType: string;
  /** 目标对象 ID；批量/全局动作可为 `null`。 */
  targetId?: string | null;
  /** 关联的幂等键（存在唯一索引）；无幂等语义时为 `null`。 */
  idempotencyKey?: string | null;
  /** 操作原因（敏感访问审批等场景必填）。 */
  reason?: string | null;
  /** 链路请求 ID，便于把一次请求的多条审计串起来。 */
  requestId?: string | null;
  /** 请求来源 IP（已由网关/调用方提取，避免在本层解析）。 */
  ip?: string | null;
  /** 业务附加信息；写入前会被 `redactSensitive` 递归脱敏。 */
  detail?: Record<string, unknown> | null;
}

/**
 * 把 `AuditEntry` 折叠成 `audit_logs.detail` 的 JSONB 值。
 *
 * 规则：
 * 1. 业务 `detail` 作为基底；
 * 2. `actorRole` / `reason` / `requestId` / `ip` 作为上下文覆盖同名键
 *    （上下文由审计层掌握，优先级高于调用方随手塞的同名字段）；
 * 3. 最后对**整个对象**递归脱敏，确保任一层级的凭据都不会落库。
 *
 * 纯函数，可直接单测。
 */
export function buildAuditDetail(entry: AuditEntry): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (entry.actorRole != null) context.actorRole = entry.actorRole;
  if (entry.reason != null) context.reason = entry.reason;
  if (entry.requestId != null) context.requestId = entry.requestId;
  if (entry.ip != null) context.ip = entry.ip;

  const merged: Record<string, unknown> = {
    ...(entry.detail ?? {}),
    ...context,
  };
  return redactSensitive(merged);
}
