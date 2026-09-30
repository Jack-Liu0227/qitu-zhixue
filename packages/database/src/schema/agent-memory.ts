import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const agentMemoryRecords = pgTable('agent_memory_records', {
  id: text('id').primaryKey(),
  studentId: text('student_id'),
  partnerId: text('partner_id').notNull(),
  scope: text('scope').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  sourceRef: text('source_ref').notNull(),
  sourceEventId: text('source_event_id').notNull(),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  indexBackend: text('index_backend'),
  indexId: text('index_id'),
  indexStatus: text('index_status').notNull().default('pending'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  relationIdx: index('agent_memory_relation_idx').on(table.studentId, table.partnerId, table.status),
  sourceUnique: uniqueIndex('agent_memory_source_unique_idx').on(table.sourceEventId, table.version),
  indexStatusIdx: index('agent_memory_index_status_idx').on(table.indexStatus),
}));
