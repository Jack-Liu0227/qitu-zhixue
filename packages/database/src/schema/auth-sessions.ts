import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './identity';

/** Bearer tokens are never persisted. Store only their SHA-256 digests. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    id: text('id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index('auth_sessions_user_idx').on(t.userId),
    expiryIdx: index('auth_sessions_expiry_idx').on(t.expiresAt),
  }),
);
