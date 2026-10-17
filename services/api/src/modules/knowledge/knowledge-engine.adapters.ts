import { ImaMcpClient } from '../ai-tutor/ima-mcp.client';
import type { EngineConfig } from './knowledge-center.config';

export type EngineReadiness = 'ready' | 'needs_key' | 'needs_setup' | 'not_installed' | 'unavailable' | 'unreachable';
export interface AdapterReceipt {
  ok: boolean;
  status: EngineReadiness;
  errorCode?: string;
  manifest?: Record<string, unknown>;
  hits?: { memberId: string; text: string; score: number | null; locator: Record<string, unknown> | null }[];
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
function endpoint(value: unknown): URL | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}
async function boundedFetch(url: URL, init: RequestInit = {}): Promise<boolean> {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

abstract class HttpKnowledgeAdapter implements KnowledgeEngineAdapter {
  abstract readonly provider: string;
  abstract credential(): string | null;
  abstract checkUrl(engine: EngineConfig, externalRef?: Record<string, string>): URL | null;
  async readiness(engine: EngineConfig): Promise<AdapterReceipt> {
    if (!this.credential()) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    if (!this.checkUrl(engine)) return { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NEEDS_SETUP' };
    return this.check(engine);
  }
  async check(engine: EngineConfig): Promise<AdapterReceipt> {
    const token = this.credential();
    const url = this.checkUrl(engine);
    if (!token) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    if (!url) return { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NEEDS_SETUP' };
    const ok = await boundedFetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    return ok
      ? { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED' }
      : { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
  }
  async connect(engine: EngineConfig, externalRef: Record<string, string>): Promise<AdapterReceipt> {
    const token = this.credential();
    if (!token) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    if (!externalRef.remoteKnowledgeBaseId) return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_RESOURCE_NOT_FOUND' };
    const url = this.checkUrl(engine, externalRef);
    if (!url) return { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NEEDS_SETUP' };
    const ok = await boundedFetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    return ok
      ? { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED' }
      : { ok: false, status: 'unreachable', errorCode: 'REMOTE_CONNECTION_FAILED' };
  }
  async create(_engine?: EngineConfig, _input?: Record<string, unknown>): Promise<AdapterReceipt> {
    return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_CREATE_UNSUPPORTED' };
  }
  async search(engine: EngineConfig, input: Record<string, unknown>): Promise<AdapterReceipt> {
    const result = await this.check(engine);
    if (!result.ok) return result;
    // The provider-specific query contract is intentionally server-configured. No client URL,
    // command, credential, or upstream response is allowed to cross this adapter boundary.
    return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED' };
  }
}

export class PageIndexCloudAdapter extends HttpKnowledgeAdapter {
  readonly provider = 'pageindex';
  credential() { return envCredential('QITU_PAGEINDEX_CLOUD_TOKEN', 'QITU_KNOWLEDGE_CREDENTIAL_PAGEINDEX'); }
  checkUrl(_engine?: EngineConfig, _externalRef?: Record<string, string>) { return endpoint(process.env.QITU_PAGEINDEX_CLOUD_CHECK_URL); }
  override async create(_engine: EngineConfig, _input: Record<string, unknown>): Promise<AdapterReceipt> {
    const token = this.credential();
    const url = endpoint(process.env.QITU_PAGEINDEX_CLOUD_CREATE_URL);
    if (!token) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    if (!url) return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_CREATE_UNSUPPORTED' };
    return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_CREATE_UNSUPPORTED' };
  }
}

export class WeKnoraAdapter extends HttpKnowledgeAdapter {
  readonly provider = 'weknora';
  credential() { return envCredential('QITU_WEKNORA_API_KEY', 'QITU_KNOWLEDGE_CREDENTIAL_WEKNORA'); }
  checkUrl(engine: EngineConfig, externalRef?: Record<string, string>) { return endpoint(externalRef?.serverUrl ?? process.env.QITU_WEKNORA_CHECK_URL); }
}

export class ImaKnowledgeAdapter implements KnowledgeEngineAdapter {
  readonly provider = 'ima';
  private readonly client = new ImaMcpClient();
  private configured() { return Boolean(process.env.QITU_IMA_MCP_URL && envCredential('QITU_IMA_MCP_TOKEN')); }
  private async tools() {
    return this.client.toolsFor([{ serverId: 'ima-knowledge', label: 'ima', transport: 'streamable_http', toolIds: ['ima_list_knowledge_bases', 'ima_search_knowledge'] }]);
  }
  async readiness(): Promise<AdapterReceipt> {
    if (!this.configured()) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    return this.check({} as EngineConfig);
  }
  async check(_engine?: EngineConfig): Promise<AdapterReceipt> {
    if (!this.configured()) return { ok: false, status: 'needs_key', errorCode: 'ENGINE_NEEDS_KEY' };
    try {
      const tool = (await this.tools()).find((candidate) => candidate.name === 'ima_list_knowledge_bases');
      if (!tool) return { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NEEDS_SETUP' };
      const response = await tool.execute({});
      if (response.isError) return { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
      const value = JSON.parse(response.text) as Record<string, unknown>;
      return Array.isArray(value.knowledge_bases)
        ? { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED', manifest: { accessibleBases: value.knowledge_bases.length } }
        : { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    } catch {
      return { ok: false, status: 'unavailable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    }
  }
  async connect(_engine: EngineConfig, externalRef: Record<string, string>): Promise<AdapterReceipt> {
    const checked = await this.check();
    if (!checked.ok) return checked;
    const id = externalRef.remoteKnowledgeBaseId;
    if (!id) return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_RESOURCE_NOT_FOUND' };
    try {
      const tool = (await this.tools()).find((candidate) => candidate.name === 'ima_list_knowledge_bases');
      const response = await tool?.execute({});
      const value = response && JSON.parse(response.text) as Record<string, unknown>;
      const found = Array.isArray(value?.knowledge_bases) && (value.knowledge_bases as Record<string, unknown>[]).some((item) => item.knowledge_base_id === id);
      return found
        ? { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED' }
        : { ok: false, status: 'needs_setup', errorCode: 'REMOTE_RESOURCE_NOT_FOUND' };
    } catch {
      return { ok: false, status: 'unreachable', errorCode: 'REMOTE_CONNECTION_FAILED' };
    }
  }
  async create(_engine?: EngineConfig, _input?: Record<string, unknown>): Promise<AdapterReceipt> { return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_CREATE_UNSUPPORTED' }; }
  async search(): Promise<AdapterReceipt> { return { ok: false, status: 'needs_setup', errorCode: 'REMOTE_QUERY_UNSUPPORTED' }; }
}

export class KnowledgeAdapterRegistry {
  private readonly adapters = new Map<string, KnowledgeEngineAdapter>([
    ['pageindex', new PageIndexCloudAdapter()],
    ['weknora', new WeKnoraAdapter()],
    ['ima', new ImaKnowledgeAdapter()],
  ]);
  get(provider: string): KnowledgeEngineAdapter | undefined { return this.adapters.get(provider); }
  has(provider: string): boolean { return this.adapters.has(provider); }
}
