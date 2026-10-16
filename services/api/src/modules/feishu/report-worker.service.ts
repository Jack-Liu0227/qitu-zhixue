import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FeishuReportDocument } from '@qitu/contracts';
import { feishuReportDeliveries, type Database } from '@qitu/database';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { FeishuService } from './feishu.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';

export interface ReportDeliveryResult { status: 'sent' | 'already_sent' | 'retryable' | 'failed'; recipientCount: number; recipientHashes: readonly string[]; requestId?: string }
export interface ReportDeliveryStatus { idempotencyKey: string; status: string; recipientCount: number; requestId: string | null; attempts: number; lastError: string | null; updatedAt: string }

/** Idempotent asynchronous report sender. Queue adapters may call `deliver` from a worker. */
@Injectable()
export class FeishuReportWorker {
  // The in-memory fallback is only used when no database is configured (for local tests).
  private readonly completedFallback = new Set<string>();
  constructor(
    private readonly feishu: FeishuService,
    @Optional() private readonly outbox?: OutboxWriter,
    @Optional() @Inject(DATABASE_TOKEN) private readonly db: Database | null = null,
  ) {}

  /** Persist a delivery command transactionally; a queue consumer can call deliver later. */
  async enqueue(input: { idempotencyKey: string; assistantId?: string; report: FeishuReportDocument }): Promise<string> {
    const id = `${input.assistantId ?? 'feishu-reporting-assistant'}:${input.idempotencyKey}`;
    if (!this.outbox) return id;
    try {
      return await this.outbox.write({
        id,
        topic: 'feishu.report.send',
        payload: { idempotencyKey: input.idempotencyKey, assistantId: input.assistantId, report: input.report },
      });
    } catch (error) {
      // A duplicate outbox primary key is the first enqueue result, not a second send.
      if (error instanceof Error && /duplicate|unique|conflict/i.test(error.message)) return id;
      throw error;
    }
  }

  async listDeliveries(assistantId = 'feishu-reporting-assistant'): Promise<readonly ReportDeliveryStatus[]> {
    if (!this.db) throw new ServiceUnavailableException('Feishu delivery storage unavailable');
    const rows = await this.db.select({
      idempotencyKey: feishuReportDeliveries.idempotencyKey,
      status: feishuReportDeliveries.status,
      recipientHashes: feishuReportDeliveries.recipientHashes,
      requestId: feishuReportDeliveries.requestId,
      attempts: feishuReportDeliveries.attempts,
      lastError: feishuReportDeliveries.lastError,
      updatedAt: feishuReportDeliveries.updatedAt,
    }).from(feishuReportDeliveries)
      .where(eq(feishuReportDeliveries.assistantId, assistantId))
      .orderBy(desc(feishuReportDeliveries.updatedAt))
      .limit(50);
    return rows.map((row) => ({
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      recipientCount: row.recipientHashes.length,
      requestId: row.requestId,
      attempts: row.attempts,
      lastError: row.lastError,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async deliver(input: { idempotencyKey: string; assistantId?: string; report: FeishuReportDocument }): Promise<ReportDeliveryResult> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 160) throw new ServiceUnavailableException('Invalid report idempotency key');
    const assistantId = input.assistantId ?? 'feishu-reporting-assistant';
    const key = `${assistantId}:${input.idempotencyKey}`;
    const hashes = (await this.feishu.getRecipientHashes(assistantId)).map((value) => createHash('sha256').update(value).digest('hex').slice(0, 16));
    const durable = this.db ? await this.claimDurableDelivery(assistantId, input.idempotencyKey, hashes) : null;
    if (durable?.status === 'sent') return { status: 'already_sent', recipientCount: hashes.length, recipientHashes: hashes, requestId: durable.requestId ?? undefined };
    if (durable?.status === 'sending') return { status: 'retryable', recipientCount: hashes.length, recipientHashes: hashes };
    if (!this.db && this.completedFallback.has(key)) return { status: 'already_sent', recipientCount: hashes.length, recipientHashes: hashes };
    if (!hashes.length) {
      await this.finishDurableDelivery(assistantId, input.idempotencyKey, 'failed', undefined, 'no recipients configured');
      return { status: 'failed', recipientCount: 0, recipientHashes: [] };
    }
    try {
      const result = await this.feishu.sendReport(input.report, assistantId);
      if (this.db) await this.finishDurableDelivery(assistantId, input.idempotencyKey, 'sent', result.requestId);
      else this.completedFallback.add(key);
      return { status: 'sent', recipientCount: hashes.length, recipientHashes: hashes, requestId: result.requestId };
    } catch (error) {
      const retryable = error instanceof Error && /timeout|network|429|unavailable/i.test(error.message);
      await this.finishDurableDelivery(assistantId, input.idempotencyKey, retryable ? 'retryable' : 'failed', undefined, error instanceof Error ? error.message : String(error));
      return { status: retryable ? 'retryable' : 'failed', recipientCount: hashes.length, recipientHashes: hashes };
    }
  }

  /** Claim a durable row before the external side effect; this survives worker restarts. */
  private async claimDurableDelivery(assistantId: string, idempotencyKey: string, recipientHashes: readonly string[]) {
    if (!this.db) return null;
    const id = `${assistantId}:${idempotencyKey}`;
    await this.db.insert(feishuReportDeliveries).values({
      id,
      assistantId,
      idempotencyKey,
      status: 'pending',
      recipientHashes: [...recipientHashes],
      updatedAt: new Date(),
    }).onConflictDoNothing();
    const [existing] = await this.db.select().from(feishuReportDeliveries)
      .where(and(eq(feishuReportDeliveries.assistantId, assistantId), eq(feishuReportDeliveries.idempotencyKey, idempotencyKey))).limit(1);
    if (!existing) throw new ServiceUnavailableException('Feishu delivery idempotency record unavailable');
    if (existing.status === 'sent' || existing.status === 'sending') return existing;
    const [claimed] = await this.db.update(feishuReportDeliveries)
      .set({ status: 'sending', recipientHashes: [...recipientHashes], attempts: existing.attempts + 1, updatedAt: new Date() })
      .where(and(eq(feishuReportDeliveries.id, existing.id), eq(feishuReportDeliveries.status, existing.status)))
      .returning();
    return claimed ?? existing;
  }

  private async finishDurableDelivery(assistantId: string, idempotencyKey: string, status: 'sent' | 'retryable' | 'failed', requestId?: string, lastError?: string): Promise<void> {
    if (!this.db) return;
    const safeError = lastError?.replace(/(token|secret|password|authorization|cookie)(\s*[:=]\s*)[^\s,;"']+/gi, '$1$2[REDACTED]').slice(0, 500) ?? null;
    await this.db.update(feishuReportDeliveries)
      .set({ status, requestId: requestId ?? null, lastError: safeError, sentAt: status === 'sent' ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(feishuReportDeliveries.assistantId, assistantId), eq(feishuReportDeliveries.idempotencyKey, idempotencyKey)));
  }
}
