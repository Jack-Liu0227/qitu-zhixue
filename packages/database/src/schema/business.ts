import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  BusinessSettings,
  ProjectOffer,
  BusinessOrderStatus,
  BusinessOrder,
} from '@qitu/contracts' with { 'resolution-mode': 'import' };
import { users } from './identity';
import { projectTemplateVersions } from './project-templates';

export const businessSettings = pgTable('business_settings', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  content: jsonb('content').$type<BusinessSettings>().notNull(),
  lastAutomationAt: timestamp('last_automation_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessOffers = pgTable(
  'business_offers',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => projectTemplateVersions.id),
    status: text('status').$type<ProjectOffer['status']>().notNull(),
    requiresPurchase: boolean('requires_purchase').notNull(),
    content: jsonb('content').$type<ProjectOffer>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ versionIdx: index('business_offers_version_idx').on(t.templateVersionId) }),
);

export const businessOrders = pgTable(
  'business_orders',
  {
    id: text('id').primaryKey(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => users.id),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id),
    offerId: text('offer_id')
      .notNull()
      .references(() => businessOffers.id),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => projectTemplateVersions.id),
    offerSnapshot: jsonb('offer_snapshot').$type<ProjectOffer>().notNull(),
    termsSnapshot: jsonb('terms_snapshot').$type<BusinessOrder['terms']>().notNull(),
    amountFen: integer('amount_fen').notNull(),
    status: text('status').$type<BusinessOrderStatus>().notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    transactionId: text('transaction_id'),
    checkoutUrl: text('checkout_url'),
    checkoutExpiresAt: timestamp('checkout_expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    accessUntil: timestamp('access_until', { withTimezone: true }),
    refundReason: text('refund_reason'),
    refundId: text('refund_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: uniqueIndex('business_orders_request_idx').on(t.buyerId, t.requestKey),
    transactionIdx: uniqueIndex('business_orders_transaction_idx').on(t.transactionId),
    studentVersionIdx: index('business_orders_student_version_idx').on(
      t.studentId,
      t.templateVersionId,
    ),
    buyerIdx: index('business_orders_buyer_idx').on(t.buyerId, t.createdAt),
  }),
);

export const businessTasks = pgTable(
  'business_tasks',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'lead' | 'refund' | 'delivery'>().notNull(),
    referenceId: text('reference_id').notNull(),
    title: text('title').notNull(),
    status: text('status').$type<'open' | 'resolved'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({ referenceIdx: uniqueIndex('business_tasks_reference_idx').on(t.kind, t.referenceId) }),
);

/** Only bounded usage metadata, never prompts or student conversations. */
export const businessModelUsage = pgTable(
  'business_model_usage',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    usageId: text('usage_id').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index('business_model_usage_created_idx').on(t.createdAt) }),
);

export const businessExpenses = pgTable(
  'business_expenses',
  {
    id: text('id').primaryKey(),
    category: text('category')
      .$type<'ai' | 'payment' | 'hosting' | 'support' | 'other'>()
      .notNull(),
    amountFen: integer('amount_fen').notNull(),
    minutes: integer('minutes').notNull(),
    note: text('note').notNull(),
    orderId: text('order_id').references(() => businessOrders.id),
    requestKey: text('request_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ requestIdx: uniqueIndex('business_expenses_request_idx').on(t.requestKey) }),
);
