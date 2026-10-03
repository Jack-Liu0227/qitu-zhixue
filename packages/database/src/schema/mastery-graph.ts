import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { masteryEvents } from './learning-plan';
import { schools } from './tenancy';

export const masteryGraphReceipts = pgTable('mastery_graph_receipts', {
  eventId: text('event_id').primaryKey().references(() => masteryEvents.id, { onDelete: 'restrict' }),
  schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
  backend: text('backend').notNull().default('graphiti'),
  status: text('status').notNull().default('pending'),
  payloadHash: text('payload_hash').notNull(),
  projectionId: text('projection_id'),
  attempts: integer('attempts').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ statusIdx: index('mastery_graph_receipts_status_idx').on(table.status, table.leaseUntil) }));
