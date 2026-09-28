import type {
  ParentFeedbackEventKind,
  ParentFeedbackSource,
  ParentFeedbackStatus,
} from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';

/**
 * 反馈工单的持久化边界（ISSUE-FEEDBACK / #11）。
 *
 * 服务层只依赖本抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现
 * （见 `feedback.store.postgres.ts`）。这样对象级授权、状态机与幂等判定留在
 * 服务层，而存储引擎可替换、可测试。
 *
 * 关键约束：**业务写入与审计、通知事件必须原子**。因此写命令把 `audit` 与
 * `event` 一起交给 store；Postgres 实现在同一个 `withTransaction` 里写三张表，
 * 内存实现按同样顺序执行副作用。这样不会出现「工单落库但审计 / 通知丢失」的
 * 裂缝，重放也不会产生第二条记录。
 */

export interface FeedbackEntryRecord {
  id: string;
  kind: ParentFeedbackEventKind;
  authorRole: 'parent' | 'teacher';
  authorId: string;
  authorDisplayName: string;
  content: string;
  attachmentRefs: string[];
  resolved: boolean | null;
  createdAt: Date;
}

export interface FeedbackTicketRecord {
  id: string;
  childId: string | null;
  source: ParentFeedbackSource;
  projectId: string | null;
  projectTitle: string | null;
  messageId: string | null;
  parentId: string;
  status: ParentFeedbackStatus;
  problem: string;
  entries: FeedbackEntryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/** 创建工单（含首条 `submitted` 事件）+ 审计 + 通知事件。 */
export interface CreateTicketCommand {
  ticket: FeedbackTicketRecord;
  audit: AuditEntry;
  event: OutboxEventInput;
}

/**
 * 追加一条时间线事件并迁移状态 + 审计 + 通知事件。
 *
 * `entry.id` 由服务层从幂等指纹派生：同一幂等键重试时命中已存在的事件，
 * store 不追加、也不重复写审计 / 事件。
 */
export interface AppendEntryCommand {
  ticketId: string;
  entry: FeedbackEntryRecord;
  /** 服务端状态机决定的下一个状态；store 不自行推导。 */
  nextStatus: ParentFeedbackStatus;
  audit: AuditEntry;
  event: OutboxEventInput;
}

export abstract class FeedbackStore {
  /** 幂等写入演示种子（仅 demo/test 调用）；已存在则跳过。 */
  abstract seed(record: FeedbackTicketRecord): Promise<void>;
  abstract findTicket(id: string): Promise<FeedbackTicketRecord | null>;
  abstract listTicketsForChild(childId: string): Promise<FeedbackTicketRecord[]>;
  abstract listTicketsForChildren(childIds: readonly string[]): Promise<FeedbackTicketRecord[]>;
  abstract createTicket(command: CreateTicketCommand): Promise<FeedbackTicketRecord>;
  /** 追加事件；工单不存在时返回 `null`（由服务层转成 404）。 */
  abstract appendEntry(command: AppendEntryCommand): Promise<FeedbackTicketRecord | null>;
}

export function cloneEntry(entry: FeedbackEntryRecord): FeedbackEntryRecord {
  return { ...entry, attachmentRefs: [...entry.attachmentRefs] };
}

export function cloneTicket(record: FeedbackTicketRecord): FeedbackTicketRecord {
  return {
    ...record,
    entries: record.entries.map(cloneEntry),
  };
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 它**不是** live 持久化；live 走 `PostgresFeedbackStore`，未配置数据库时应用
 * 启动即失败（fail fast），或在 `feedback.module.ts` 工厂里显式抛错。
 *
 * 副作用顺序刻意与 Postgres 事务一致：先写审计 / 通知，成功后才把工单放进内存，
 * 保证「审计失败 ⇒ 不产生工单」，重放不会留下半成品。若内存写入前的审计 / outbox
 * 抛错，调用方（`IdempotencyService`）会把该幂等键标记为 `failed`，允许重试。
 */
export class InMemoryFeedbackStore extends FeedbackStore {
  private readonly tickets = new Map<string, FeedbackTicketRecord>();

  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {
    super();
  }

  async seed(record: FeedbackTicketRecord): Promise<void> {
    if (!this.tickets.has(record.id)) {
      this.tickets.set(record.id, cloneTicket(record));
    }
  }

  async findTicket(id: string): Promise<FeedbackTicketRecord | null> {
    const record = this.tickets.get(id);
    return record === undefined ? null : cloneTicket(record);
  }

  async listTicketsForChild(childId: string): Promise<FeedbackTicketRecord[]> {
    return this.sorted([...this.tickets.values()].filter((t) => t.childId === childId));
  }

  async listTicketsForChildren(childIds: readonly string[]): Promise<FeedbackTicketRecord[]> {
    const wanted = new Set(childIds);
    return this.sorted(
      [...this.tickets.values()].filter((t) => t.childId !== null && wanted.has(t.childId)),
    );
  }

  async createTicket(command: CreateTicketCommand): Promise<FeedbackTicketRecord> {
    const existing = this.tickets.get(command.ticket.id);
    if (existing !== undefined) return cloneTicket(existing);

    await this.audit.write(command.audit);
    await this.outbox.write(command.event);
    this.tickets.set(command.ticket.id, cloneTicket(command.ticket));
    return cloneTicket(command.ticket);
  }

  async appendEntry(command: AppendEntryCommand): Promise<FeedbackTicketRecord | null> {
    const record = this.tickets.get(command.ticketId);
    if (record === undefined) return null;
    if (record.entries.some((entry) => entry.id === command.entry.id)) {
      return cloneTicket(record);
    }

    await this.audit.write(command.audit);
    await this.outbox.write(command.event);
    record.entries.push(cloneEntry(command.entry));
    record.status = command.nextStatus;
    record.updatedAt = command.entry.createdAt;
    return cloneTicket(record);
  }

  private sorted(records: FeedbackTicketRecord[]): FeedbackTicketRecord[] {
    return records
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneTicket);
  }
}
