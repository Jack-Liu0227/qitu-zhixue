export interface ImaKnowledgeScope {
  /** Frozen project ceiling intersected with current Admin permissions, resolved on every call. */
  knowledgeBaseIds(): Promise<readonly string[]>;
}

/** Per-turn bounded provenance. Old references must be retrieved again in a new turn. */
export function createImaScopeGuard(scope: ImaKnowledgeScope, now = Date.now) {
  const references = new Map<string, { kb: string; expires: number }>();
  return {
    async before(name: string, args: Record<string, unknown>): Promise<string | null> {
      const allowed = await scope.knowledgeBaseIds();
      if (!allowed.length) throw new Error('IMA_PROJECT_SCOPE_DENIED');
      if (name === 'ima_list_knowledge_bases') return null;
      if (name === 'ima_read_document') {
        const provenance = typeof args.document_ref === 'string' ? references.get(args.document_ref) : undefined;
        if (!provenance || provenance.expires <= now() || !allowed.includes(provenance.kb)) {
          throw new Error('IMA_DOCUMENT_PROVENANCE_REQUIRED');
        }
        if (args.knowledge_base_id !== undefined && args.knowledge_base_id !== provenance.kb) throw new Error('IMA_PROJECT_SCOPE_DENIED');
        return provenance.kb;
      }
      if (typeof args.knowledge_base_id !== 'string' || !allowed.includes(args.knowledge_base_id)) throw new Error('IMA_PROJECT_SCOPE_DENIED');
      return args.knowledge_base_id;
    },
    async after(name: string, kb: string | null, text: string): Promise<string> {
      const allowed = await scope.knowledgeBaseIds();
      if (kb && !allowed.includes(kb)) throw new Error('IMA_PROJECT_SCOPE_REVOKED');
      const result: unknown = JSON.parse(text);
      if (!record(result)) throw new Error('IMA_SCOPE_RESPONSE_INVALID');
      if (name === 'ima_list_knowledge_bases') {
        if (!Array.isArray(result.knowledge_bases)) throw new Error('IMA_SCOPE_RESPONSE_INVALID');
        return JSON.stringify({ knowledge_bases: result.knowledge_bases.filter(item => record(item) && typeof item.knowledge_base_id === 'string' && allowed.includes(item.knowledge_base_id)) });
      }
      // A response cannot introduce another KB or claim provenance for an unrequested resource.
      const inspect = (value: unknown, depth: number) => {
        if (depth > 12) throw new Error('IMA_SCOPE_RESPONSE_INVALID');
        if (Array.isArray(value)) { value.forEach(item => inspect(item, depth + 1)); return; }
        if (!record(value)) return;
        if (value.knowledge_base_id !== undefined && value.knowledge_base_id !== kb) throw new Error('IMA_PROJECT_SCOPE_DENIED');
        for (const child of Object.values(value)) if (typeof child === 'object' && child !== null) inspect(child, depth + 1);
      };
      inspect(result, 0);
      if (name !== 'ima_read_document' && kb && Array.isArray(result.items)) {
        for (const item of result.items.slice(0, 64)) {
          if (!record(item) || typeof item.document_ref !== 'string' || item.document_ref.length > 16_000) continue;
          if (references.size >= 64) references.delete(references.keys().next().value!);
          references.set(item.document_ref, { kb, expires: now() + 15 * 60_000 });
        }
      }
      return JSON.stringify(result);
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
