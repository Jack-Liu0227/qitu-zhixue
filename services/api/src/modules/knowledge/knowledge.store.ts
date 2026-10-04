import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeStatus,
  RetrievalCandidate,
} from './knowledge.types';

/**
 * 知识持久化端口。
 *
 * 服务层只依赖本抽象；demo/test 用内存实现，live 用 Postgres 实现（见
 * `knowledge.module.ts` 的工厂）。与 `ExplorationStore` 的双引擎思路一致：
 * - 有数据库连接 → `PostgresKnowledgeStore`；
 * - 无数据库且非 `live` → `InMemoryKnowledgeStore`；
 * - `live` 却无连接 → 启动即失败，绝不退化成内存假装持久化。
 */
export interface KnowledgeCandidateQuery {
  /** 当前主体；用于 `student` 作用域归属过滤。 */
  actorId: string;
  /** 当前主体学校；用于 `school` 作用域过滤。 */
  schoolId: string | null;
  /** 本次显式关联的项目（已通过授权）；未授权时为 `null`。 */
  projectId: string | null;
}

export abstract class KnowledgeStore {
  /** 只返回 `verified` 且在**粗粒度**作用域内可见的候选（细粒度授权由服务层再判）。 */
  abstract listVerifiedCandidates(query: KnowledgeCandidateQuery): Promise<RetrievalCandidate[]>;

  abstract findDocument(id: string): Promise<KnowledgeDocument | null>;

  /** Admin 控制面按治理用途读取有界文档投影；不返回全文正文。 */
  abstract listDocuments(): Promise<KnowledgeDocument[]>;

  /** 读取某文档的全部分块（按 ordinal 升序）。 */
  abstract findChunks(documentId: string): Promise<KnowledgeChunk[]>;

  /** 以文档为单位整体替换：写入文档元数据并重建其分块。 */
  abstract upsertDocument(
    document: KnowledgeDocument,
    chunks: readonly KnowledgeChunk[],
  ): Promise<void>;

  /** 只更新校验状态字段，不触碰正文 / 分块 / 版本。 */
  abstract setDocumentVerification(
    id: string,
    update: {
      status: KnowledgeStatus;
      verifiedBy: string | null;
      verifiedAt: Date | null;
      updatedAt: Date;
    },
  ): Promise<KnowledgeDocument | null>;
}

function cloneDocument(document: KnowledgeDocument): KnowledgeDocument {
  return { ...document, tags: [...document.tags] };
}

function cloneChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  return {
    ...chunk,
    embedding: chunk.embedding === null ? null : [...chunk.embedding],
  };
}

function matchesCoarseScope(document: KnowledgeDocument, query: KnowledgeCandidateQuery): boolean {
  switch (document.scope) {
    case 'system':
      return true;
    case 'school':
      return query.schoolId !== null && document.schoolId === query.schoolId;
    case 'project':
      return query.projectId !== null && document.projectId === query.projectId;
    case 'student':
      return document.ownerUserId === query.actorId;
    default:
      return false;
  }
}

/**
 * 内存实现：仅用于 demo / test。行为与 Postgres 实现保持一致的可观察结果
 * （同样的作用域粗过滤、同样的整体替换语义），避免两套引擎漂移。
 */
export class InMemoryKnowledgeStore extends KnowledgeStore {
  private readonly documents = new Map<string, KnowledgeDocument>();
  private readonly chunks = new Map<string, KnowledgeChunk[]>();

  /** 测试 / 演示用种入；深拷贝，调用方后续改动不影响存储。 */
  seed(document: KnowledgeDocument, chunks: readonly KnowledgeChunk[] = []): void {
    this.documents.set(document.id, cloneDocument(document));
    this.chunks.set(document.id, chunks.map(cloneChunk));
  }

  async listDocuments(): Promise<KnowledgeDocument[]> {
    return [...this.documents.values()].map(cloneDocument).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async listVerifiedCandidates(query: KnowledgeCandidateQuery): Promise<RetrievalCandidate[]> {
    return [...this.documents.values()]
      .filter((document) => document.status === 'verified')
      .filter((document) => matchesCoarseScope(document, query))
      .map((document) => ({
        document: cloneDocument(document),
        chunks: (this.chunks.get(document.id) ?? []).map(cloneChunk),
      }));
  }

  async findDocument(id: string): Promise<KnowledgeDocument | null> {
    const document = this.documents.get(id);
    return document === undefined ? null : cloneDocument(document);
  }

  async findChunks(documentId: string): Promise<KnowledgeChunk[]> {
    return (this.chunks.get(documentId) ?? [])
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(cloneChunk);
  }

  async upsertDocument(
    document: KnowledgeDocument,
    chunks: readonly KnowledgeChunk[],
  ): Promise<void> {
    const existing = this.documents.get(document.id);
    const createdAt = existing?.createdAt ?? document.createdAt;
    this.documents.set(document.id, cloneDocument({ ...document, createdAt }));
    this.chunks.set(document.id, chunks.map(cloneChunk));
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
    const existing = this.documents.get(id);
    if (existing === undefined) return null;
    const updated: KnowledgeDocument = {
      ...existing,
      status: update.status,
      verifiedBy: update.verifiedBy,
      verifiedAt: update.verifiedAt,
      updatedAt: update.updatedAt,
    };
    this.documents.set(id, updated);
    return cloneDocument(updated);
  }
}
