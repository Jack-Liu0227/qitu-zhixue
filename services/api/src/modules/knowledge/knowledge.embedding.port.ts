import { KNOWLEDGE_EMBED_USAGE_ID } from './knowledge.types';

/**
 * 向量化端口 —— 为 `ModelGateway` 的 `knowledge.embed` 用途预留。
 *
 * 边界说明（`docs/shared/ARCHITECTURE.md` §5、`docs/admin/LLM_MODEL_REGISTRY.md` §8.6）：
 * - 当前 `ModelGateway` 只实现非流式 `complete`，**没有** embedding 能力；
 * - 因此本模块先用确定性关键词检索，向量化通过本端口预留，**不**在知识模块内
 *   自造 HTTP 调用或复制凭证；
 * - 接入时提供一个 `EmbeddingProvider` 适配器，内部调用
 *   `ModelGateway.complete('knowledge.embed', ...)`（或未来的 embedding 方法），
 *   再把返回向量写入 `knowledge_chunks.embedding` / `embedding_model`，并把
 *   `RetrievalPort` 换成混合检索。这属于 pgvector 后续任务。
 */
export interface EmbeddingResult {
  vector: readonly number[];
  model: string;
}

export abstract class EmbeddingProvider {
  abstract readonly usageId: typeof KNOWLEDGE_EMBED_USAGE_ID;
  /** 是否已绑定可用模型；未绑定时调用方必须显式降级为关键词检索。 */
  abstract isConfigured(): boolean;
  /** 批量向量化；未配置时 **fail closed**，由调用方决定是否回退。 */
  abstract embed(texts: readonly string[]): Promise<readonly EmbeddingResult[]>;
}

/** 向量化不可用（未绑定 `knowledge.embed` 或 pgvector 未接入）。 */
export class KnowledgeEmbeddingUnavailableError extends Error {
  readonly code = 'KNOWLEDGE_UNAVAILABLE' as const;
  constructor(message = '向量化不可用：knowledge.embed 尚未接入 ModelGateway（pgvector 待办）') {
    super(message);
    this.name = 'KnowledgeEmbeddingUnavailableError';
  }
}

/**
 * 预留实现：当前明确不可用，绝不假装成功。
 *
 * 保留它有两个作用：一是把接口形状固定下来，接入时不改调用方；二是让
 * 「未接入」成为可断言的事实（`isConfigured() === false`），而不是静默空向量。
 */
export class ReservedEmbeddingProvider extends EmbeddingProvider {
  readonly usageId = KNOWLEDGE_EMBED_USAGE_ID;

  isConfigured(): boolean {
    return false;
  }

  async embed(_texts: readonly string[]): Promise<readonly EmbeddingResult[]> {
    void _texts;
    throw new KnowledgeEmbeddingUnavailableError();
  }
}
