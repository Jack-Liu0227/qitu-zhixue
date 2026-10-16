import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FeishuReportDocument } from '@qitu/contracts';
import { FeishuService } from './feishu.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';

export interface ReportDeliveryResult { status: 'sent' | 'already_sent' | 'retryable' | 'failed'; recipientCount: number; recipientHashes: readonly string[]; requestId?: string }

/** Idempotent asynchronous report sender. Queue adapters may call `deliver` from a worker. */
@Injectable()
export class FeishuReportWorker {
  private readonly completed = new Set<string>();
  constructor(private readonly feishu: FeishuService, @Optional() private readonly outbox?: OutboxWriter) {}

  /** Persist a delivery command transactionally; a queue consumer can call deliver later. */
  async enqueue(input: { idempotencyKey: string; assistantId?: string; report: FeishuReportDocument }): Promise<string> {
    if (!this.outbox) return `${input.assistantId ?? 'feishu-reporting-assistant'}:${input.idempotencyKey}`;
    return this.outbox.write({
      id: `${input.assistantId ?? 'feishu-reporting-assistant'}:${input.idempotencyKey}`,
      topic: 'feishu.report.send',
      payload: { idempotencyKey: input.idempotencyKey, assistantId: input.assistantId, report: input.report },
    });
  }

  async deliver(input: { idempotencyKey: string; assistantId?: string; report: FeishuReportDocument }): Promise<ReportDeliveryResult> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 160) throw new ServiceUnavailableException('报告幂等键无效');
    const key = `${input.assistantId ?? 'feishu-reporting-assistant'}:${input.idempotencyKey}`;
    const hashes = (await this.feishu.getRecipientHashes(input.assistantId)).map((value) => createHash('sha256').update(value).digest('hex').slice(0, 16));
    if (this.completed.has(key)) return { status: 'already_sent', recipientCount: hashes.length, recipientHashes: hashes };
    if (!hashes.length) return { status: 'failed', recipientCount: 0, recipientHashes: [] };
    try {
      const result = await this.feishu.sendReport(input.report, input.assistantId);
      this.completed.add(key);
      return { status: 'sent', recipientCount: hashes.length, recipientHashes: hashes, requestId: result.requestId };
    } catch (error) {
      const retryable = error instanceof Error && /timeout|network|429|unavailable/i.test(error.message);
      return { status: retryable ? 'retryable' : 'failed', recipientCount: hashes.length, recipientHashes: hashes };
    }
  }
}

