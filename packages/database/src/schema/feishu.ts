import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Server-owned Feishu/Lark bot configuration. Secrets are AES-GCM ciphertext. */
export const feishuBots = pgTable('feishu_bots', {
  id: text('id').primaryKey(),
  /** One configuration per reporting assistant. */
  assistantId: text('assistant_id').notNull().default('feishu-reporting-assistant'),
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
}, (table) => ({ assistantUniqueIdx: uniqueIndex('feishu_bots_assistant_unique_idx').on(table.assistantId) }));

/** Short-lived browser/phone QR binding sessions. No student content is stored. */
export const feishuQrSessions = pgTable('feishu_qr_sessions', {
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull().references(() => feishuBots.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  status: text('status').notNull().default('pending'),
  boundOpenId: text('bound_open_id'),
  boundAdminId: text('bound_admin_id'),
  /** Device code is encrypted at rest and never returned to clients. */
  deviceCodeEncrypted: text('device_code_encrypted'),
  pollIntervalSeconds: integer('poll_interval_seconds').notNull().default(5),
  createdBy: text('created_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stateIdx: index('feishu_qr_sessions_state_idx').on(table.state),
  expiryIdx: index('feishu_qr_sessions_expiry_idx').on(table.expiresAt),
}));

/** Explicit channel-to-platform identity mapping established by an authenticated admin. */
export const feishuAdminBindings = pgTable('feishu_admin_bindings', {
  id: text('id').primaryKey(),
  assistantId: text('assistant_id').notNull(),
  openIdHash: text('open_id_hash').notNull(),
  adminUserId: text('admin_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelIdentityUniqueIdx: uniqueIndex('feishu_admin_bindings_channel_identity_unique_idx').on(table.assistantId, table.openIdHash),
  adminAssistantUniqueIdx: uniqueIndex('feishu_admin_bindings_admin_assistant_unique_idx').on(table.assistantId, table.adminUserId),
}));

/** Durable delivery ledger for report idempotency across worker restarts. */
export const feishuReportDeliveries = pgTable('feishu_report_deliveries', {
  id: text('id').primaryKey(),
  assistantId: text('assistant_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').notNull().default('pending'),
  recipientHashes: jsonb('recipient_hashes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  requestId: text('request_id'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (table) => ({
  assistantKeyUniqueIdx: uniqueIndex('feishu_report_deliveries_assistant_key_unique_idx').on(table.assistantId, table.idempotencyKey),
  statusIdx: index('feishu_report_deliveries_status_idx').on(table.status),
}));
