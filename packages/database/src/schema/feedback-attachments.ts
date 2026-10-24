import { customType, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { feedbackTickets } from './feedback';
const privateBytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
/** Small private feedback files; never projected into learning evidence or public storage. */
export const feedbackAttachments = pgTable('feedback_attachments', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  childUserId: text('child_user_id').notNull().references(() => users.id),
  ticketId: text('ticket_id').references(() => feedbackTickets.id),
  fileName: text('file_name').notNull(), contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(), contentHash: text('content_hash').notNull(),
  requestHash: text('request_hash').notNull(), idempotencyKey: text('idempotency_key').notNull(),
  bytes: privateBytes('bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => ({
  ownerKey: uniqueIndex('feedback_attachments_owner_key_idx').on(table.ownerUserId, table.idempotencyKey),
  owner: index('feedback_attachments_owner_idx').on(table.ownerUserId),
  ticket: index('feedback_attachments_ticket_idx').on(table.ticketId),
}));
