import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { schools } from './tenancy';
import { users } from './identity';
import { projects } from './projects';
import { projectTemplateVersions } from './project-templates';

/**
 * Learning plans: 「兴趣 → 4/8 周学习计划」的服务端真源
 * (docs/agents/tutor-curriculum-design.md §3 / §9).
 *
 * 硬规则衔接：
 * - 计划先生成，**学生确认意图后才创建正式项目**并冻结 `template_version_id`；
 * - `idempotency_key` 唯一，保证「计划生成」这一写操作可安全重试；
 * - 计划结构（module → objective → session）由服务端校验后落库，客户端不能直接写。
 *
 * `status` 为 text 枚举：`'draft' | 'active' | 'completed' | 'archived'`。
 * `school_id` 由服务端解析当前学校；`project_id` 在确认意图前为 NULL。
 */
export const learningPlans = pgTable(
  'learning_plans',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    /** 触发计划的兴趣（自由文本，学生原话）。 */
    interest: text('interest').notNull(),
    goal: text('goal').notNull(),
    /** 4 或 8；由服务端校验。 */
    weeks: integer('weeks').notNull(),
    minutesPerSession: integer('minutes_per_session').notNull().default(60),
    /** 冻结引用；确认意图后写入，之后不可漂移。 */
    templateVersionId: text('template_version_id'),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    idempotencyKey: text('idempotency_key').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('learning_plans_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    studentStatusIdx: index('learning_plans_student_status_idx').on(
      table.studentUserId,
      table.status,
    ),
    projectIdx: index('learning_plans_project_idx').on(table.projectId),
    // 显式短名，避免 Postgres 63 字符截断（见 ADR 0006 迁移注意）。
    templateVersionFk: foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [projectTemplateVersions.id],
      name: 'learning_plans_template_version_id_fk',
    }),
  }),
);

/**
 * Plan modules: 一周一个（或 4 周计划里一周两个）。
 *
 * `ordinal` 在计划内唯一，保证「第几周 / 第几个模块」稳定。
 */
export const learningModules = pgTable(
  'learning_modules',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    weekIndex: integer('week_index').notNull(),
    objective: text('objective').notNull().default(''),
    ordinal: integer('ordinal').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planOrdinalUniqueIdx: uniqueIndex('learning_modules_plan_ordinal_unique_idx').on(
      table.planId,
      table.ordinal,
    ),
    planIdx: index('learning_modules_plan_idx').on(table.planId),
  }),
);

/**
 * Plan objectives: 每个可检查、可掌握的最小目标。
 *
 * `type` 决定掌握门槛（`memory | concept | procedure | design`）；
 * `prerequisite_ids` 存前置目标 id，排课时必须先掌握前置，服务端保证无环。
 */
export const learningObjectives = pgTable(
  'learning_objectives',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    moduleId: text('module_id')
      .notNull()
      .references(() => learningModules.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** `'memory' | 'concept' | 'procedure' | 'design'`。 */
    type: text('type').notNull(),
    objective: text('objective').notNull(),
    prerequisiteIds: jsonb('prerequisite_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ordinal: integer('ordinal').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    moduleOrdinalUniqueIdx: uniqueIndex('learning_objectives_module_ordinal_unique_idx').on(
      table.moduleId,
      table.ordinal,
    ),
    moduleIdx: index('learning_objectives_module_idx').on(table.moduleId),
  }),
);

