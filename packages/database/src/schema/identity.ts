import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { schools } from './tenancy';

/**
 * Users table: the single identity source for all roles.
 * Product constraint: email must be unique (case-insensitive).
 * We use a unique index on lower(email) instead of citext to avoid extension dependencies.
 *
 * `school_id` is the tenancy anchor for the shared single-school model: nullable today
 * (existing rows / system accounts may have no school), with the active school resolved
 * server-side on future writes. See `tenancy.ts` and ADR 0006.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(), // 'student' | 'parent' | 'teacher' | 'admin'
    passwordHash: text('password_hash').notNull(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    emailLowerIdx: uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`),
    schoolIdx: index('users_school_idx').on(table.schoolId),
  }),
);

/**
 * Households: minimal grouping for family units.
 */
export const households = pgTable('households', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Guardian links: parent ↔ student relationships.
 * Product constraint: unique (parent_user_id, student_user_id) where status='active'.
 */
export const guardianLinks = pgTable(
  'guardian_links',
  {
    id: text('id').primaryKey(),
    parentUserId: text('parent_user_id')
      .notNull()
      .references(() => users.id),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    relationship: text('relationship').notNull(), // 'mother' | 'father' | 'guardian'
    status: text('status').notNull(), // 'active' | 'ended'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex('guardian_links_active_unique_idx')
      .on(table.parentUserId, table.studentUserId)
      .where(sql`${table.status} = 'active'`),
    studentIdx: index('guardian_links_student_idx').on(table.studentUserId),
  }),
);

/**
 * Mentor assignments: teacher ↔ student (班主任).
 * HARD PRODUCT CONSTRAINT: 一个学生同一时间只能有一个当前班主任。
 * Implemented as: UNIQUE (student_user_id) WHERE status = 'active'.
 */
export const mentorAssignments = pgTable(
  'mentor_assignments',
  {
    id: text('id').primaryKey(),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    mentorUserId: text('mentor_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(), // 'active' | 'ended'
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    // This is the partial unique index enforcing the product rule
    oneActiveMentorPerStudent: uniqueIndex('mentor_assignments_one_active_per_student_idx')
      .on(table.studentUserId)
      .where(sql`${table.status} = 'active'`),
    mentorIdx: index('mentor_assignments_mentor_idx').on(table.mentorUserId),
  }),
);
