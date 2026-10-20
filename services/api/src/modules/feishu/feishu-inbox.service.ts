import { ForbiddenException, HttpException, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { feishuBots, feishuInbox, withTransaction, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { FeishuService } from './feishu.service';
import { FeishuAssistantHandlers } from './feishu-assistant-handlers';
import { FeishuApiError, messageUuid, recipientHash } from './feishu-api';
import { parseInboundMessage } from './feishu-inbound';

const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;
type InboxRow = typeof feishuInbox.$inferSelect;

@Injectable()
export class FeishuInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeishuInboxService.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly feishu: FeishuService,
    private readonly handlers: FeishuAssistantHandlers,
    private readonly audit: AuditWriter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.drain().catch(() => this.logger.warn('Feishu inbox unavailable')); }, 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Await only validation and durable receipt before acknowledging the provider. */
  async receive(assistantId: string, appId: string, payload: unknown): Promise<boolean> {
    const message = parseInboundMessage(payload, appId);
    if (!message || !this.db) return false;
    const [bot] = await this.db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    if (!bot?.inboundEnabled || !bot.enabled || bot.appId !== appId) return false;
    const hash = recipientHash(message.senderOpenId);
    try { await this.feishu.resolveRecipientAdmin(assistantId, message.senderOpenId); }
    catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.audit.write({ actorId: null, actorRole: null, action: 'admin.feishu.message.rejected', targetType: 'admin_assistant', targetId: assistantId, detail: { senderHash: hash, reason: 'identity_not_authorized' } });
      return false;
    }
    await this.db.insert(feishuInbox).values({
      id: messageUuid(`${assistantId}:${appId}:${message.messageId}`), assistantId, appId, senderHash: hash,
      command: message.command,
    }).onConflictDoNothing();
    return true;
  }

  async drain(): Promise<void> {
    if (!this.db || this.draining) return;
    this.draining = true;
    try {
      await this.db.update(feishuInbox).set({ status: 'failed', leaseId: null, lastError: 'FEISHU_MESSAGE_ATTEMPTS_EXHAUSTED', updatedAt: new Date() })
        .where(and(eq(feishuInbox.status, 'processing'), gte(feishuInbox.attempts, MAX_ATTEMPTS), lt(feishuInbox.updatedAt, new Date(Date.now() - LEASE_MS))));
      const ready = or(
        eq(feishuInbox.status, 'pending'),
        and(eq(feishuInbox.status, 'retryable'), lte(feishuInbox.updatedAt, new Date(Date.now() - 15_000))),
        and(eq(feishuInbox.status, 'processing'), lt(feishuInbox.updatedAt, new Date(Date.now() - LEASE_MS))),
      );
      const rows = await this.db.select().from(feishuInbox).where(and(ready, lt(feishuInbox.attempts, MAX_ATTEMPTS))).orderBy(asc(feishuInbox.createdAt)).limit(20);
      for (const row of rows) {
        const leaseId = randomUUID();
        const [claimed] = await this.db.update(feishuInbox).set({ status: 'processing', attempts: row.attempts + 1, leaseId, updatedAt: new Date() })
          .where(and(eq(feishuInbox.id, row.id), eq(feishuInbox.status, row.status), eq(feishuInbox.attempts, row.attempts))).returning();
        if (claimed) await this.process(claimed, leaseId);
      }
    } finally { this.draining = false; }
  }

  private async process(row: InboxRow, leaseId: string): Promise<void> {
    if (!this.db) return;
    try {
      const [bot] = await this.db.select().from(feishuBots).where(eq(feishuBots.assistantId, row.assistantId));
      const recipient = bot?.reportRecipients.find((value) => recipientHash(value) === row.senderHash);
      if (!bot?.enabled || !bot.inboundEnabled || bot.appId !== row.appId || !recipient) throw new FeishuApiError('FEISHU_BINDING_REVOKED');
      const actor = await this.feishu.resolveRecipientAdmin(row.assistantId, recipient);
      const text = await this.handlers.reply(row.assistantId, { actor, command: row.command === 'report' ? 'report' : 'help' });
      const receipt = await this.feishu.sendText(row.assistantId, recipient, text, `inbox:${row.id}`, row.appId);
      await withTransaction(this.db, async (tx) => {
        const updated = await tx.update(feishuInbox).set({ status: 'sent', replyMessageId: receipt.messageId, lastError: null, leaseId: null, updatedAt: new Date() })
          .where(and(eq(feishuInbox.id, row.id), eq(feishuInbox.leaseId, leaseId))).returning({ id: feishuInbox.id });
        if (!updated.length) throw new FeishuApiError('FEISHU_MESSAGE_LEASE_LOST', true);
        await this.audit.write({ actorId: actor.id, actorRole: 'admin', action: 'admin.feishu.message.replied', targetType: 'feishu_inbox', targetId: row.id, detail: { assistantId: row.assistantId, command: row.command, senderHash: row.senderHash } }, tx);
      });
    } catch (error) {
      const retryable = error instanceof FeishuApiError ? error.retryable : error instanceof HttpException ? error.getStatus() >= 500 : true;
      const code = error instanceof FeishuApiError ? error.code : 'FEISHU_MESSAGE_PROCESSING_FAILED';
      await this.db.update(feishuInbox).set({ status: retryable && row.attempts < MAX_ATTEMPTS ? 'retryable' : 'failed', lastError: code, leaseId: null, updatedAt: new Date() })
        .where(and(eq(feishuInbox.id, row.id), eq(feishuInbox.leaseId, leaseId)));
      this.logger.warn({ code, assistantId: row.assistantId, inboxId: row.id });
    }
  }
}
