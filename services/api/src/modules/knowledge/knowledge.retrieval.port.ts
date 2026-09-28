import type {
  KnowledgeRetrievalHit,
  KnowledgeRetrievalRequest,
  RetrievalCandidate,
} from './knowledge.types';

/**
 * 检索端口。
 *
 * 检索实现与授权 / 持久化解耦：服务层先按作用域与 `verified` 过滤出候选，
 * 再把候选交给 `RetrievalPort` 排序。当前默认实现是**确定性关键词检索**；
 * pgvector 接入后，用同一接口替换为向量或混合检索，服务层与对 AI 搭档暴露的
 * 证据合同都不需要改（见 `docs/AI搭档SDK架构落地说明.md` 检索边界）。
 */
export abstract class RetrievalPort {
  abstract retrieve(
    request: KnowledgeRetrievalRequest,
    candidates: readonly RetrievalCandidate[],
  ): readonly KnowledgeRetrievalHit[];
}

const CJK_RUN = /[\u3400-\u9fff]+/g;
const SPLIT = /[\s,，。；;：:!！?？、()（）[\]【】"'“”‘’<>《》|/\\\-+*=~`@#$%^&{}]+/;

/**
 * 查询词归一化：小写、按标点 / 空白切分，并对中文片段补二元组（bigram），
 * 让中文查询也能命中部分词组，同时保持**完全确定**（同一输入永远同一输出）。
 *
 * 纯函数，可直接单测。
 */
export function extractQueryTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const rawToken of text.toLowerCase().split(SPLIT)) {
    const token = rawToken.trim();
    if (token.length === 0) continue;
    terms.add(token);
    const cjkRuns = token.match(CJK_RUN);
    if (cjkRuns === null) continue;
    for (const run of cjkRuns) {
      for (let index = 0; index + 1 < run.length; index += 1) {
        terms.add(run.slice(index, index + 2));
      }
      if (run.length === 1) terms.add(run);
    }
  }
  return [...terms];
}

interface Haystack {
  title: string;
  summary: string;
  tags: string;
  body: string;
}

function buildHaystack(candidate: RetrievalCandidate): Haystack {
  const { document, chunks } = candidate;
  const chunkText = chunks.map((chunk) => chunk.content).join('\n');
  return {
    title: document.title.toLowerCase(),
    summary: document.summary.toLowerCase(),
    tags: document.tags.join(' ').toLowerCase(),
    body: `${document.content}\n${chunkText}`.toLowerCase(),
  };
}

/**
 * 确定性关键词检索。
 *
 * - 空查询返回空结果（不把整个知识库倒给模型）；
 * - 无命中词的候选被排除；
 * - 打分 = 字段加权命中（title 3 / tags 2.5 / summary 2 / 正文 1）归一到 0–1，
 *   混入命中覆盖率；
 * - 同分按 `document.id` 升序，保证跨进程、跨调用完全可复现。
 */
export class KeywordRetrievalPort extends RetrievalPort {
  retrieve(
    request: KnowledgeRetrievalRequest,
    candidates: readonly RetrievalCandidate[],
  ): readonly KnowledgeRetrievalHit[] {
    const terms = extractQueryTerms(request.text);
    if (terms.length === 0) return [];

    const scored: KnowledgeRetrievalHit[] = [];
    for (const candidate of candidates) {
      const haystack = buildHaystack(candidate);
      let weighted = 0;
      let matchedCount = 0;
      const matchedTerms: string[] = [];
      for (const term of terms) {
        let weight = 0;
        if (haystack.title.includes(term)) weight = 3;
        else if (haystack.tags.includes(term)) weight = 2.5;
        else if (haystack.summary.includes(term)) weight = 2;
        else if (haystack.body.includes(term)) weight = 1;
        if (weight === 0) continue;
        matchedTerms.push(term);
        matchedCount += 1;
        weighted += weight;
      }
      if (matchedCount === 0) continue;
      const coverage = matchedCount / terms.length;
      const score = (weighted / (terms.length * 3)) * 0.7 + coverage * 0.3;
      scored.push({
        document: candidate.document,
        score: Number(score.toFixed(6)),
        matchedTerms: matchedTerms.sort(),
      });
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.document.id.localeCompare(right.document.id);
    });

    const limit = Math.max(0, Math.trunc(request.limit));
    return scored.slice(0, limit);
  }
}
