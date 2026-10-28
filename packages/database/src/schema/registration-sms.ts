import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

/** No plaintext telephone number or verification code is stored here. */
export const registrationSms = pgTable(
  'registration_sms',
  {
    id: text('id').primaryKey(),
    requestKey: text('request_key').notNull(),
    phoneHash: text('phone_hash').notNull(),
    clientHash: text('client_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedBy: text('used_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestUnique: uniqueIndex('registration_sms_request_idx').on(table.requestKey),
    phoneRecent: index('registration_sms_phone_idx').on(table.phoneHash, table.createdAt),
    clientRecent: index('registration_sms_client_idx').on(table.clientHash, table.createdAt),
  }),
);
