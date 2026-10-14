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

/**
 * P2 评估候选留痕：AI 评估方产出的**候选**（分数 + 逐条 criterion 理由）。
 *
 * 硬规则（AGENTS.md + 自动验收决策）：
 * - `source` 与 `status` 由**服务端**构造（`toAiProjectReviewCandidate` 写死
 *   `source='ai'`），客户端没有任何写入路径；
 * - 候选与「门禁达成」是两件事：本表**不**表示通过。写 `team.gate.satisfied`
 *   的只有确定性规则（见 `project-review.ts` 的 `applyAutomaticAcceptance`）。
 *
 * `state` 是自动验收状态机（`pending_automatic_acceptance` / `accepted` /
 * `needs_evidence` / `returned` / `rejected`）——把契约里沿用的教师态
 * `ready_for_teacher` 重新表述为「等待**自动**验收」，教师路径作为兜底保留。
 *
 * 幂等：`candidate_key` 唯一（`candidate:<project>:<artifactVersion>:<rubric>@<version>`），
 * 同一份作品同一 rubric 只留一个候选；重复评估走 ON CONFLICT DO NOTHING。
 * 审计：每次候选写入/自动验收在 `audit_log` 留行（调用方写，不改本表语义）。
 */
export const workAssessmentCandidates = pgTable(
  'work_assessment_candidates',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    rubricId: text('rubric_id').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    /** `'ai' | 'teacher'`（AI 无法写入 `'teacher'`）。 */
    source: text('source').notNull(),
    /** AI 必须报出的模型 id；教师候选为 NULL。 */
    modelId: text('model_id'),
    /** 契约状态：`pending | needs_evidence | ready_for_teacher | accepted | returned | rejected`。 */
    status: text('status').notNull(),
    /** 自动验收状态（见文件头注释）：`pending_automatic_acceptance | accepted | needs_evidence | returned | rejected`。 */
    state: text('state').notNull(),
    score: integer('score'),
    /** 逐条 criterion 结果（只含 criterionId / level / 简短 rationale / evidenceRefs）。 */
    criteria: jsonb('criteria').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    /** 缺失证据 id 清单（非空则不得 accepted）。 */
    missingEvidenceIds: jsonb('missing_evidence_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 自动验收引用的证据（不透明 id，不含正文）。 */
    evidenceRef: text('evidence_ref'),
    /** 只有走确定性规则自动通过时才有值。 */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    /** 触发自动验收的规则标识与版本，便于追溯「谁做的决定」。 */
    acceptedByRule: text('accepted_by_rule'),
    /** 确定性幂等键（唯一）。 */
    candidateKey: text('candidate_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    candidateKeyUniqueIdx: uniqueIndex('work_assessment_candidates_key_unique_idx').on(table.candidateKey),
    projectIdx: index('work_assessment_candidates_project_idx').on(table.projectId),
    studentStateIdx: index('work_assessment_candidates_student_state_idx').on(table.studentUserId, table.state),
    versionIdx: index('work_assessment_candidates_version_idx').on(table.artifactVersionId),
  }),
);

/**
 * P2 证据「校验检查」留痕：确定性生产者的结论行（文档结构 / 视频合规 / 代码静态）。
 *
 * 一行 = 一次确定性检查的完整结论：校验器版本 + 被检字节 sha256 + verdict
 * + 结构化 findings。**不含媒体内容与报告正文**（未成年人数据最小化）。
 *
 * 幂等：`check_key` 唯一（`<kind>:<artifactVersionId>:<sha256|digest>`），
 * 同一份字节同一校验器只留一行。
 */
export const workValidationChecks = pgTable(
  'work_validation_checks',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    artifactId: text('artifact_id').references(() => artifacts.id, { onDelete: 'cascade' }),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    /** `'document_structure' | 'media_compliance' | 'code_static'`。 */
    kind: text('kind').notNull(),
    validatorVersion: text('validator_version').notNull(),
    /** 被检字节摘要（无字节时为 NULL：不可判定，不是失败）。 */
    sha256: text('sha256'),
    /** `passed | incomplete | compliant | non_compliant | unverifiable | syntax_ok | ...`。 */
    verdict: text('verdict').notNull(),
    /** 缺项 / issue 清单（稳定字符串）。 */
    findings: jsonb('findings').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 可读备注（不含媒体内容 / 报告正文）。 */
    notes: jsonb('notes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    checkKey: text('check_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checkKeyUniqueIdx: uniqueIndex('work_validation_checks_key_unique_idx').on(table.checkKey),
    versionKindIdx: index('work_validation_checks_version_kind_idx').on(table.artifactVersionId, table.kind),
    projectKindIdx: index('work_validation_checks_project_kind_idx').on(table.projectId, table.kind),
  }),
);
