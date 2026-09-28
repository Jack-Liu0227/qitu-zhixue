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
import { projects } from './projects';

/**
 * Student-private growth records (文档 8.1 `growth_snapshots` 的可落地替代 / ADR 0006).
 *
 * 成长档案**没有客户端写路径**：只有服务端在阶段完成、作品发布、反思提交、目标掌握
 * 时追加。学生端与家长端读同一份真相，只是投影字段不同（`summary_student` vs
 * `summary_parent`）。
 *
 * 作用域与可见性：
 * - `visibility` 为 text 枚举，默认 `'student_private'`；家长可见只表示「家长投影
 *   可读」而非明文共享，家长仍需 active 监护关系与目的校验。
 * - `school_id` 由服务端写入；`project_id` 可空（无项目关联的成长也允许）。
 * - `idempotency_key` 唯一：同一阶段完成 / 同一作品发布重试时只落一条。
 *
 * 与 `tutor_growth_signals` 的关系：后者是 AI 搭档工作区的轻量信号（已有 0007）。
 * 本表是成长档案真源，字段更完整；两者暂时并存，收敛见 `docs/DATABASE.md`。
 */
export const growthRecords = pgTable(
  'growth_records',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    /**
     * `'project_stage_completed' | 'artifact_published' | 'reflection_created' |
     *  'objective_mastered' | 'plan_confirmed' | 'theory_milestone'`（可扩展）。
     */
    type: text('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    title: text('title').notNull(),
    summaryStudent: text('summary_student').notNull(),
    summaryParent: text('summary_parent').notNull(),
    /** 项目阶段快照（`ProjectStage`），可空。 */
    stage: text('stage'),
    /** 作品引用（对象存储 key / 作品 id），不含凭据。 */
    artifactRef: text('artifact_ref'),
    objectiveTitles: jsonb('objective_titles')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 服务端证据引用（`sourceKind:opaqueId`）。 */
    evidenceRefs: jsonb('evidence_refs')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** `'server' | 'tutor' | 'mentor'`；记录产生来源，便于追溯。 */
    source: text('source').notNull().default('server'),
    /** `'student_private' | 'guardian_visible' | 'mentor_visible'`。 */
    visibility: text('visibility').notNull().default('student_private'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('growth_records_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    studentOccurredIdx: index('growth_records_student_occurred_idx').on(
      table.studentUserId,
      table.occurredAt,
    ),
    projectIdx: index('growth_records_project_idx').on(table.projectId),
    typeIdx: index('growth_records_type_idx').on(table.type),
  }),
);

/**
 * Student-private memory entries (canonical domain memory).
 *
 * 与 `tutor_memories`（AI 搭档工作区）区分：本表是领域侧的学生私有记忆，不强制绑定
 * 某个 AI partner，`partner_id` 可空；`kind` 描述记忆类型，`source` 记录来源。
 *
 * 未成年人数据最小化：
 * - 默认 `visibility = 'student_private'`；
 * - 不保存原始对话 / 语音，只保存带证据的简短结论；
 * - `idempotency_key` 唯一，重复写入幂等。
 */
export const studentMemories = pgTable(
  'student_memories',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    /** 可空：领域记忆不必绑定具体 AI partner。 */
    partnerId: text('partner_id'),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    confidenceBasisPoints: integer('confidence_basis_points').notNull().default(600),
    source: text('source').notNull(),
    /** `'student_private' | 'guardian_visible' | 'mentor_visible'`。 */
    visibility: text('visibility').notNull().default('student_private'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('student_memories_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    studentIdx: index('student_memories_student_idx').on(table.studentUserId),
    updatedIdx: index('student_memories_updated_idx').on(table.updatedAt),
  }),
);
