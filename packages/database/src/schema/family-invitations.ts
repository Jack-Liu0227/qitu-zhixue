import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const familyInvitations = pgTable('family_invitations', {
  id: text('id').primaryKey(),
  parentEmail: text('parent_email').notNull(),
  parentName: text('parent_name').notNull(),
  studentEmail: text('student_email').notNull(),
  studentName: text('student_name').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedHash: text('accepted_hash'),
  policyRevision: integer('policy_revision'),
  parentId: text('parent_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
