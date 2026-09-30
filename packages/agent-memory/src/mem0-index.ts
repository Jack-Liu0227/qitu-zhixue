import type { AgentMemoryRecord, MemoryIndexHit, MemoryIndexPort, MemoryNamespace } from './index.js';

export interface Mem0HttpIndexConfig {
  baseUrl: string;
  apiKey?: string;
  fetcher?: typeof fetch;
}

/**
 * Narrow Mem0 OSS HTTP adapter. Mem0 is an index only: local authorization and
 * version checks happen in AgentMemoryService before/after this adapter.
 */
export class Mem0HttpIndex implements MemoryIndexPort {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: Mem0HttpIndexConfig) {
    this.fetcher = config.fetcher ?? fetch;
  }

  async reconcile(record: AgentMemoryRecord): Promise<string | null> {
    if (record.status !== 'active') return null;
    const namespace = namespaceId({
      scope: record.scope,
      studentId: record.studentId,
      partnerId: record.partnerId,
    });
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/u, '')}/v3/memories/add/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: record.content }],
        user_id: namespace,
        agent_id: record.partnerId,
        metadata: {
          qitu_record_id: record.id,
          qitu_record_version: record.version,
          qitu_scope: record.scope,
        },
        infer: false,
      }),
    });
    if (!response.ok) throw new Error(`MEMORY_INDEX_HTTP_${response.status}`);
    try {
      const body = await response.json() as { results?: unknown[] };
      const first = body.results?.[0];
      return first !== null && typeof first === 'object' && typeof (first as Record<string, unknown>).id === 'string'
        ? ((first as Record<string, unknown>).id as string) : null;
    } catch {
      return null;
    }
  }

  async remove(record: AgentMemoryRecord): Promise<void> {
    if (!record.indexId) return;
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/u, '')}/v1/memories/${encodeURIComponent(record.indexId)}/`, {
      method: 'DELETE', headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) throw new Error(`MEMORY_INDEX_HTTP_${response.status}`);
  }

  async recall(namespace: MemoryNamespace, query: string, limit: number): Promise<MemoryIndexHit[]> {
    if (!query.trim()) return [];
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/u, '')}/v3/memories/search/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        query: query.slice(0, 360),
        filters: { user_id: namespaceId(namespace) },
        top_k: Math.max(1, Math.min(8, Math.trunc(limit))),
      }),
    });
    if (!response.ok) throw new Error(`MEMORY_INDEX_HTTP_${response.status}`);
    const body = await response.json() as { results?: unknown[] };
    return (body.results ?? []).flatMap((item): MemoryIndexHit[] => {
      if (item === null || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const metadata = row.metadata;
      if (metadata === null || typeof metadata !== 'object') return [];
      const meta = metadata as Record<string, unknown>;
      return typeof meta.qitu_record_id === 'string' && typeof meta.qitu_record_version === 'number'
        ? [{ recordId: meta.qitu_record_id, version: meta.qitu_record_version, score: typeof row.score === 'number' ? row.score : 0 }]
        : [];
    });
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.config.apiKey ? { authorization: `Token ${this.config.apiKey}` } : {}),
    };
  }
}

function namespaceId(namespace: MemoryNamespace): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(JSON.stringify([namespace.scope, namespace.studentId, namespace.partnerId]))));
}
