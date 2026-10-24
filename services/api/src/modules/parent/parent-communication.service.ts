import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { parentEncouragements, parentMessageReceipts, users, type Database } from '@qitu/database';
import type { CurrentUser, ParentMessageAckAction, StudentEncouragement } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { DirectoryService } from '../directory/directory.service';

@Injectable()
export class ParentCommunicationService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly directory: DirectoryService, private readonly audit: AuditWriter) {}

  async receipts(parentId: string, childId: string) {
    await this.authorize(parentId, childId);
    return this.database().select().from(parentMessageReceipts).where(and(
      eq(parentMessageReceipts.parentId, parentId), eq(parentMessageReceipts.childId, childId),
    )).orderBy(desc(parentMessageReceipts.createdAt));
  }

  async acknowledge(actor: CurrentUser, childId: string, messageId: string, action: ParentMessageAckAction, key: string) {
    await this.authorize(actor.id, childId);
    const hash = digest({ childId, messageId, action });
    const record = await this.database().transaction(async tx => {
      const [inserted] = await tx.insert(parentMessageReceipts).values({ id: randomUUID(), parentId: actor.id,
        childId, messageId, action, idempotencyKey: key, requestHash: hash }).onConflictDoNothing().returning();
      if (inserted) {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'parent.message.ack',
          targetType: 'parent_message', targetId: messageId, detail: { childId, action } }, tx);
        return inserted;
      }
      const [existing] = await tx.select().from(parentMessageReceipts).where(and(
        eq(parentMessageReceipts.parentId, actor.id), eq(parentMessageReceipts.idempotencyKey, key)));
      if (!existing || existing.requestHash !== hash) throw conflict();
      return existing;
    });
    return { messageId, status: record.action === 'read' ? 'read' as const : 'muted' as const,
      ackedAt: record.createdAt.toISOString() };
  }

  async encourage(actor: CurrentUser, childId: string, message: string, key: string) {
    await this.authorize(actor.id, childId);
    const hash = digest({ childId, message });
    const record = await this.database().transaction(async tx => {
      const [inserted] = await tx.insert(parentEncouragements).values({ id: randomUUID(), parentId: actor.id,
        childId, message, idempotencyKey: key, requestHash: hash }).onConflictDoNothing().returning();
      if (inserted) {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'parent.encouragement.send',
          targetType: 'student', targetId: childId, detail: { encouragementId: inserted.id, messageLength: message.length } }, tx);
        return inserted;
      }
      const [existing] = await tx.select().from(parentEncouragements).where(and(
        eq(parentEncouragements.parentId, actor.id), eq(parentEncouragements.idempotencyKey, key)));
      if (!existing || existing.requestHash !== hash) throw conflict();
      return existing;
    });
    return { id: record.id, sentAt: record.createdAt.toISOString(), delivered: true };
  }

  async inbox(studentId: string): Promise<StudentEncouragement[]> {
    const guardians = await this.directory.guardiansOfStudent(studentId);
    if (!guardians.length) return [];
    const rows = await this.database().select({ id: parentEncouragements.id, message: parentEncouragements.message,
      at: parentEncouragements.createdAt, name: users.displayName }).from(parentEncouragements)
      .innerJoin(users, eq(users.id, parentEncouragements.parentId)).where(and(
        eq(parentEncouragements.childId, studentId), inArray(parentEncouragements.parentId, guardians.map(row => row.userId)),
      )).orderBy(desc(parentEncouragements.createdAt)).limit(10);
    return rows.map(row => ({ id: row.id, message: row.message, senderDisplayName: row.name, sentAt: row.at.toISOString() }));
  }

  private async authorize(parentId: string, childId: string) {
    if (!(await this.directory.childrenOfParent(parentId)).some(child => child.userId === childId)) {
      throw new ForbiddenException({ code: 'PARENT_CHILD_ACCESS_DENIED', message: '无权查看该孩子的数据' });
    }
  }
  private database() {
    if (!this.db) throw new ServiceUnavailableException({ code: 'PARENT_COMMUNICATION_UNAVAILABLE', message: '家庭消息服务暂时不可用' });
    return this.db;
  }
}
function digest(value: object) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function conflict() { return new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '该幂等键已用于不同内容' }); }
