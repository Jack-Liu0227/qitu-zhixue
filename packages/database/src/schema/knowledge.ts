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
 * Canonical, scoped knowledge base (文档 8.1 / 8.2 / ADR 0006).
 *
 * 这是**知识库真源**：系统知识、校本知识、项目知识与学生私有知识共用一张表，
 * 用 `scope` + `school_id` + `project_id` + `owner_user_id` 表达可见范围。
 *
 * 作用域判定（后端对象级授权必须再次校验，前端隐藏不算授权）：
 * - `scope = 'system'`：平台知识，全平台可读；`school_id` 应为 NULL。
 * - `scope = 'school'`：校本知识，仅同校可读；`school_id` 必填。
 * - `scope = 'project'`：项目知识，仅该项目相关方可见；`project_id` 必填。
 * - `scope = 'student'`：学生私有知识，仅学生本人（及明确授权者）可见；
 *   `owner_user_id` 必填。
 *
 * 与 `tutor_knowledge_documents` 的关系：后者是 AI 搭档工作区的轻量适配层
 * （已有 0007 迁移与 seed）。本表是正式知识库，带版本、校验状态与分块索引；
 * 两者暂时并存，迁移计划见 `docs/DATABASE.md`。
 *
 * 向量检索：pgvector 尚未接入，`knowledge_chunks.embedding` 暂以 JSONB 保存
 * 占位向量，待维度 / HNSW 方案确定后由新迁移改为 `vector(n)` 列（见 ADR 0006
 * 未决事项），不在此破坏性变更。
 */
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    /** NULL 仅允许 `scope='system'`。 */
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    /** `'system' | 'school' | 'project' | 'student'`。 */
    scope: text('scope').notNull(),
    /** 私有 / 归属学习者；`scope='student'` 时必填。 */
    ownerUserId: text('owner_user_id').references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    content: text('content').notNull(),
    /** 来源标识（如 `qitu-curriculum-policy`、上传文件名）。 */
    source: text('source').notNull(),
    /** 来源对象引用（如对象存储 key / 外部文档 id），不含凭据。 */
    sourceRef: text('source_ref'),
    /** 正文校验和，用于检测内容漂移。 */
    checksum: text('checksum'),
    version: text('version').notNull().default('v1'),
    /** `'draft' | 'verified' | 'archived'`；只有 `verified` 可进入检索。 */
    status: text('status').notNull().default('draft'),
    verifiedBy: text('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeIdx: index('knowledge_documents_scope_idx').on(table.schoolId, table.scope),
    projectIdx: index('knowledge_documents_project_idx').on(table.projectId),
    ownerIdx: index('knowledge_documents_owner_idx').on(table.ownerUserId),
    statusIdx: index('knowledge_documents_status_idx').on(table.status),
  }),
);

/**
 * Knowledge chunks: the retrieval unit for a document.
 *
 * `ordinal` 在文档内严格递增并由唯一索引兜底，保证重建索引时顺序稳定。
 * `embedding` / `embedding_model` 是**临时 JSONB 槽位**（pgvector 未接入）：
 * 不保存任何密钥，也不作为授权依据。
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    /** 临时占位；pgvector 接入后由新迁移替换为 `vector(n)`。 */
    embedding: jsonb('embedding').$type<number[]>(),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentOrdinalUniqueIdx: uniqueIndex('knowledge_chunks_document_ordinal_unique_idx').on(
      table.documentId,
      table.ordinal,
    ),
    documentIdx: index('knowledge_chunks_document_idx').on(table.documentId),
  }),
);
