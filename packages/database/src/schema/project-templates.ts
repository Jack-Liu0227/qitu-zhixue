import {
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

/** `TemplateStage` 的持久化形状，与 `@qitu/contracts` 的 `TemplateStage` 对齐。 */
export interface ProjectTemplateStage {
  id: string;
  label: string;
}

/**
 * Shared, verifiable project template library (文档 7.4 / ADR 0006).
 *
 * 与 `tutor_template_documents`（AI 搭档工作区里的轻量文档）不同：本表是**正式
 * 模板库**，带领域 / 年龄 / 难度 / 材料 / 安全要求等结构字段，并区分
 * `draft → review → published → archived` 生命周期。
 *
 * 作用域：
 * - `school_id IS NULL`：平台共享模板，全平台可见（受 `status` 门控）；
 * - `school_id = <id>`：某校自有模板，只对本校可见。
 *
 * 唯一性用**部分索引**表达：平台共享模板按 `slug` 唯一；校级模板按
 * `(school_id, slug)` 唯一。因为 Postgres 唯一索引中 NULL 互不相等，不能用一条
 * 普通唯一索引同时覆盖两种作用域。
 *
 * 写入归属：Admin / 模板治理模块；`created_by` / `verified_by` 只记录人，不构成
 * 授权（后端仍需对象级校验）。
 */
export const projectTemplates = pgTable(
  'project_templates',
  {
    id: text('id').primaryKey(),
    /** NULL = 平台共享；否则为校属模板。 */
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    domain: text('domain'),
    ageRange: text('age_range'),
    difficulty: text('difficulty'),
    estimatedDurationMinutes: integer('estimated_duration_minutes'),
    requiredMaterials: jsonb('required_materials')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    learningObjectives: jsonb('learning_objectives')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    outcomeForm: text('outcome_form'),
    safetyNotes: text('safety_notes'),
    /** `'draft' | 'review' | 'published' | 'archived'`；仅 `published` 可被推荐。 */
    status: text('status').notNull().default('draft'),
    createdBy: text('created_by').references(() => users.id),
    verifiedBy: text('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 平台共享模板（school_id IS NULL）在平台内 slug 唯一。
    platformSlugUniqueIdx: uniqueIndex('project_templates_platform_slug_unique_idx')
      .on(table.slug)
      .where(sql`${table.schoolId} is null`),
    // 校级模板在 (school_id, slug) 内唯一。
    schoolSlugUniqueIdx: uniqueIndex('project_templates_school_slug_unique_idx')
      .on(table.schoolId, table.slug)
      .where(sql`${table.schoolId} is not null`),
    schoolIdx: index('project_templates_school_idx').on(table.schoolId),
    statusIdx: index('project_templates_status_idx').on(table.status),
  }),
);

/**
 * Versioned snapshots of a project template.
 *
 * 「已经开始的项目固定引用原模板版本」：`projects.template_version_id` /
 * `exploration_sessions.template_version_id` 冻结引用这里的一行，模板发布新版本
 * **不改动**进行中的项目。
 *
 * `stages` 存该版本的阶段定义（`{ id, label }[]`），`content` 存理论模块 /
 * 实践任务 / 评价量规等结构化正文。是否可被推荐由 `status` 决定。
 */
export const projectTemplateVersions = pgTable(
  'project_template_versions',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => projectTemplates.id, { onDelete: 'restrict' }),
    version: text('version').notNull(),
    stages: jsonb('stages')
      .$type<ProjectTemplateStage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
    rubric: jsonb('rubric').notNull().default(sql`'[]'::jsonb`),
    /** `'draft' | 'review' | 'published' | 'archived'`。 */
    status: text('status').notNull().default('draft'),
    createdBy: text('created_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateVersionUniqueIdx: uniqueIndex(
      'project_template_versions_template_version_unique_idx',
    ).on(table.templateId, table.version),
    templateIdx: index('project_template_versions_template_idx').on(table.templateId),
    statusIdx: index('project_template_versions_status_idx').on(table.status),
  }),
);
