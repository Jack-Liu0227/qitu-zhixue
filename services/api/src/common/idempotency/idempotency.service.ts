import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, lte, ne, or } from 'drizzle-orm';
import { idempotencyKeys, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { redactSensitive } from '../audit/audit-redaction';
import { decideIdempotencyAction } from './idempotency.decision';
import { IdempotencyError } from './idempotency.errors';
import type {
  IdempotencyExecuteOptions,
  IdempotencyResult,
  IdempotencyStatus,
  IdempotentHandler,
} from './idempotency.types';

/** 默认保留期：完成后记录保留 24h，之后可被 `cleanupExpired()` 清理。 */
export const DEFAULT_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 默认执行租约：`in_progress` 记录 60s 内不可被并发回收。
 *
 * 调用方若 handler 可能更慢（如外部模型调用），必须通过
 * `options.processingLeaseMs` 调大，否则慢请求可能被并发回收而双执行。
 */
export const DEFAULT_IDEMPOTENCY_PROCESSING_LEASE_MS = 60 * 1000;

/** 作为 Nest DI 稳定注入令牌的抽象接口。 */
export abstract class IdempotencyStore {
  /**
   * 以 `(scope, key)` 为幂等单元执行 `handler`：
   * - 首次请求执行 handler，并持久化 `response_status` / `response_body`；
   * - 同 key 同 `requestHash` 重放首次响应，**不重复执行** handler；
   * - 同 key 不同 `requestHash` 抛 `IDEMPOTENCY_CONFLICT`；
   * - 并发请求靠数据库唯一约束 + 条件更新保证只有一个执行者。
   */
  abstract execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    options?: IdempotencyExecuteOptions,
  ): Promise<IdempotencyResult<T>>;
}

/**
 * 持久化幂等写入服务。
 *
 * 关键设计（见 `README.md` 的「并发语义」）：
 * - **数据库是唯一真相**：认领 / 重放 / 回收全部走 `idempotency_keys` 的唯一索引
 *   与条件 `UPDATE`，不维护进程内 Map，因此多实例部署也成立。
 * - **无 `DATABASE_URL` 诚实失败**：抛 `ServiceUnavailableException`（503），
 *   **绝不**退回内存 pretending success。写操作宁可不可用，也不能重复执行。
 * - **响应体落库前递归脱敏**：复用 `audit-redaction` 的 `redactSensitive`，
 *   但**不写任何审计记录**（审计是 AuditService 的职责）。
 * - **不接线任何控制器**：本服务只提供基础能力，接入由业务模块按 README 指引进行。
 */
