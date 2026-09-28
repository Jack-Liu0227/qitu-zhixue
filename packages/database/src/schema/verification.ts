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
import { projectTemplateVersions } from './project-templates';

/**
 * 单项验证检查结果，与 `services/api/src/modules/templates/templates.types.ts`
 * 的 `VerificationCheck` 形状对齐（database 包不 import API 模块，保持单向依赖）。
 *
 * `key`：`'project_completed' | 'theory_mastered' | 'practice_mastered' |
 *        'artifact_accepted' | 'mentor_approved'`。
 */
export interface TemplateVerificationCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** 证据引用来源种类，对应 `evidence_refs` 的 `sourceKind:opaqueId` 前缀。 */
export const VERIFICATION_EVIDENCE_SOURCE_KINDS = [
  'project',
  'objective',
  'artifact',
  'mentor_review',
] as const;

/**
 * Template verification runs: 模板版本晋升 `published` 前的**不可变**验证报告。
 *
 * 归属：模板治理（Admin / 授权教职工）。由服务端在 `verify` / `publish` 时写入，
 * 客户端没有写路径。`report` 的确定性评测是纯函数（`evaluateTemplateVerification`），
 * 本表只负责把「当时看到了什么证据、得到什么结论」落成可审计、可重放的一行。
 *
 * 不可变性：
 * - 只有 `created_at` / `evaluated_at`，**没有** `updated_at`；
 * - 同一 `idempotency_key` 重放命中唯一索引，不产生第二条 run；
 * - 结论 / 检查 / 证据引用随 run 冻结，后续掌握度变化不回写历史 run。
 *
 * 作用域：`school_id` 冗余自模板（`NULL` = 平台共享模板），用于按校过滤审计。
 * `evidence_refs` 同时以结构化行落 `template_verification_evidence`，便于反查来源。
 */
export const templateVerificationRuns = pgTable(
  'template_verification_runs',
  {
    id: text('id').primaryKey(),
    /** NULL = 平台共享模板的验证；非空 = 校属模板。 */
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    templateVersionId: text('template_version_id').notNull(),
    /** 评测结论；`false` 表示未通过晋升门槛。 */
    passed: boolean('passed').notNull().default(false),
    /** 完整检查快照（`VerificationCheck[]`），不可变。 */
    checks: jsonb('checks')
      .$type<TemplateVerificationCheck[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 归一化证据引用 `sourceKind:opaqueId`，与 evidence 行一一对应。 */
    evidenceRefs: jsonb('evidence_refs')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    evidenceCount: integer('evidence_count').notNull().default(0),
    /** 触发验证的操作者；只记录人，不构成授权（后端仍需对象级校验）。 */
    evaluatedBy: text('evaluated_by').references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateVersionFk: foreignKey({
      columns: [table.templateVersionId],
      foreignColumns: [projectTemplateVersions.id],
      name: 'template_verification_runs_template_version_id_fk',
    }),
    idempotencyUniqueIdx: uniqueIndex('template_verification_runs_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    versionEvaluatedIdx: index('template_verification_runs_version_evaluated_idx').on(
      table.templateVersionId,
      table.evaluatedAt,
    ),
    passedIdx: index('template_verification_runs_passed_idx').on(table.passed),
    schoolIdx: index('template_verification_runs_school_idx').on(table.schoolId),
  }),
);

/**
 * Immutable evidence refs backing a verification run.
 *
 * 每一行回答「这次评测引用了哪条服务端事实」：项目 / 目标 / 作品 / 班主任复核。
 * 只存不透明 id，**不复制**被引用实体的正文，避免未成年人数据二次暴露。
 *
 * `(run_id, check_key, source_kind, source_id)` 唯一：同一次 run 重放不会重复落证据。
 * 证据行随 run 级联删除（`.down.sql` 回滚时同样按依赖倒序）。
 *
 * `student_user_id` 可空：目标 / 作品 / 复核类证据可归属于某个学生。
 */
export const templateVerificationEvidence = pgTable(
  'template_verification_evidence',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    /** 冗余自 run，便于按校过滤证据。 */
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    /** 该证据支撑的检查项，对应 run.checks[].key。 */
    checkKey: text('check_key').notNull(),
    /** `'project' | 'objective' | 'artifact' | 'mentor_review'`。 */
    sourceKind: text('source_kind').notNull(),
    /** 被引用实体的不透明 id。 */
    sourceId: text('source_id').notNull(),
    studentUserId: text('student_user_id').references(() => users.id),
    /** 可选的人类可读说明（不含敏感正文）。 */
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runFk: foreignKey({
      columns: [table.runId],
      foreignColumns: [templateVerificationRuns.id],
      name: 'template_verification_evidence_run_id_fk',
    }).onDelete('cascade'),
    runRefUniqueIdx: uniqueIndex('template_verification_evidence_ref_unique_idx').on(
      table.runId,
      table.checkKey,
      table.sourceKind,
      table.sourceId,
    ),
    runIdx: index('template_verification_evidence_run_idx').on(table.runId),
    sourceIdx: index('template_verification_evidence_source_idx').on(
      table.sourceKind,
      table.sourceId,
    ),
    schoolIdx: index('template_verification_evidence_school_idx').on(table.schoolId),
  }),
);
