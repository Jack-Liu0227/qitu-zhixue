import { pgTable, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';

/**
 * Feedback tickets (ISSUE-FEEDBACK / #11).
 *
 * 统一反馈工单的**服务端真相**。家长端与班主任端读写同一张表，不再各自维护
 * 一份「服务工单」。写入路径：
 *
 * - `parent_user_id`：始终记录开单家长；用于「无孩子的一般使用问题」的对象级归属。
 * - `child_user_id`：可为空。为空表示没有关联孩子的一般使用问题，进入受限队列，
 *   普通班主任不可见（对象级授权在 `FeedbackService` 中判定）。
 * - `source` / `project_id` / `project_title` / `message_id`：关联对象由服务端从
 *   消息或项目真源推导后冻结，客户端不能直接决定。
 * - `status`：text 枚举 `ParentFeedbackStatus`，只由服务端状态机迁移。
 * - `problem`：首条反馈正文快照，方便列表投影；完整时间线见
 *   `feedback_ticket_entries`。
 *
 * 表归属：Mentor Ops 独占写入（见 `docs/shared/DATABASE.md` §3）。审计 / outbox / 幂等
 * 是横切能力，不和本表混写。
 */
export const feedbackTickets = pgTable(
  'feedback_tickets',
  {
    id: text('id').primaryKey(),
    childUserId: text('child_user_id').references(() => users.id),
    parentUserId: text('parent_user_id')
      .notNull()
      .references(() => users.id),
    source: text('source').notNull(),
    projectId: text('project_id'),
    projectTitle: text('project_title'),
    messageId: text('message_id'),
    status: text('status').notNull(),
    problem: text('problem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    childIdx: index('feedback_tickets_child_idx').on(table.childUserId),
    parentIdx: index('feedback_tickets_parent_idx').on(table.parentUserId),
    statusIdx: index('feedback_tickets_status_idx').on(table.status),
  }),
);

/**
 * Feedback ticket timeline entries.
 *
 * 每条补充 / 回复 / 确认 / 重开都是不可变的追加事件；`seq` 在同一工单内严格递增
 * 并由唯一索引兜底，保证时间线顺序稳定。`kind` 为 text 枚举
 * `ParentFeedbackEventKind`（submitted / supplemented / replied / confirmed /
 * reopened）。
 *
 * `attachment_refs` 只保存附件 id，不保存对象存储凭据；归属校验由
 * `FeedbackAttachmentRegistry` 在写入前完成（对象存储尚未接入，见模块 README）。
 */
export const feedbackTicketEntries = pgTable(
  'feedback_ticket_entries',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => feedbackTickets.id),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    authorRole: text('author_role').notNull(),
    authorId: text('author_id').notNull(),
    authorDisplayName: text('author_display_name').notNull(),
    content: text('content').notNull(),
    attachmentRefs: jsonb('attachment_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    resolved: boolean('resolved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketSeqUnique: uniqueIndex('feedback_ticket_entries_ticket_seq_unique_idx').on(
      table.ticketId,
      table.seq,
    ),
    ticketIdx: index('feedback_ticket_entries_ticket_idx').on(table.ticketId),
  }),
);
