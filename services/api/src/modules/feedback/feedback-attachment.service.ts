import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { feedbackAttachments, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { DirectoryService } from '../directory/directory.service';
import { FeedbackStore } from './feedback.store';
import { FeedbackAttachmentRegistry } from './feedback.attachments';
import { attachmentInfo, invalidAttachment, parseAttachment } from './feedback-attachment.validation';

const metadata = { id: feedbackAttachments.id, fileName: feedbackAttachments.fileName, contentType: feedbackAttachments.contentType,
  sizeBytes: feedbackAttachments.sizeBytes, createdAt: feedbackAttachments.createdAt };
const OWNER_BYTES = 20 * 1024 * 1024;
const TOTAL_BYTES = 256 * 1024 * 1024;

@Injectable()
export class FeedbackAttachmentService extends FeedbackAttachmentRegistry {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly directory: DirectoryService,
    private readonly tickets: FeedbackStore, private readonly audit: AuditWriter) { super(); }

  async upload(actor: CurrentUser, body: unknown, key: string) {
    const input = parseAttachment(body);
    await this.authorizeChild(actor, input.childId);
    if (!key.trim() || key.length > 160) return invalidAttachment();
    const contentHash = createHash('sha256').update(input.bytes).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify({ childId: input.childId, fileName: input.fileName, contentType: input.contentType, contentHash })).digest('hex');
    return this.database().transaction(async tx => {
      // One bounded upload transaction at a time prevents concurrent quota bypass.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7302052)`);
      const [prior] = await tx.select({ ...metadata, requestHash: feedbackAttachments.requestHash, ticketId: feedbackAttachments.ticketId,
        expiresAt: feedbackAttachments.expiresAt }).from(feedbackAttachments)
        .where(and(eq(feedbackAttachments.ownerUserId, actor.id), eq(feedbackAttachments.idempotencyKey, key)));
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '该请求键已用于不同的附件。' });
        if (!prior.ticketId && prior.expiresAt.getTime() <= Date.now()) return invalidAttachment();
        return attachmentInfo(prior);
      }
      const expired = await tx.delete(feedbackAttachments).where(and(isNull(feedbackAttachments.ticketId), lt(feedbackAttachments.expiresAt, new Date())))
        .returning({ id: feedbackAttachments.id });
      if (expired.length) await this.audit.write({ actorId: null, action: 'feedback.attachment.expired', targetType: 'feedback_attachment',
        targetId: null, detail: { count: expired.length } }, tx);
      const [volume] = await tx.select({ total: sql<number>`coalesce(sum(${feedbackAttachments.sizeBytes}),0)`,
        own: sql<number>`coalesce(sum(case when ${feedbackAttachments.ownerUserId}=${actor.id} then ${feedbackAttachments.sizeBytes} else 0 end),0)` }).from(feedbackAttachments);
      if (Number(volume?.total ?? 0) + input.bytes.length > TOTAL_BYTES || Number(volume?.own ?? 0) + input.bytes.length > OWNER_BYTES)
        throw new ConflictException({ code: 'FEEDBACK_ATTACHMENT_QUOTA', message: '附件存储额度已满，请移除未提交的附件或联系管理员。' });
      const [saved] = await tx.insert(feedbackAttachments).values({ id: randomUUID(), ownerUserId: actor.id, childUserId: input.childId,
        fileName: input.fileName, contentType: input.contentType, sizeBytes: input.bytes.length, bytes: input.bytes,
        contentHash, requestHash, idempotencyKey: key, expiresAt: new Date(Date.now() + 86_400_000) }).returning(metadata);
      if (!saved) throw new ServiceUnavailableException('附件保存失败。');
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'feedback.attachment.upload', targetType: 'feedback_attachment',
        targetId: saved.id, detail: { childId: input.childId, sizeBytes: saved.sizeBytes, contentType: input.contentType } }, tx);
      return attachmentInfo(saved);
    });
  }

  async content(actor: CurrentUser, id: string) {
    const [row] = await this.database().select({ ...metadata, owner: feedbackAttachments.ownerUserId, child: feedbackAttachments.childUserId,
      ticket: feedbackAttachments.ticketId, expires: feedbackAttachments.expiresAt }).from(feedbackAttachments).where(eq(feedbackAttachments.id, id));
    if (!row) throw missing();
    await this.authorizeChild(actor, row.child);
    if (row.ticket) {
      const ticket = await this.tickets.findTicket(row.ticket);
      if (!ticket || !ticket.entries.some(entry => entry.attachmentRefs.includes(id)) || ticket.childId !== row.child
        || actor.role === 'parent' && ticket.parentId !== actor.id) throw missing();
    } else if (row.owner !== actor.id || row.expires.getTime() <= Date.now()) throw missing();
    const [file] = await this.database().select({ bytes: feedbackAttachments.bytes }).from(feedbackAttachments).where(eq(feedbackAttachments.id, id));
    if (!file) throw missing();
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'feedback.attachment.download',
      targetType: 'feedback_attachment', targetId: id, detail: { childId: row.child, ticketId: row.ticket, sizeBytes: row.sizeBytes } });
    return { info: attachmentInfo(row), bytes: file.bytes };
  }

  async remove(actor: CurrentUser, id: string) {
    return this.database().transaction(async tx => {
      const [row] = await tx.select({ ticketId: feedbackAttachments.ticketId, childId: feedbackAttachments.childUserId }).from(feedbackAttachments)
        .where(and(eq(feedbackAttachments.id, id), eq(feedbackAttachments.ownerUserId, actor.id))).for('update');
      if (!row) return { id, deleted: true };
      await this.authorizeChild(actor, row.childId);
      if (row.ticketId) throw new ConflictException({ code: 'FEEDBACK_ATTACHMENT_LINKED', message: '已提交的附件随反馈记录保存，不能从草稿中删除。' });
      await tx.delete(feedbackAttachments).where(eq(feedbackAttachments.id, id));
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'feedback.attachment.remove',
        targetType: 'feedback_attachment', targetId: id, detail: { childId: row.childId } }, tx);
      return { id, deleted: true };
    });
  }

  override async assertOwnedBy(ownerUserId: string, ids: readonly string[]) {
    if (!ids.length) return;
    const rows = await this.database().select({ id: feedbackAttachments.id, expires: feedbackAttachments.expiresAt, ticket: feedbackAttachments.ticketId })
      .from(feedbackAttachments).where(and(inArray(feedbackAttachments.id, [...ids]), eq(feedbackAttachments.ownerUserId, ownerUserId)));
    if (rows.length !== ids.length || rows.some(row => !row.ticket && row.expires.getTime() <= Date.now())) return invalidAttachment();
  }
  override async describe(ids: readonly string[]) {
    if (!ids.length) return [];
    const rows = await this.database().select(metadata).from(feedbackAttachments).where(inArray(feedbackAttachments.id, [...ids]));
    return ids.flatMap(id => { const row = rows.find(item => item.id === id); return row ? [attachmentInfo(row)] : []; });
  }
  register(): void { throw new Error('Feedback attachments must be created through the private upload owner'); }
  private async authorizeChild(actor: CurrentUser, childId: string) {
    const allowed = actor.role === 'parent' ? (await this.directory.childrenOfParent(actor.id)).some(child => child.userId === childId)
      : actor.role === 'teacher' && (await this.directory.studentsOfMentor(actor.id)).some(child => child.userId === childId);
    if (!allowed) throw new ForbiddenException({ code: 'FEEDBACK_ATTACHMENT_FORBIDDEN', message: '无权访问该孩子的反馈附件。' });
  }
  private database() {
    if (!this.db) throw new ServiceUnavailableException({ code: 'FEEDBACK_ATTACHMENT_UNAVAILABLE', message: '附件存储暂时不可用。' });
    return this.db;
  }
}
function missing() { return new NotFoundException({ code: 'FEEDBACK_ATTACHMENT_NOT_FOUND', message: '附件不存在或不可访问。' }); }
