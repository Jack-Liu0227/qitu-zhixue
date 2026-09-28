import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { outbox, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { redactSensitive } from '../audit/audit-redaction';
import type { AuditTransaction } from '../audit/audit.service';
import {
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEventInput,
  type OutboxStatus,
} from './outbox.types';

/**
 * outbox 的事务句柄类型。与审计层共用（`AuditService` 的 `write(entry, tx)`），
 * 因为「业务写入 + 审计 + 通知事件」必须在同一个事务里。
 */
export type OutboxTransaction = AuditTransaction;

/** 一条 outbox 行的落库字段（纯数据）。 */
export interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
}

/**
 * 组装一条**初始** outbox 行。
 *
 * 纯函数，便于单测「新事件一定是 pending / attempts=0 / lastError=null」，
 * 也保证 payload 在写入前被递归脱敏。
 */
export function buildOutboxRow(event: OutboxEventInput): OutboxRow {
  return {
    id: event.id,
    topic: event.topic,
    payload: redactSensitive(event.payload ?? {}),
    status: 'pending',
    attempts: 0,
    lastError: null,
  };
}

/** 一次失败后的重试判定结果。 */
export interface OutboxFailureDecision {
  /** `pending`（仍可重试）或 `failed`（终态）。 */
  status: Extract<OutboxStatus, 'pending' | 'failed'>;
  /** 累计尝试次数（本次失败已计入）。 */
  attempts: number;
  /** 脱敏后的失败原因，落 `outbox.last_error`，便于观测。 */
  lastError: string;
}

/**
 * 在错误消息里抹掉 `token=...` / `password: ...` 这类明文凭据。
 *
 * 审计的 `redactSensitive` 只按**键名**脱敏；而投递失败信息是一整条字符串，
 * SMTP / HTTP 错误里可能内联 `Authorization: Bearer ...` 或 `?token=...`。
 * `outbox.last_error` 会被运维查询，因此这里额外做一次值级擦除。
 */
const CREDENTIAL_IN_MESSAGE_PATTERN =
  /(token|password|passwd|pwd|secret|api[_-]?key|authorization|cookie|credential)(\s*[:=]\s*)([^\s,;"']+)/gi;

export function redactCredentialLike(message: string): string {
  return message.replace(
    CREDENTIAL_IN_MESSAGE_PATTERN,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
  );
}

/**
 * 纯函数：根据「此前的尝试次数 + 本次失败原因」决定事件是回到 `pending`
 * 等待重试，还是进入终态 `failed`。
 *
 * 这是「投递失败可观测」的落点：worker 每次失败都调用它，终态行可由运维直接
 * 查询 `outbox` 表观测，而不是静默丢弃。当前没有 worker，本函数只被单测覆盖。
 */
export function decideOutboxFailure(
  previousAttempts: number,
  error: unknown,
  maxAttempts: number = OUTBOX_MAX_ATTEMPTS,
): OutboxFailureDecision {
  const attempts = Math.max(0, previousAttempts) + 1;
  const raw = error instanceof Error ? error.message : String(error);
  return {
    status: attempts >= maxAttempts ? 'failed' : 'pending',
    attempts,
    lastError: redactCredentialLike(raw),
  };
}

/**
 * 事务性 outbox 的写入端口。
 *
 * 业务 store 注入本抽象；Postgres 实现把事件写进同一个业务事务。无数据库时
 * **诚实抛 503**，绝不写内存假装事件已产生。
 */
export abstract class OutboxWriter {
  /**
   * 写入一条 pending 事件，返回事件 id。
   *
   * @param event 事件入参（payload 落库前递归脱敏）
   * @param tx    可选事务句柄。**传入时优先使用**：事件必须和业务写入同事务，
   *              否则业务回滚后可能残留「幽灵通知」。
   */
  abstract write(event: OutboxEventInput, tx?: OutboxTransaction): Promise<string>;

  /** 标记事件已投递成功（供未来 worker 使用；当前无消费者）。 */
  abstract markPublished(id: string, at: Date): Promise<void>;

  /** 记录一次投递失败；达到上限时转为终态 `failed`。 */
  abstract markFailed(id: string, error: unknown): Promise<void>;
}

/**
 * 持久化 outbox 写入服务。
 *
 * - **无 DATABASE_URL 诚实失败**：抛 503，不退回内存假装成功。
 * - **事务句柄优先**：与业务写入共用事务。
 * - **payload 落库前递归脱敏**：避免异常字段夹带凭据。
 * - **不接线任何消费者**：本切片只保证事件可靠落库，投递由 `services/workers`
 *   未来实现；因此行会停留为 `pending`。
 */
@Injectable()
export class OutboxService extends OutboxWriter {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {
    super();
  }

  async write(event: OutboxEventInput, tx?: OutboxTransaction): Promise<string> {
    const executor = tx ?? this.db;
    if (!executor) {
      this.logger.error(
        `outbox 写入被拒绝：DATABASE_URL 未配置，事件无法持久化（topic=${event.topic}）。不会写内存假装成功。`,
      );
      throw new ServiceUnavailableException(
        '通知队列不可用：未配置 DATABASE_URL，事件无法持久化',
      );
    }
    const row = buildOutboxRow(event);
    await executor.insert(outbox).values(row);
    return row.id;
  }

  async markPublished(id: string, at: Date): Promise<void> {
    const executor = this.requireDb('markPublished');
    await executor
      .update(outbox)
      .set({ status: 'published', publishedAt: at, lastError: null })
      .where(eq(outbox.id, id));
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    const executor = this.requireDb('markFailed');
    const rows = await executor
      .select({ attempts: outbox.attempts })
      .from(outbox)
      .where(eq(outbox.id, id))
      .limit(1);
    const previous = rows[0]?.attempts ?? 0;
    const decision = decideOutboxFailure(previous, error);
    await executor
      .update(outbox)
      .set({ status: decision.status, attempts: decision.attempts, lastError: decision.lastError })
      .where(eq(outbox.id, id));
  }

  private requireDb(op: string): Database {
    if (!this.db) {
      this.logger.error(
        `outbox ${op} 被拒绝：DATABASE_URL 未配置，无法读写 outbox 表。`,
      );
      throw new ServiceUnavailableException('通知队列不可用：未配置 DATABASE_URL');
    }
    return this.db;
  }
}
