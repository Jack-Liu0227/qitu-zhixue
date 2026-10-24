import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { projectEvidence } from './works';

/** Communication receipts only. No learning, mastery or assessment facts. */
export const parentMessageReceipts = pgTable('parent_message_receipts', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull().references(() => users.id),
  childId: text('child_id').notNull().references(() => users.id),
  messageId: text('message_id').notNull(),
  action: text('action').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  key: uniqueIndex('parent_message_receipts_key_unique').on(table.parentId, table.idempotencyKey),
  scope: index('parent_message_receipts_scope_idx').on(table.parentId, table.childId, table.messageId),
}));

export const parentEncouragements = pgTable('parent_encouragements', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull().references(() => users.id),
  childId: text('child_id').notNull().references(() => users.id),
  message: text('message').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  key: uniqueIndex('parent_encouragements_key_unique').on(table.parentId, table.idempotencyKey),
  inbox: index('parent_encouragements_inbox_idx').on(table.childId, table.createdAt),
}));

export const teacherSupportReceipts = pgTable('teacher_support_receipts', {
  evidenceId: text('evidence_id').primaryKey().references(() => projectEvidence.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').notNull().references(() => users.id),
  status: text('status').notNull(),
  note: text('note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
