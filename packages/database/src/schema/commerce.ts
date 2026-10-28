import { pgTable, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { CommerceProduct, CommercePolicy } from '@qitu/contracts' with {
  'resolution-mode': 'import',
};
import { users } from './identity';
import { businessOrders } from './business';

export const commerceProducts = pgTable('commerce_products', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  content: jsonb('content').$type<CommerceProduct>().notNull(),
});
export const commercePolicies = pgTable('commerce_policies', {
  id: text('id').primaryKey(),
  content: jsonb('content').$type<CommercePolicy>().notNull(),
});
export const commerceOrganizations = pgTable('commerce_organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const commerceGrants = pgTable(
  'commerce_grants',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id').references(() => businessOrders.id),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id),
    organizationId: text('organization_id').references(() => commerceOrganizations.id),
    product: jsonb('product').$type<CommerceProduct>().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    orderStudent: uniqueIndex('commerce_grants_order_student_idx').on(t.orderId, t.studentId),
    student: index('commerce_grants_student_idx').on(t.studentId),
  }),
);
/** Commercial attribution only; projects and learning services still own project state. */
export const commerceProjectAccess = pgTable('commerce_project_access', {
  projectId: text('project_id').primaryKey(),
  studentId: text('student_id')
    .notNull()
    .references(() => users.id),
  templateVersionId: text('template_version_id').notNull(),
  grantId: text('grant_id').references(() => commerceGrants.id),
  source: text('source').$type<'free' | 'grant' | 'legacy'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const commerceUsage = pgTable(
  'commerce_usage',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => users.id),
    grantId: text('grant_id').references(() => commerceGrants.id),
    bucket: text('bucket').notNull(),
    status: text('status').$type<'reserved' | 'committed' | 'released'>().notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bucketIdx: index('commerce_usage_bucket_idx').on(t.studentId, t.bucket) }),
);
