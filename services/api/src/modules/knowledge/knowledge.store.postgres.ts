import { and, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '@qitu/database';
import { knowledgeChunks, knowledgeDocuments } from '@qitu/database';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeStatus,
  RetrievalCandidate,
} from './knowledge.types';
import { KnowledgeStore, type KnowledgeCandidateQuery } from './knowledge.store';

type DocumentRow = typeof knowledgeDocuments.$inferSelect;
type ChunkRow = typeof knowledgeChunks.$inferSelect;

function toDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    schoolId: row.schoolId,
    scope: row.scope as KnowledgeDocument['scope'],
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    title: row.title,
    summary: row.summary,
    tags: [...row.tags],
    content: row.content,
    source: row.source,
    sourceRef: row.sourceRef,
    checksum: row.checksum,
    version: row.version,
    status: row.status as KnowledgeStatus,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    documentId: row.documentId,
    ordinal: row.ordinal,
    content: row.content,
    tokenCount: row.tokenCount,
    embedding: row.embedding ?? null,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
  };
}

/**
 * PostgreSQL 实现：读写 canonical `knowledge_documents` / `knowledge_chunks`。
 *
 * - 检索候选在 SQL 层就按 `status='verified'` 与作用域粗过滤，绝不把草稿
 *   或他校 / 他人文档取回进程；
 * - 写入以事务整体替换文档分块（`document_id` 唯一序号索引兜底顺序稳定）；
 * - 不在此层做对象级授权（服务层纯规则判定），避免两份授权逻辑漂移。
 */
export class PostgresKnowledgeStore extends KnowledgeStore {
  constructor(private readonly db: Database) {
    super();
  }

  async listVerifiedCandidates(query: KnowledgeCandidateQuery): Promise<RetrievalCandidate[]> {
    const scopeConditions = [
      eq(knowledgeDocuments.scope, 'system'),
      ...(query.schoolId === null
        ? []
        : [
            and(
              eq(knowledgeDocuments.scope, 'school'),
              eq(knowledgeDocuments.schoolId, query.schoolId),
            ),
          ]),
      ...(query.projectId === null
        ? []
        : [
            and(
              eq(knowledgeDocuments.scope, 'project'),
              eq(knowledgeDocuments.projectId, query.projectId),
            ),
          ]),
      and(eq(knowledgeDocuments.scope, 'student'), eq(knowledgeDocuments.ownerUserId, query.actorId)),
    ];

    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(
        and(eq(knowledgeDocuments.status, 'verified'), or(...scopeConditions)),
      );
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const chunkRows = await this.db
      .select()
      .from(knowledgeChunks)
      .where(inArray(knowledgeChunks.documentId, ids))
      .orderBy(knowledgeChunks.documentId, knowledgeChunks.ordinal);

    const chunksByDocument = new Map<string, KnowledgeChunk[]>();
    for (const chunk of chunkRows) {
      const list = chunksByDocument.get(chunk.documentId);
      if (list === undefined) chunksByDocument.set(chunk.documentId, [toChunk(chunk)]);
      else list.push(toChunk(chunk));
    }

    return rows.map((row) => ({
      document: toDocument(row),
      chunks: chunksByDocument.get(row.id) ?? [],
    }));
  }

  async findDocument(id: string): Promise<KnowledgeDocument | null> {
    const rows = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }

  async findChunks(documentId: string): Promise<KnowledgeChunk[]> {
    const rows = await this.db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, documentId))
      .orderBy(knowledgeChunks.ordinal);
    return rows.map(toChunk);
  }

  async upsertDocument(
    document: KnowledgeDocument,
    chunks: readonly KnowledgeChunk[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(knowledgeDocuments)
        .values({
          id: document.id,
          schoolId: document.schoolId,
          scope: document.scope,
          ownerUserId: document.ownerUserId,
          projectId: document.projectId,
          title: document.title,
          summary: document.summary,
          tags: [...document.tags],
          content: document.content,
          source: document.source,
          sourceRef: document.sourceRef,
          checksum: document.checksum,
          version: document.version,
          status: document.status,
          verifiedBy: document.verifiedBy,
          verifiedAt: document.verifiedAt,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        })
        .onConflictDoUpdate({
          target: knowledgeDocuments.id,
          set: {
            schoolId: document.schoolId,
            scope: document.scope,
            ownerUserId: document.ownerUserId,
            projectId: document.projectId,
            title: document.title,
            summary: document.summary,
            tags: [...document.tags],
            content: document.content,
            source: document.source,
            sourceRef: document.sourceRef,
            checksum: document.checksum,
            version: document.version,
            status: document.status,
            verifiedBy: document.verifiedBy,
            verifiedAt: document.verifiedAt,
            updatedAt: document.updatedAt,
          },
        });

      await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, document.id));
      if (chunks.length > 0) {
        await tx.insert(knowledgeChunks).values(
          chunks.map((chunk) => ({
            id: chunk.id,
            documentId: chunk.documentId,
            ordinal: chunk.ordinal,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            embedding: chunk.embedding === null ? null : [...chunk.embedding],
            embeddingModel: chunk.embeddingModel,
            createdAt: chunk.createdAt,
          })),
        );
      }
    });
  }

  async setDocumentVerification(
    id: string,
    update: {
      status: KnowledgeStatus;
      verifiedBy: string | null;
      verifiedAt: Date | null;
      updatedAt: Date;
    },
  ): Promise<KnowledgeDocument | null> {
    const rows = await this.db
      .update(knowledgeDocuments)
      .set({
        status: update.status,
        verifiedBy: update.verifiedBy,
        verifiedAt: update.verifiedAt,
        updatedAt: update.updatedAt,
      })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }
}
