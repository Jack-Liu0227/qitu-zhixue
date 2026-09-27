import { pgTable, text, timestamp, jsonb, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * Audit logs: record of all significant actions.
 * Supports idempotency via optional idempotency_key.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id'), // nullable: system actions may have no actor
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    detail: jsonb('detail'),
    idempotencyKey: text('idempotency_key'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex('audit_logs_idempotency_key_idx').on(table.idempotencyKey),
    actorIdx: index('audit_logs_actor_idx').on(table.actorId),
    targetIdx: index('audit_logs_target_idx').on(table.targetType, table.targetId),
    atIdx: index('audit_logs_at_idx').on(table.at),
  }),
);

/**
 * Outbox: transactional outbox pattern for async event publication.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull(), // 'pending' | 'published' | 'failed'
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'), // diagnostics for status='failed'; null before first failure
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index('outbox_status_idx').on(table.status),
    createdAtIdx: index('outbox_created_at_idx').on(table.createdAt),
  }),
);