@Injectable()
export class IdempotencyService extends IdempotencyStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {
    super();
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().then((deleted) => {
        if (deleted > 0) this.logger.log(`expired idempotency records removed=${deleted}`);
      }).catch(() => this.logger.warn('idempotency cleanup failed; will retry on next interval'));
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    options: IdempotencyExecuteOptions = {},
  ): Promise<IdempotencyResult<T>> {
    assertIdempotencyInput(scope, key, requestHash);

    if (!this.db) {
      this.logger.error(
        `幂等执行被拒绝：DATABASE_URL 未配置，无法持久化幂等记录（scope=${scope}）。不会退回内存执行。`,
      );
      throw new ServiceUnavailableException(
        '幂等存储不可用：未配置 DATABASE_URL，写操作无法保证幂等',
      );
    }

    const db = this.db;
    const retentionMs = options.retentionMs ?? DEFAULT_IDEMPOTENCY_RETENTION_MS;
    const leaseMs = options.processingLeaseMs ?? DEFAULT_IDEMPOTENCY_PROCESSING_LEASE_MS;

    // 1) 尝试以唯一约束认领新 key。这一条是 autocommit 单语句，冲突方会阻塞到
    //    胜者提交后返回空数组，从而保证「同一 key 只有一个执行者」。
    if (await this.claim(db, scope, key, requestHash, leaseMs)) {
      return this.runHandler(db, scope, key, requestHash, handler, retentionMs, leaseMs);
    }

    // 2) 已存在记录：读取后做状态机判定。
    const existing = await this.load(db, scope, key);
    if (!existing) {
      // 极端竞态：认领失败后又查不到（被 cleanup 删掉）。重试一次认领。
      if (await this.claim(db, scope, key, requestHash, leaseMs)) {
        return this.runHandler(db, scope, key, requestHash, handler, retentionMs, leaseMs);
      }
      throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '幂等记录状态变化，请重试');
    }

    const decision = decideIdempotencyAction({
      storedRequestHash: existing.requestHash,
      storedStatus: existing.status as IdempotencyStatus,
      storedExpiresAt: existing.expiresAt,
      requestHash,
      now: new Date(),
    });

    if (decision === 'replay') {
      return {
        status: existing.responseStatus ?? 200,
        body: existing.responseBody as T,
        replayed: true,
      };
    }

    if (decision === 'conflict') {
      throw new IdempotencyError(
        'IDEMPOTENCY_CONFLICT',
        '相同 Idempotency-Key 已用于不同请求，或该请求正在处理中',
      );
    }

    // decision === 'reclaim'：条件更新保证只有一个回收者；失败者视为并发冲突。
    if (await this.reclaim(db, scope, key, requestHash, leaseMs)) {
      return this.runHandler(db, scope, key, requestHash, handler, retentionMs, leaseMs);
    }
    throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '该 Idempotency-Key 的请求正在处理中');
  }

  /**
   * 清理已过期的**终态**记录（`succeeded` / `failed`）。
   *
   * - 不清理 `in_progress`：它由租约回收处理，避免删除仍可能有 handler 在跑的记录；
   * - 返回删除行数，便于外部定时任务打点。
   */
  async cleanupExpired(now: Date = new Date()): Promise<number> {
    if (!this.db) {
      throw new ServiceUnavailableException(
        '幂等存储不可用：未配置 DATABASE_URL，无法清理过期幂等记录',
      );
    }
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(and(lte(idempotencyKeys.expiresAt, now), ne(idempotencyKeys.status, 'in_progress')))
      .returning({ id: idempotencyKeys.id });
    return deleted.length;
  }

  /* ==================== internals ==================== */

  /** 以 INSERT ... ON CONFLICT DO NOTHING 原子认领。返回是否认领成功。 */
  private async claim(
    db: Database,
    scope: string,
    key: string,
    requestHash: string,
    leaseMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const inserted = await db
      .insert(idempotencyKeys)
      .values({
        id: randomUUID(),
        scope,
        key,
        requestHash,
        status: 'in_progress',
        responseStatus: null,
        responseBody: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + leaseMs),
      })
      .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
      .returning({ id: idempotencyKeys.id });
    return inserted.length > 0;
  }

  private async load(db: Database, scope: string, key: string) {
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 原子回收：只允许同指纹、且「已失败」或「处理中但租约已过期」的记录被重新认领。
   *
   * 条件写在 `WHERE` 里而非先读后写，配合 Postgres 行锁，并发回收只有一个成功。
   */
  private async reclaim(
    db: Database,
    scope: string,
    key: string,
    requestHash: string,
    leaseMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const reclaimed = await db
      .update(idempotencyKeys)
      .set({
        status: 'in_progress',
        responseStatus: null,
        responseBody: null,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + leaseMs),
      })
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.requestHash, requestHash),
          or(
            eq(idempotencyKeys.status, 'failed'),
            and(eq(idempotencyKeys.status, 'in_progress'), lte(idempotencyKeys.expiresAt, now)),
          ),
        ),
      )
      .returning({ id: idempotencyKeys.id });
    return reclaimed.length > 0;
  }

  private async runHandler<T>(
    db: Database,
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    retentionMs: number,
    leaseMs: number,
  ): Promise<IdempotencyResult<T>> {
    let outcome: { status?: number; body: T };
    try {
      outcome = await handler();
    } catch (error) {
      await this.markFailed(db, scope, key, requestHash, error, retentionMs);
      throw error;
    }

    const status = outcome?.status ?? 200;
    // 落库前递归脱敏：apiKey / password / token 等绝不进入 response_body。
    const body = redactSensitive(outcome?.body ?? null) as T;
    const recorded = await this.markSucceeded(
      db,
      scope,
      key,
      requestHash,
      status,
      body,
      retentionMs,
    );
    if (!recorded) {
      // 租约已过期且被并发回收，本次结果未写回。副作用已发生，这里只告警不抛错。
      this.logger.warn(
        `幂等结果未能写回：处理租约已过期并被回收（scope=${scope}）。请调大 processingLeaseMs 或缩短 handler。`,
      );
    }
    return { status, body, replayed: false };
  }

  private async markSucceeded<T>(
    db: Database,
    scope: string,
    key: string,
    requestHash: string,
    status: number,
    body: T,
    retentionMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await db
      .update(idempotencyKeys)
      .set({
        status: 'succeeded',
        responseStatus: status,
        responseBody: body,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + retentionMs),
      })
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.requestHash, requestHash),
          eq(idempotencyKeys.status, 'in_progress'),
        ),
      )
      .returning({ id: idempotencyKeys.id });
    return updated.length > 0;
  }

  private async markFailed(
    db: Database,
    scope: string,
    key: string,
    requestHash: string,
    error: unknown,
    retentionMs: number,
  ): Promise<void> {
    const now = new Date();
    const rawMessage = error instanceof Error ? error.message : String(error);
    try {
      await db
        .update(idempotencyKeys)
        .set({
          status: 'failed',
          responseStatus: 500,
          // 错误信息同样脱敏后再落库，避免异常里夹带凭据。
          responseBody: { error: redactSensitive(rawMessage) },
          updatedAt: now,
          expiresAt: new Date(now.getTime() + retentionMs),
        })
        .where(
          and(
            eq(idempotencyKeys.scope, scope),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.requestHash, requestHash),
            eq(idempotencyKeys.status, 'in_progress'),
          ),
        );
    } catch (updateError) {
      // 失败写回不能再抛出，否则会盖掉真正的业务异常。
      this.logger.error(
        `幂等失败状态写回失败（scope=${scope}）：${updateError instanceof Error ? updateError.message : String(updateError)}`,
      );
    }
  }
}

/** 入参防御：这些错误应由控制器在解析 `Idempotency-Key` 时提前拦截。 */
function assertIdempotencyInput(scope: string, key: string, requestHash: string): void {
  if (!scope || scope.trim().length === 0) {
    throw new IdempotencyError('IDEMPOTENCY_KEY_REQUIRED', '幂等 scope 不能为空');
  }
  if (!key || key.trim().length === 0) {
    throw new IdempotencyError('IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
  }
  if (!requestHash || requestHash.trim().length === 0) {
    throw new IdempotencyError('IDEMPOTENCY_KEY_REQUIRED', 'requestHash 不能为空');
  }
}
