import {
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

/** 项目证据三列，对应 `docs/student/projects.md` 的
 * `ProjectEvidence { independent, aiHelped, difficulties }`。 */
export const PROJECT_EVIDENCE_COLUMN_KINDS = ['independent', 'ai_helped', 'difficulty'] as const;

/** 服务端认可的聚合来源，客户端不能直接 POST 证据（见 `growth.evidence` 白名单）。 */
export const PROJECT_EVIDENCE_SOURCE_KINDS = [
  'task_submission',
  'tutor_turn',
  'escalation_event',
  'reflection',
  'mastery_attempt',
  'artifact',
] as const;

/**
 * Artifacts: 学生可发布的作品（作品展厅的真源）。
 *
 * 归属：Works。只有服务端在项目阶段推进 / 学生确认发布后写入，学生与客户端都
 * 不能直接改写 `status` / `visibility`。
 *
 * 未成年人数据最小化：
 * - `visibility` 默认 `'student_private'`；`'public'` 需要服务端按校规与监护确认放行，
 *   数据库不提供绕过入口；
 * - 只存作品元数据，正文 / 二进制在私有对象存储，经签名 URL 访问；
 * - `published_at` 由服务端写入，是「已发布」的唯一证明。
 *
 * `idempotency_key` 唯一：发布 / 撤回重试只落一条作品记录。
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    /** 冻结的项目模板版本引用（若有），发布后不漂移。 */
    templateVersionId: text('template_version_id'),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    /** `'draft' | 'submitted' | 'in_review' | 'published' | 'changes_requested' | 'archived'`。 */
    status: text('status').notNull().default('draft'),
    /** `'student_private' | 'mentor_visible' | 'class' | 'school' | 'public'`。 */
    visibility: text('visibility').notNull().default('student_private'),
    /** 当前展示版本序号（对应 `artifact_versions.ordinal`）；服务端维护。 */
    currentVersionIndex: integer('current_version_index').notNull().default(0),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    idempotencyKey: text('idempotency_key').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('artifacts_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    studentStatusIdx: index('artifacts_student_status_idx').on(
      table.studentUserId,
      table.status,
    ),
    projectIdx: index('artifacts_project_idx').on(table.projectId),
    visibilityIdx: index('artifacts_visibility_idx').on(table.visibility),
    // 显式短名，避免 Postgres 63 字符截断（见 ADR 0006 迁移注意）。
    templateVersionFk: foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [projectTemplateVersions.id],
      name: 'artifacts_template_version_id_fk',
    }),
  }),
);

/**
 * Immutable artifact versions: 「版本历程」的每一步。
 *
 * 每次修订追加一行，`(artifact_id, ordinal)` 唯一；已发布版本不原地改写。
 * `object_key` / `thumbnail_ref` 只存对象存储引用，不含凭据。
 */
export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    /** 对象存储 key（不透明引用，不含签名 / 凭据）。 */
    objectKey: text('object_key'),
    /** 封面缩略图引用。 */
    thumbnailRef: text('thumbnail_ref'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    artifactOrdinalUniqueIdx: uniqueIndex('artifact_versions_artifact_ordinal_unique_idx').on(
      table.artifactId,
      table.ordinal,
    ),
    artifactIdx: index('artifact_versions_artifact_idx').on(table.artifactId),
  }),
);

/**
 * Project evidence: 服务端聚合、**只读**的项目证据三列。
 *
 * 硬规则（本设计最重要的一条）：学生与客户端都不能直接 POST 证据，否则
 * 「AI 帮助我的」可以手填，成长档案失去证据价值。本表由服务端从任务提交 /
 * AI turn / 升级事件 / 反思 / 判分等真实事实派生。
 *
 * 幂等：没有客户端幂等键，靠 `(project_id, column_kind, source_kind, source_id)`
 * 唯一索引保证同一事实只物化一行（重复聚合 `ON CONFLICT DO NOTHING`）。
 */
export const projectEvidence = pgTable(
  'project_evidence',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    artifactId: text('artifact_id').references(() => artifacts.id),
    /** `'independent' | 'ai_helped' | 'difficulty'`。 */
    columnKind: text('column_kind').notNull(),
    /** `'task_submission' | 'tutor_turn' | 'escalation_event' | 'reflection' |
     *   'mastery_attempt' | 'artifact'`。 */
    sourceKind: text('source_kind').notNull(),
    /** 被引用事实的不透明 id。 */
    sourceId: text('source_id').notNull(),
    label: text('label').notNull(),
    /** 可选摘要；不含原始对话 / 语音。 */
    detail: text('detail'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFactUniqueIdx: uniqueIndex('project_evidence_fact_unique_idx').on(
      table.projectId,
      table.columnKind,
      table.sourceKind,
      table.sourceId,
    ),
    projectColumnIdx: index('project_evidence_project_column_idx').on(
      table.projectId,
      table.columnKind,
    ),
    studentIdx: index('project_evidence_student_idx').on(table.studentUserId),
    sourceIdx: index('project_evidence_source_idx').on(table.sourceKind, table.sourceId),
  }),
);
