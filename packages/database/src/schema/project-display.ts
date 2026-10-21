import { pgTable, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { projects } from './projects';

/** Display preferences only; these rows never grant access or learning completion. */
export const studentProjectLists = pgTable('student_project_lists', {
  studentUserId: text('student_user_id').primaryKey().references(() => users.id),
  currentProjectId: text('current_project_id').references(() => projects.id),
  version: integer('version').notNull().default(0),
});
export const studentProjectDisplay = pgTable('student_project_display', {
  studentUserId: text('student_user_id').notNull().references(() => users.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  collectedAt: timestamp('collected_at', { withTimezone: true }),
}, table => ({ pk: primaryKey({ columns: [table.studentUserId, table.projectId] }) }));
