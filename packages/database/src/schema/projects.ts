import { pgTable, text, timestamp, jsonb, integer, uniqueIndex, index, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { projectTemplateVersions } from './project-templates';

/**
 * Exploration sessions: the server-owned **pre-project** state.
 *
 * Product constraint (文档 4.3 / 5.4): a formal project instance may only exist
 * after the student explicitly confirms an intent. Until then the student's
 * work lives here as an exploration / draft, never as a `projects` row.
 *
 * `status` is a text enum: `'exploring' | 'awaiting_confirmation' | 'confirmed'
 * | 'closed'`. Only the server state machine may move it.
 */
export const explorationSessions = pgTable(
  'exploration_sessions',
  {
    id: text('id').primaryKey(),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    /** `'recommended' | 'free'`；确认后创建项目时原样带入。 */
    source: text('source').notNull(),
    /** 推荐项目冻结引用的模板版本；自由探索为 null。 */
    templateVersionId: text('template_version_id'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => ({
    studentIdx: index('exploration_sessions_student_idx').on(table.studentUserId),
    statusIdx: index('exploration_sessions_status_idx').on(table.status),
    // 显式短名，避免 Postgres 63 字符截断（见 ADR 0006 迁移注意）。
    templateVersionFk: foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [projectTemplateVersions.id],
      name: 'exploration_sessions_template_version_id_fk',
    }),
  }),
);

/**
 * Intent confirmations: the 「正在形成的方向」 draft plus its confirmation.
 *
 * `confirmed_at` is the **only** confirmation proof. It is written exclusively
 * by the server on `POST /explorations/:id/confirm-intent`, so a client cannot
 * fake confirmation by posting a field.
 *
 * `ai_inferred` changes (here: `core_interests` derived during exploration)
 * must not overwrite the long-term interest profile — that merge is a separate,
 * reviewed step and is intentionally not represented by this table.
 *
 * One draft per exploration, enforced by the unique index.
 */
export const intentConfirmations = pgTable(
  'intent_confirmations',
  {
    id: text('id').primaryKey(),
    explorationId: text('exploration_id')
      .notNull()
      .references(() => explorationSessions.id),
    goalUser: text('goal_user'),
    coreInterests: jsonb('core_interests').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    preferredForm: text('preferred_form'),
    targetBeneficiary: text('target_beneficiary'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    explorationUniqueIdx: uniqueIndex('intent_confirmations_exploration_unique_idx').on(
      table.explorationId,
    ),
  }),
);

/**
 * Project instances: the formal project, created **only** from a confirmed
 * intent confirmation.
 *
 * HARD INVARIANT: `source_exploration_id` is unique (partial index) — a student
 * confirming the same exploration twice (retries, double-click, concurrent
 * requests) still produces exactly one project instance.
 *
 * `status` carries the server-owned `ProjectStage`. `current_stage_index` /
 * `stage_total` / `progress_percent` are server-computed display projections
 * (never read for gates). `template_version_id` is frozen at creation.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    /** 冻结引用；自由探索在生成方向卡前可为 null。 */
    templateVersionId: text('template_version_id').references(() => projectTemplateVersions.id),
    sourceExplorationId: text('source_exploration_id').references(() => explorationSessions.id),
    status: text('status').notNull(),
    currentStageIndex: integer('current_stage_index').notNull().default(0),
    stageTotal: integer('stage_total').notNull(),
    progressPercent: integer('progress_percent').notNull().default(0),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    // This is the partial unique index enforcing 「确认后只创建一个项目实例」.
    onePerExploration: uniqueIndex('projects_source_exploration_unique_idx')
      .on(table.sourceExplorationId)
      .where(sql`${table.sourceExplorationId} is not null`),
    studentIdx: index('projects_student_idx').on(table.studentUserId),
    statusIdx: index('projects_status_idx').on(table.status),
  }),
);
