import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  feedbackTicketEntries,
  feedbackTickets,
  withTransaction,
  type Database,
} from '@qitu/database';
import type { ParentFeedbackEventKind, ParentFeedbackSource, ParentFeedbackStatus } from '@qitu/contracts';
import type { AuditWriter, AuditTransaction } from '../../common/audit/audit.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import {
  FeedbackStore,
  type AppendEntryCommand,
  type CreateTicketCommand,
  type FeedbackEntryRecord,
  type FeedbackTicketRecord,
} from './feedback.store';

const PG_UNIQUE_VIOLATION = '23505';

type TicketRow = typeof feedbackTickets.$inferSelect;
type EntryRow = typeof feedbackTicketEntries.$inferSelect;
type Executor = Database | AuditTransaction;

/**
 * live 持久化实现。使用迁移 `0005_nostalgic_shotgun` 中的
 * `feedback_tickets` / `feedback_ticket_entries` 两张表。
 *
 * 所有写操作走 `withTransaction`，并在**同一个事务**里写审计（`AuditWriter.write`
 * 传入 `tx`）与通知事件（`OutboxWriter.write` 传入 `tx`）。因此不存在
 * 「工单落库、审计 / 通知丢失」的中间态；并发同 id 写入由主键唯一约束兜底，
 * 捕获 `23505` 后回读已存在记录，服务层表现为幂等重放。
 */
export class PostgresFeedbackStore extends FeedbackStore {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {
    super();
  }

  async seed(record: FeedbackTicketRecord): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const existing = await loadTicket(tx, record.id);
      if (existing !== null) return;
      await insertTicket(tx, record);
    });
  }

  async findTicket(id: string): Promise<FeedbackTicketRecord | null> {
    return loadTicket(this.db, id);
  }

  async listTicketsForChild(childId: string): Promise<FeedbackTicketRecord[]> {
    const rows = await this.db
      .select({ id: feedbackTickets.id })
      .from(feedbackTickets)
      .where(eq(feedbackTickets.childUserId, childId))
      .orderBy(desc(feedbackTickets.updatedAt));
    return this.loadAll(rows.map((row) => row.id));
  }

  async listTicketsForChildren(childIds: readonly string[]): Promise<FeedbackTicketRecord[]> {
    if (childIds.length === 0) return [];
    const rows = await this.db
      .select({ id: feedbackTickets.id })
      .from(feedbackTickets)
      .where(inArray(feedbackTickets.childUserId, [...childIds]))
      .orderBy(desc(feedbackTickets.updatedAt));
    return this.loadAll(rows.map((row) => row.id));
  }

  async createTicket(command: CreateTicketCommand): Promise<FeedbackTicketRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const existing = await loadTicket(tx, command.ticket.id);
        if (existing !== null) return existing;
        await insertTicket(tx, command.ticket);
        await this.audit.write(command.audit, tx);
        await this.outbox.write(command.event, tx);
        const created = await loadTicket(tx, command.ticket.id);
        if (created === null) throw new Error(`工单写入后无法回读：${command.ticket.id}`);
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // 并发同 id：另一事务已提交，回读并作为幂等重放返回。
      const existing = await loadTicket(this.db, command.ticket.id);
      if (existing === null) throw error;
      return existing;
    }
  }

  async appendEntry(command: AppendEntryCommand): Promise<FeedbackTicketRecord | null> {
    try {
      return await withTransaction(this.db, async (tx) => {
        const [ticket] = await tx
          .select()
          .from(feedbackTickets)
          .where(eq(feedbackTickets.id, command.ticketId))
          .limit(1)
          .for('update');
        if (ticket === undefined) return null;

        const [existingEntry] = await tx
          .select({ id: feedbackTicketEntries.id })
          .from(feedbackTicketEntries)
          .where(
            and(
              eq(feedbackTicketEntries.ticketId, command.ticketId),
              eq(feedbackTicketEntries.id, command.entry.id),
            ),
          )
          .limit(1);
        if (existingEntry !== undefined) {
          return loadTicket(tx, command.ticketId);
        }

        const [maxRow] = await tx
          .select({ maxSeq: sql<number>`coalesce(max(${feedbackTicketEntries.seq}), -1)` })
          .from(feedbackTicketEntries)
          .where(eq(feedbackTicketEntries.ticketId, command.ticketId));
        const seq = Number(maxRow?.maxSeq ?? -1) + 1;

        await tx.insert(feedbackTicketEntries).values(mapEntryInsert(command.ticketId, seq, command.entry));
        await tx
          .update(feedbackTickets)
          .set({ status: command.nextStatus, updatedAt: command.entry.createdAt })
          .where(eq(feedbackTickets.id, command.ticketId));

        await this.audit.write(command.audit, tx);
        await this.outbox.write(command.event, tx);
        return loadTicket(tx, command.ticketId);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // 并发同 entry 幂等键：赢家已提交，回读当前工单即可。
      return loadTicket(this.db, command.ticketId);
    }
  }

  private async loadAll(ids: readonly string[]): Promise<FeedbackTicketRecord[]> {
    const result: FeedbackTicketRecord[] = [];
    for (const id of ids) {
      const ticket = await loadTicket(this.db, id);
      if (ticket !== null) result.push(ticket);
    }
    return result;
  }
}

async function insertTicket(
  executor: Executor,
  record: FeedbackTicketRecord,
): Promise<void> {
  await executor.insert(feedbackTickets).values({
    id: record.id,
    childUserId: record.childId,
    parentUserId: record.parentId,
    source: record.source,
    projectId: record.projectId,
    projectTitle: record.projectTitle,
    messageId: record.messageId,
    status: record.status,
    problem: record.problem,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
  await executor.insert(feedbackTicketEntries).values(
    record.entries.map((entry, index) => mapEntryInsert(record.id, index, entry)),
  );
}

function mapEntryInsert(ticketId: string, seq: number, entry: FeedbackEntryRecord) {
  return {
    id: entry.id,
    ticketId,
    seq,
    kind: entry.kind,
    authorRole: entry.authorRole,
    authorId: entry.authorId,
    authorDisplayName: entry.authorDisplayName,
    content: entry.content,
    attachmentRefs: [...entry.attachmentRefs],
    resolved: entry.resolved,
    createdAt: entry.createdAt,
  };
}

async function loadTicket(executor: Executor, id: string): Promise<FeedbackTicketRecord | null> {
  const [ticket] = await executor
    .select()
    .from(feedbackTickets)
    .where(eq(feedbackTickets.id, id))
    .limit(1);
  if (ticket === undefined) return null;
  const entries = await executor
    .select()
    .from(feedbackTicketEntries)
    .where(eq(feedbackTicketEntries.ticketId, id))
    .orderBy(feedbackTicketEntries.seq);
  return assemble(ticket, entries);
}

function assemble(ticket: TicketRow, entries: EntryRow[]): FeedbackTicketRecord {
  return {
    id: ticket.id,
    childId: ticket.childUserId,
    source: ticket.source as ParentFeedbackSource,
    projectId: ticket.projectId,
    projectTitle: ticket.projectTitle,
    messageId: ticket.messageId,
    parentId: ticket.parentUserId,
    status: ticket.status as ParentFeedbackStatus,
    problem: ticket.problem,
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind as ParentFeedbackEventKind,
      authorRole: entry.authorRole as 'parent' | 'teacher',
      authorId: entry.authorId,
      authorDisplayName: entry.authorDisplayName,
      content: entry.content,
      attachmentRefs: entry.attachmentRefs ?? [],
      resolved: entry.resolved,
      createdAt: entry.createdAt,
    })),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;
}
