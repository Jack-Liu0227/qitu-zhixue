import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projects } from './projects';

export const tutorPartners = pgTable('tutor_partners', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  soul: text('soul').notNull(),
  modelUsage: text('model_usage').notNull().default('tutor.chat'),
  promptVersion: text('prompt_version').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tutorLearnerProfiles = pgTable('tutor_learner_profiles', {
  studentId: text('student_id').primaryKey().references(() => users.id),
  priorKnowledge: text('prior_knowledge'),
  targetLevel: text('target_level'),
  timeBudgetMinutesPerWeek: integer('time_budget_minutes_per_week'),
  preferences: jsonb('preferences').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  interests: jsonb('interests').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  strengths: jsonb('strengths').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  nextQuestions: jsonb('next_questions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tutorTemplateDocuments = pgTable('tutor_template_documents', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  studentId: text('student_id').references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  stage: text('stage').notNull(),
  content: text('content').notNull(),
  scope: text('scope').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeIdx: index('tutor_template_documents_active_idx').on(table.active),
  studentIdx: index('tutor_template_documents_student_idx').on(table.studentId),
  projectIdx: index('tutor_template_documents_project_idx').on(table.projectId),
}));

export const tutorKnowledgeDocuments = pgTable('tutor_knowledge_documents', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  studentId: text('student_id').references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  content: text('content').notNull(),
  source: text('source').notNull(),
  scope: text('scope').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeIdx: index('tutor_knowledge_documents_active_idx').on(table.active),
  studentIdx: index('tutor_knowledge_documents_student_idx').on(table.studentId),
  projectIdx: index('tutor_knowledge_documents_project_idx').on(table.projectId),
}));
export const tutorMemories = pgTable('tutor_memories', {
  id: text('id').primaryKey(),
  studentId: text('student_id').notNull().references(() => users.id),
  partnerId: text('partner_id').notNull().references(() => tutorPartners.id),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  confidence: integer('confidence_basis_points').notNull().default(600),
  source: text('source').notNull(),
  visibility: text('visibility').notNull().default('student_private'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  relationIdx: index('tutor_memories_relation_idx').on(table.studentId, table.partnerId),
  updatedIdx: index('tutor_memories_updated_idx').on(table.updatedAt),
}));

export const tutorSessions = pgTable('tutor_sessions', {
  id: text('id').primaryKey(),
  studentId: text('student_id').notNull().references(() => users.id),
  partnerId: text('partner_id').notNull().references(() => tutorPartners.id),
  projectId: text('project_id').references(() => projects.id),
  source: text('source').notNull(),
  lastSeq: integer('last_seq').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  studentIdx: index('tutor_sessions_student_idx').on(table.studentId),
  projectIdx: index('tutor_sessions_project_idx').on(table.projectId),
}));

export const tutorTurns = pgTable('tutor_turns', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tutorSessions.id),
  studentId: text('student_id').notNull().references(() => users.id),
  role: text('role').notNull(),
  content: text('content'),
  blocks: jsonb('blocks').notNull(),
  seq: integer('seq').notNull(),
  hintLevel: integer('hint_level'),
  pedagogicMove: text('pedagogic_move'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionSeqUnique: uniqueIndex('tutor_turns_session_seq_unique_idx').on(table.sessionId, table.seq),
  sessionIdx: index('tutor_turns_session_idx').on(table.sessionId),
}));

export const tutorGrowthSignals = pgTable('tutor_growth_signals', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull(),
  studentId: text('student_id').notNull().references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  evidenceRef: text('evidence_ref'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex('tutor_growth_signals_idempotency_unique_idx').on(table.idempotencyKey),
  studentIdx: index('tutor_growth_signals_student_idx').on(table.studentId, table.occurredAt),
}));
