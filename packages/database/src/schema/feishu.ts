import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Server-owned Feishu/Lark bot configuration. Secrets are AES-GCM ciphertext. */
export const feishuBots = pgTable('feishu_bots', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  appId: text('app_id'),
  appSecretEncrypted: text('app_secret_encrypted'),
  verificationTokenEncrypted: text('verification_token_encrypted'),
  encryptKeyEncrypted: text('encrypt_key_encrypted'),
  domain: text('domain').notNull().default('feishu'),
  reportAssistantId: text('report_assistant_id'),
  reportRecipients: jsonb('report_recipients').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived browser/phone QR binding sessions. No student content is stored. */
export const feishuQrSessions = pgTable('feishu_qr_sessions', {
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => feishuBots.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  status: text('status').notNull().default('pending'),
  boundOpenId: text('bound_open_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stateIdx: index('feishu_qr_sessions_state_idx').on(table.state),
  expiryIdx: index('feishu_qr_sessions_expiry_idx').on(table.expiresAt),
}));
