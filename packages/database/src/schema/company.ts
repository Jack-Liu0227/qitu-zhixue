import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { CompanyRole, CompanyDepartment, CompanyWork } from '@qitu/contracts' with {
  'resolution-mode': 'import',
};
import { users } from './identity';

export const companyMembers = pgTable('company_members', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  role: text('role').$type<CompanyRole>().notNull(),
  active: boolean('active').notNull().default(true),
});
export const companyTeams = pgTable('company_teams', {
  department: text('department').$type<CompanyDepartment>().primaryKey(),
  assistantId: text('assistant_id'),
  enabled: boolean('enabled').notNull().default(false),
  revision: integer('revision').notNull().default(0),
});
export const companyWork = pgTable(
  'company_work',
  {
    id: text('id').primaryKey(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    department: text('department').$type<CompanyDepartment>().notNull(),
    brief: text('brief').notNull(),
    status: text('status').$type<CompanyWork['status']>().notNull(),
    result: text('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: text('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    requestKey: text('request_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ requestIdx: uniqueIndex('company_work_request_idx').on(t.createdBy, t.requestKey) }),
);
export const companyKnowledge = pgTable('company_knowledge', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  revision: integer('revision').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const companyChannels = pgTable(
  'company_channels',
  {
    id: text('id').primaryKey(),
    assistantId: text('assistant_id').notNull(),
    appId: text('app_id').notNull(),
    chatId: text('chat_id').notNull(),
    senderHash: text('sender_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    department: text('department').$type<CompanyDepartment>().notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    bindingIdx: uniqueIndex('company_channels_binding_idx').on(
      t.assistantId,
      t.appId,
      t.chatId,
      t.senderHash,
      t.department,
    ),
  }),
);
export const companyMessages = pgTable('company_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => companyChannels.id),
  workId: text('work_id').references(() => companyWork.id),
  delivery: jsonb('delivery')
    .$type<{ status: 'pending' | 'sent' | 'failed'; messageId?: string }>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
