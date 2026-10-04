import type { Role } from '@qitu/contracts';

/**
 * 作用域知识库（canonical `knowledge_documents` / `knowledge_chunks`）的领域类型。
 *
 * 本文件只放类型、常量与纯数据契约，不依赖 Nest / Drizzle，便于单测与复用。
 * 所有作用域字段的合法性由 `knowledge.scope-policy.ts` 的纯规则判定，授权在
 * 服务端对象级再次校验（前端隐藏不构成授权）。
 */

/** 与 `knowledge_documents.scope` 一一对应。 */
export type KnowledgeScope = 'system' | 'school' | 'project' | 'student';

/** 与 `knowledge_documents.status` 一一对应；只有 `verified` 可进入检索。 */
export type KnowledgeStatus = 'draft' | 'verified' | 'archived';

export const KNOWLEDGE_SCOPES: readonly KnowledgeScope[] = [
  'system',
  'school',
  'project',
  'student',
];

export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  'draft',
  'verified',
  'archived',
];

/** 检索 / 证据投影的边界；避免把整段知识灌进模型上下文。 */
export const DEFAULT_RETRIEVAL_LIMIT = 4;
export const MAX_RETRIEVAL_LIMIT = 8;
export const MAX_EVIDENCE_ITEMS = 4;
export const MAX_EVIDENCE_CONTENT_CHARS = 360;

/** 文档写入的字段长度上限（服务端校验，客户端不能自定）。 */
export const MAX_KNOWLEDGE_TITLE_LENGTH = 160;
export const MAX_KNOWLEDGE_SUMMARY_LENGTH = 600;
export const MAX_KNOWLEDGE_CONTENT_LENGTH = 20_000;
export const MAX_KNOWLEDGE_TAGS = 12;
export const MAX_KNOWLEDGE_TAG_LENGTH = 32;
export const MAX_KNOWLEDGE_SOURCE_LENGTH = 200;

/** 单个分块的软上限（按段落聚合，避免超过时不再切分）。 */
export const MAX_CHUNK_CHARS = 400;

/**
 * 预留的模型用途 id（`docs/README.md` §5 / `docs/admin/model-registry.md` §8.6）。
 * 向量检索接入 `ModelGateway` 时使用该用途，而不是在知识模块内自造模型调用。
 */
export const KNOWLEDGE_EMBED_USAGE_ID = 'knowledge.embed';

/**
 * 禁止进入共享知识路径的来源前缀。
 *
 * AI 搭档的原始对话 / 语音属于未成年人敏感数据，只能留在对话工作区，不能
 * 通过 `knowledge_documents` 变成“可检索知识”。这里在写入入口 **fail closed**，
 * 而不是靠约定或后续清洗。
 */
export const RESERVED_RAW_TUTOR_SOURCE_PREFIXES: readonly string[] = [
  'tutor_turn:',
  'tutor_conversation:',
  'tutor_raw_transcript:',
  'tutor_raw_audio:',
  'voice_raw:',
];

/** 知识文档的持久化投影。 */
export interface KnowledgeDocument {
  id: string;
  schoolId: string | null;
  scope: KnowledgeScope;
  ownerUserId: string | null;
  projectId: string | null;
  title: string;
  summary: string;
  tags: string[];
  content: string;
  source: string;
  sourceRef: string | null;
  checksum: string | null;
  version: string;
  status: KnowledgeStatus;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 知识分块（检索单元）。 */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  ordinal: number;
  content: string;
  tokenCount: number | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  createdAt: Date;
}

/** 检索候选：文档 + 其分块。 */
export interface RetrievalCandidate {
  document: KnowledgeDocument;
  chunks: readonly KnowledgeChunk[];
}

/** 检索请求（已由服务层做授权过滤与 verified 过滤之后才进入）。 */
export interface KnowledgeRetrievalRequest {
  text: string;
  limit: number;
}

/** 一次检索命中。 */
export interface KnowledgeRetrievalHit {
  document: KnowledgeDocument;
  score: number;
  matchedTerms: string[];
}

/** 证据投影文档：结构与 AI 搭档 SDK 的 `TutorKnowledgeDocument` 对齐。 */
export interface KnowledgeEvidenceDocument {
  id: string;
  version: string;
  title: string;
  summary: string;
  tags: string[];
  /** 已按 `MAX_EVIDENCE_CONTENT_CHARS` 截断。 */
  content: string;
  source: string;
  scope: KnowledgeScope;
  /** 只有 `verified` 会出现在检索结果里，因此恒为 `true`。 */
  active: boolean;
}

/** 面向 AI 搭档 `context_packet` 的有限证据。 */
export interface KnowledgeEvidence {
  document: KnowledgeEvidenceDocument;
  score: number;
  matchedTerms: string[];
}

/** 文档写入入参（作用域字段由服务端归一化 / 校验）。 */
export interface KnowledgeDocumentUpsertInput {
  /** 省略时由服务端生成。传入表示对既有文档的修订。 */
  id?: string;
  scope: KnowledgeScope;
  schoolId?: string | null;
  ownerUserId?: string | null;
  projectId?: string | null;
  title: string;
  summary?: string;
  tags?: readonly string[];
  content: string;
  source: string;
  sourceRef?: string | null;
}

/** 作用域四元组（写入策略判定的最小输入）。 */
export interface KnowledgeScopeFields {
  scope: KnowledgeScope;
  schoolId: string | null;
  ownerUserId: string | null;
  projectId: string | null;
}

/** 一次写入的结果类型。 */
export type KnowledgeMutationOutcome = 'created' | 'revised' | 'unchanged';

/** 文档投影（对外；不含全文正文）。 */
export interface KnowledgeDocumentView {
  id: string;
  scope: KnowledgeScope;
  schoolId: string | null;
  ownerUserId: string | null;
  projectId: string | null;
  title: string;
  summary: string;
  tags: string[];
  version: string;
  status: KnowledgeStatus;
  source: string;
  sourceRef: string | null;
  checksum: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  contentLength: number;
}

/** 写入 / 校验命令的响应。 */
export interface KnowledgeMutationResult {
  document: KnowledgeDocumentView;
  outcome: KnowledgeMutationOutcome;
  replayed: boolean;
}

/** 检索响应体。 */
export interface KnowledgeSearchResponse {
  evidence: KnowledgeEvidence[];
  limit: number;
}

/** 模块内稳定错误码；因契约 `ApiErrorCode` 暂未包含知识码，先在此定义。 */
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_NOT_FOUND'
  | 'KNOWLEDGE_FORBIDDEN'
  | 'KNOWLEDGE_SCOPE_INVALID'
  | 'KNOWLEDGE_INPUT_INVALID'
  | 'KNOWLEDGE_SOURCE_FORBIDDEN'
  | 'KNOWLEDGE_UNAVAILABLE';