/** A single 60-minute lesson: blocks, theory/practice objectives, session mode. */
export const learningSessions = pgTable(
  'learning_sessions',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    moduleId: text('module_id')
      .notNull()
      .references(() => learningModules.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    /** `{ kind, minutes }[]`；服务端校验合计 = 每节时长。 */
    blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
    theoryObjectiveIds: jsonb('theory_objective_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    practiceObjectiveIds: jsonb('practice_objective_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** `'outline' | 'study' | 'review'`。 */
    mode: text('mode').notNull().default('study'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planIndexUniqueIdx: uniqueIndex('learning_sessions_plan_index_unique_idx').on(
      table.planId,
      table.index,
    ),
    moduleIdx: index('learning_sessions_module_idx').on(table.moduleId),
  }),
);

/**
 * Mastery state per (student, objective): the service-owned gate for
 * `TheoryMastered` and for interval review scheduling.
 *
 * 量化门槛（`memory | procedure`）用 `mastery_basis_points >= threshold_basis_points`
 * 判定（基点，0–10000，默认门槛 9000 = 0.9，与设计文档一致）；
 * 质化门槛（`concept | design`）用 `qualitative_mastered` 布尔。
 * `mastery_basis_points` 由服务端按近期加权 + 置信上限计算，客户端不可写。
 */
export const masteryRecords = pgTable(
  'mastery_records',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    planId: text('plan_id').references(() => learningPlans.id, { onDelete: 'cascade' }),
    objectiveId: text('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'cascade' }),
    /** `'memory' | 'concept' | 'procedure' | 'design'`（冗余自 objective，便于门槛判定）。 */
    knowledgeType: text('knowledge_type').notNull(),
    /** `'new' | 'learning' | 'mastered'`。 */
    status: text('status').notNull().default('new'),
    masteryBasisPoints: integer('mastery_basis_points').notNull().default(0),
    thresholdBasisPoints: integer('threshold_basis_points').notNull().default(9000),
    /** 质化门槛（concept/design）：由 Feynman 式检查置位，仅服务端可写。 */
    qualitativeMastered: boolean('qualitative_mastered').notNull().default(false),
    consecutiveCorrect: integer('consecutive_correct').notNull().default(0),
    consecutiveWrong: integer('consecutive_wrong').notNull().default(0),
    /** 间隔复习序列下标。 */
    intervalIndex: integer('interval_index').notNull().default(0),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),
    difficultyBasisPoints: integer('difficulty_basis_points').notNull().default(0),
    stabilityBasisPoints: integer('stability_basis_points').notNull().default(0),
    retrievabilityBasisPoints: integer('retrievability_basis_points').notNull().default(0),
    desiredRetentionBasisPoints: integer('desired_retention_basis_points').notNull().default(9000),
    reviewCount: integer('review_count').notNull().default(0),
    lapseCount: integer('lapse_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentObjectiveUniqueIdx: uniqueIndex('mastery_records_student_objective_unique_idx').on(
      table.studentUserId,
      table.objectiveId,
    ),
    studentStatusIdx: index('mastery_records_student_status_idx').on(
      table.studentUserId,
      table.status,
    ),
    nextReviewIdx: index('mastery_records_next_review_idx').on(table.nextReviewAt),
  }),
);

/**
 * Immutable mastery attempts (evidence for grading / remediation).
 *
 * `user_answer` 只保存学生自己的作答正文；`question_id` 指向题库题面，题面与标准
 * 答案不在本表。`hints_used` / `attempt_count` 参与质量扣分，是掌握度算法的输入。
 * `result`：`'correct' | 'incorrect' | 'partial'`；
 * `assessment_type`：`'quiz' | 'qualitative' | 'review'`；
 * `error_type`：`'structural' | 'deviation' | 'application' | 'metacognitive'`。
 */
export const masteryAttempts = pgTable(
  'mastery_attempts',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    objectiveId: text('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'cascade' }),
    planId: text('plan_id').references(() => learningPlans.id, { onDelete: 'cascade' }),
    questionId: text('question_id'),
    result: text('result').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    assessmentType: text('assessment_type').notNull().default('quiz'),
    errorType: text('error_type'),
    hintsUsed: integer('hints_used').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(1),
    /** 质量分（基点），已按提示 / 尝试次数扣减。 */
    qualityBasisPoints: integer('quality_basis_points'),
    userAnswer: text('user_answer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentObjectiveIdx: index('mastery_attempts_student_objective_idx').on(
      table.studentUserId,
      table.objectiveId,
    ),
    studentCreatedIdx: index('mastery_attempts_student_created_idx').on(
      table.studentUserId,
      table.createdAt,
    ),
  }),
);
