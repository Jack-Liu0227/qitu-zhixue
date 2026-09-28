import { createHash } from 'node:crypto';
import {
  MAX_CHUNK_CHARS,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeEvidence,
  type KnowledgeEvidenceDocument,
  type KnowledgeRetrievalHit,
  MAX_EVIDENCE_CONTENT_CHARS,
} from './knowledge.types';

/**
 * 纯文本 / 版本工具：确定性、无 IO，便于直接单测。
 */

/** 正文内容指纹。用于判断「内容是否真的变了」，从而决定是否升版本、重置校验。 */
export function computeKnowledgeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** 版本自增：`v1` → `v2`；不符合 `v{n}` 形态时退回 `v2`（保守地视为已修订）。 */
export function nextKnowledgeVersion(version: string): string {
  const match = /^v(\d+)$/.exec(version.trim());
  if (match === null) return 'v2';
  const current = Number.parseInt(match[1] ?? '1', 10);
  return `v${Number.isFinite(current) ? current + 1 : 2}`;
}

function hardSplit(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size));
  }
  return parts;
}

/**
 * 把正文按段落聚合成有界分块。
 *
 * - 段落优先；超长段落按 `MAX_CHUNK_CHARS` 硬切，保证单块有界；
 * - 分块 id 使用确定性 `${documentId}#${ordinal}`（写入时整体替换，不会冲突）；
 * - 不计算 token：没有绑定分词器时写 `null`，绝不写假值。
 */
export function chunkKnowledgeContent(
  documentId: string,
  content: string,
  now: Date,
): KnowledgeChunk[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const pieces: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      if (buffer.length > 0) {
        pieces.push(buffer);
        buffer = '';
      }
      pieces.push(...hardSplit(paragraph, MAX_CHUNK_CHARS));
      continue;
    }
    if (buffer.length === 0) {
      buffer = paragraph;
    } else if (buffer.length + paragraph.length + 1 <= MAX_CHUNK_CHARS) {
      buffer = `${buffer}\n${paragraph}`;
    } else {
      pieces.push(buffer);
      buffer = paragraph;
    }
  }
  if (buffer.length > 0) pieces.push(buffer);

  return pieces.map((piece, ordinal) => ({
    id: `${documentId}#${ordinal}`,
    documentId,
    ordinal,
    content: piece,
    tokenCount: null,
    embedding: null,
    embeddingModel: null,
    createdAt: now,
  }));
}

function bounded(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * 证据投影：把命中的文档裁剪成可安全注入模型上下文的有限证据。
 *
 * 保留独立的作用域类型（含 `school`），而不是直接借用 AI 搭档 SDK 的
 * `TutorTemplateScope`——后者没有 `school`，直接复用会静默丢信息。
 */
export function toKnowledgeEvidence(hit: KnowledgeRetrievalHit): KnowledgeEvidence {
  const document: KnowledgeDocument = hit.document;
  const projected: KnowledgeEvidenceDocument = {
    id: document.id,
    version: document.version,
    title: document.title,
    summary: bounded(document.summary, MAX_EVIDENCE_CONTENT_CHARS),
    tags: [...document.tags],
    content: bounded(document.content, MAX_EVIDENCE_CONTENT_CHARS),
    source: document.source,
    scope: document.scope,
    // 只有 verified 文档能进入检索。
    active: document.status === 'verified',
  };
  return {
    document: projected,
    score: hit.score,
    matchedTerms: [...hit.matchedTerms],
  };
}
