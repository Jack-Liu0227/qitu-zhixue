import { BadRequestException, Injectable } from '@nestjs/common';
import { realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseKnowledgeBaseConnection } from './knowledge-center.config';
import { KnowledgeCenterService } from './knowledge-center.service';

export interface LinkedProbeReceipt {
  ok: boolean;
  provider: string;
  version: string | null;
  docCount: number;
  embedding: { compatible: boolean | null };
  warnings: string[];
  errorCode?: string;
  realPath?: string;
  embeddingSignature?: string;
}

/** Server-side probe for an already-built local index. It never copies or mutates the index. */
@Injectable()
export class KnowledgeLinkProbeService {
  constructor(private readonly center: KnowledgeCenterService) {}
  private roots(): string[] {
    return (process.env.QITU_KNOWLEDGE_LINK_ROOTS ?? process.env.QITU_KNOWLEDGE_DATA ?? '')
      .split(':')
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => resolve(root));
  }
  private within(path: string, root: string): boolean {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.includes('\\'));
  }
  async probe(provider: string, externalPath: string, expectedEmbeddingSignature?: string): Promise<LinkedProbeReceipt> {
    if (!['llamaindex', 'graphrag', 'lightrag'].includes(provider))
      return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'REMOTE_CONNECTION_UNSUPPORTED' };
    const roots = this.roots();
    if (!roots.length) return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_PATH_NOT_ALLOWED' };
    let path: string;
    try { path = await realpath(externalPath); } catch { return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' }; }
    const allowed = (await Promise.all(roots.map(async (root) => {
      try { return this.within(path, await realpath(root)); } catch { return false; }
    }))).some(Boolean);
    if (!allowed) return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_PATH_NOT_ALLOWED' };
    let entries: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(path);
    } catch { return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' }; }
    const versions = entries.filter((name) => /^version-\d+$/.test(name)).sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
    if (!versions.length) return { ok: false, provider, version: null, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' };
    const version = versions[0]!;
    let manifest: Record<string, unknown> = {};
    try {
      manifest = JSON.parse(await readFile(join(path, version, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      return { ok: false, provider, version, docCount: 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' };
    }
    if (manifest.status !== 'ready' && manifest.ready !== true)
      return { ok: false, provider, version, docCount: Number(manifest.docCount) || 0, embedding: { compatible: null }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' };
    const signature = typeof manifest.embeddingSignature === 'string' ? manifest.embeddingSignature : null;
    const compatible = Boolean(expectedEmbeddingSignature && signature === expectedEmbeddingSignature);
    if (!compatible) return { ok: false, provider, version, docCount: Number(manifest.docCount) || 0, embedding: { compatible: false }, warnings: [], errorCode: 'EMBEDDING_SIGNATURE_MISMATCH' };
    const docCount = Number.isInteger(manifest.docCount) && Number(manifest.docCount) >= 0 ? Number(manifest.docCount) : 0;
    if (docCount < 1) return { ok: false, provider, version, docCount, embedding: { compatible: true }, warnings: [], errorCode: 'LINKED_INDEX_NOT_READY' };
    return { ok: true, provider, version, docCount, embedding: { compatible: true }, warnings: [], realPath: path, embeddingSignature: signature! };
  }
  async probeRequest(body: unknown): Promise<LinkedProbeReceipt> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (Object.keys(input).some((key) => !['provider', 'externalPath'].includes(key)) || typeof input.provider !== 'string' || typeof input.externalPath !== 'string')
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: 'link-probe 请求无效' });
    const { config } = await this.center.configuration();
    const engine = Object.values(config.knowledgeEngines).find((item) => item.provider === input.provider && item.enabled);
    const expectedSignature = typeof engine?.config.embeddingModelRef === 'string' ? engine.config.embeddingModelRef : undefined;
    const result = expectedSignature
      ? await this.probe(input.provider, input.externalPath, expectedSignature)
      : { ok: false, provider: input.provider, version: null, docCount: 0, embedding: { compatible: false }, warnings: [], errorCode: 'MODEL_NOT_BOUND' };
    return {
      ok: result.ok,
      provider: result.provider,
      version: result.version,
      docCount: result.docCount,
      embedding: { ...result.embedding, ...(result.embeddingSignature ? { signature: result.embeddingSignature } : {}) },
      warnings: result.warnings,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    };
  }
  validateLinkedInput(provider: string, connection: unknown) {
    return parseKnowledgeBaseConnection(provider, 'link_existing', connection);
  }
}
