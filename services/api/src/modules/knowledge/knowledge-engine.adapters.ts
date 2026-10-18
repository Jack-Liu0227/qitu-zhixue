import { ImaMcpClient } from '../ai-tutor/ima-mcp.client';
import type { EngineConfig } from './knowledge-center.config';

export type EngineReadiness =
  'ready' | 'needs_key' | 'needs_setup' | 'not_installed' | 'unavailable' | 'unreachable';
export interface AdapterReceipt {
  ok: boolean;
  status: EngineReadiness;
  errorCode?: string;
  manifest?: Record<string, unknown>;
  checks?: { key: string; label: string; ok: boolean; detail: string; optional: boolean }[];
  hits?: {
    memberId: string;
    text: string;
    score: number | null;
    locator: Record<string, unknown> | null;
  }[];
}
export interface KnowledgeEngineAdapter {
  readonly provider: string;
  readiness(engine: EngineConfig): Promise<AdapterReceipt>;
  check(engine: EngineConfig): Promise<AdapterReceipt>;
  connect(engine: EngineConfig, externalRef: Record<string, string>): Promise<AdapterReceipt>;
  create(engine: EngineConfig, input: Record<string, unknown>): Promise<AdapterReceipt>;
  search(engine: EngineConfig, input: Record<string, unknown>): Promise<AdapterReceipt>;
}

function envCredential(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length >= 16 && !/[\r\n]/.test(value)) return value;
  }
  return null;
}
export class ImaKnowledgeAdapter implements KnowledgeEngineAdapter {
  readonly provider = 'ima';
  private readonly client = new ImaMcpClient();
  private configured() {
    return Boolean(process.env.QITU_IMA_MCP_URL && envCredential('QITU_IMA_MCP_TOKEN'));
  }
  private async tools() {
    return this.client.toolsFor([
      {
        serverId: 'ima-knowledge',
        label: 'ima',
        transport: 'streamable_http',
        toolIds: ['ima_list_knowledge_bases', 'ima_search_knowledge'],
      },
    ]);
  }
  async readiness(): Promise<AdapterReceipt> {
    if (!this.configured())
      return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    return this.check({} as EngineConfig);
  }
  async check(_engine?: EngineConfig): Promise<AdapterReceipt> {
    if (!this.configured())
      return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    try {
      const tool = (await this.tools()).find(
        (candidate) => candidate.name === 'ima_list_knowledge_bases',
      );
      if (!tool) return { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NEEDS_SETUP' };
      const response = await tool.execute({});
      if (response.isError)
        return { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
      const value = JSON.parse(response.text) as Record<string, unknown>;
      return Array.isArray(value.knowledge_bases)
        ? { ok: true, status: 'ready', manifest: { accessibleBases: value.knowledge_bases.length } }
        : { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    } catch {
      return { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    }
  }
  async connect(
    _engine: EngineConfig,
    externalRef: Record<string, string>,
  ): Promise<AdapterReceipt> {
    const checked = await this.check();
    if (!checked.ok) return checked;
    const id = externalRef.remoteKnowledgeBaseId;
    if (!id) return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_RESOURCE_NOT_FOUND' };
    try {
      const tool = (await this.tools()).find(
        (candidate) => candidate.name === 'ima_list_knowledge_bases',
      );
      const response = await tool?.execute({});
      const value = response && (JSON.parse(response.text) as Record<string, unknown>);
      const found =
        Array.isArray(value?.knowledge_bases) &&
        (value.knowledge_bases as Record<string, unknown>[]).some(
          (item) => item.knowledge_base_id === id,
        );
      return found
        ? { ok: true, status: 'ready' }
        : { ok: false, status: 'needs_setup', errorCode: 'REMOTE_RESOURCE_NOT_FOUND' };
    } catch {
      return { ok: false, status: 'unreachable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    }
  }
  async create(_engine?: EngineConfig, _input?: Record<string, unknown>): Promise<AdapterReceipt> {
    return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_CREATE_UNSUPPORTED' };
  }
  async search(engine: EngineConfig, input: Record<string, unknown>): Promise<AdapterReceipt> {
    const id = input.remoteKnowledgeBaseId ?? engine.config.remoteKnowledgeBaseId;
    if (
      typeof id !== 'string' ||
      !Array.isArray(engine.config.allowedKnowledgeBaseIds) ||
      !engine.config.allowedKnowledgeBaseIds.includes(id)
    )
      return { ok: false, status: 'needs_setup', errorCode: 'SOURCE_NOT_AUTHORIZED' };
    try {
      const tool = (await this.tools()).find((t) => t.name === 'ima_search_knowledge');
      if (!tool) return { ok: false, status: 'unavailable', errorCode: 'SOURCE_TOOL_UNAVAILABLE' };
      const result = await tool.execute({
        knowledge_base_id: id,
        query: String(input.query ?? '').slice(0, 2000),
        cursor: '',
      });
      if (result.isError)
        return { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
      const data = JSON.parse(result.text) as Record<string, unknown>;
      return {
        ok: true,
        status: 'ready',
        manifest: { items: Array.isArray(data.items) ? data.items.slice(0, 8) : [] },
      };
    } catch {
      return { ok: false, status: 'unreachable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    }
  }
}

class UpstreamAdapter implements KnowledgeEngineAdapter {
  constructor(
    readonly provider: string,
    private readonly execute: (
      engine: EngineConfig,
      input: Record<string, unknown>,
    ) => Promise<AdapterReceipt>,
  ) {}
  readiness(engine: EngineConfig) {
    return this.check(engine);
  }
  check(engine: EngineConfig) {
    return this.execute(engine, { operation: 'check' });
  }
  connect(engine: EngineConfig, externalRef: Record<string, string>) {
    return this.execute(engine, { operation: 'connect', externalRef });
  }
  create(_engine: EngineConfig, _input: Record<string, unknown>): Promise<AdapterReceipt> {
    return Promise.resolve({
      ok: false,
      status: 'needs_setup',
      errorCode: 'REMOTE_CREATE_UNSUPPORTED',
    });
  }
  search(engine: EngineConfig, input: Record<string, unknown>) {
    return this.execute(engine, { ...input, operation: 'search' });
  }
}
export class KnowledgeAdapterRegistry {
  private readonly adapters = new Map<string, KnowledgeEngineAdapter>([
    ['ima', new ImaKnowledgeAdapter()],
  ]);
  constructor(
    execute?: (
      engine: EngineConfig,
      input: Record<string, unknown>,
    ) => Promise<{
      ok: boolean;
      status?: EngineReadiness;
      errorCode?: string;
      manifest?: Record<string, unknown>;
      checks?: AdapterReceipt['checks'];
    }>,
  ) {
    if (execute)
      for (const provider of ['weknora', 'lightrag-server', 'kiwix', 'obsidian', 'marginnote'])
        this.adapters.set(
          provider,
          new UpstreamAdapter(provider, async (engine, input) => {
            const result = await execute(engine, input);
            return { ...result, status: result.status ?? (result.ok ? 'ready' : 'unavailable') };
          }),
        );
  }
  get(provider: string): KnowledgeEngineAdapter | undefined {
    return this.adapters.get(provider);
  }
  has(provider: string): boolean {
    return this.adapters.has(provider);
  }
}
