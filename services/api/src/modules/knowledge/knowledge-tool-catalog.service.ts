import { RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { runtimeMcpServers } from '@qitu/database';
import { KnowledgeCenterService } from './knowledge-center.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { ImaMcpClient, IMA_READ_TOOLS } from '../ai-tutor/ima-mcp.client';
import { legacyMcpManifest } from '../platform-registry/legacy-mcp-catalog';

export interface KnowledgeToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
}
export interface KnowledgeToolCatalog {
  tools: KnowledgeToolDefinition[];
  source: 'runtime' | 'mcp' | 'registry' | 'legacy_manifest';
  fetchedAt: string | null;
  stale: boolean;
  message: string | null;
}

/** Admin-only metadata. Never executes a discovered tool or accepts a client endpoint. */
@Injectable()
export class KnowledgeToolCatalogService {
  private readonly cache = new Map<string, KnowledgeToolCatalog>();
  private inflight: Promise<KnowledgeToolCatalog> | null = null;
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly knowledge: KnowledgeRetrievalService,
  ) {}

  async list(section: string, id: string, refresh = false): Promise<KnowledgeToolCatalog> {
    if (
      !['mcpServers', 'knowledgeEngines', 'platformTools'].includes(section) ||
      !id ||
      id.length > 160
    )
      throw new BadRequestException('工具目录目标无效');
    const { config } = await this.center.configuration();
    if (section === 'platformTools') {
      if (id !== 'project-knowledge') throw new NotFoundException('工具未注册');
      return {
        tools: RUNTIME_TOOL_CATALOG.filter(tool => tool.invocation === 'model_tool').map(tool => ({
          name: tool.id, description: tool.description, inputSchema: tool.inputSchema ?? null,
        })),
        source: 'runtime',
        fetchedAt: new Date().toISOString(),
        stale: false,
        message: null,
      };
    }
    if (section === 'knowledgeEngines') {
      const engine = config.knowledgeEngines[id];
      if (!engine) throw new NotFoundException('引擎未注册');
      if (engine.provider !== 'ima')
        return {
          tools: [],
          source: 'registry',
          fetchedAt: null,
          stale: false,
          message:
            engine.provider === 'llamaindex'
              ? '通过已授权知识库的搜索、阅读工具使用此索引引擎，没有独立模型工具。'
              : '此引擎未登记独立工具定义，实际适配状态请查看知识中心。',
        };
      if (engine.config.connectionRef !== 'ima-legacy')
        return {
          tools: IMA_READ_TOOLS.map((name) => ({
            name,
            description: '后台建库 / 管理员检查',
            inputSchema: null,
          })),
          source: 'registry',
          fetchedAt: null,
          stale: false,
          message: '连接引用未配置，参数定义暂不可用。',
        };
      return this.ima(refresh);
    }
    const entry = config.mcpServers[id]
      || config.mcpServers[`mcp-${id}`]
      || Object.values(config.mcpServers).find((c: any) => c?.name === id);
    if (!entry) throw new NotFoundException('MCP 服务未注册');
    const registered = (await this.center.database().select().from(runtimeMcpServers)).find(
      (row) => row.id === id || row.label === id || row.id === `mcp-${id}` || row.id.replace(/^mcp-/, '') === id,
    );
    const manifest = legacyMcpManifest(id) || legacyMcpManifest(registered?.label ?? '') || legacyMcpManifest(String((entry as any).name ?? ''));
    const manifestTools = manifest?.tools.map((t) => t.name) ?? [];

    const names = (registered?.toolIds && registered.toolIds.length > 0)
      ? registered.toolIds
      : (Array.isArray(entry.tools) && entry.tools.length > 0
          ? (entry.tools as string[])
          : manifestTools);
    if (manifest)
      return {
        tools: names.map(
          (name) =>
            manifest.tools.find((tool) => tool.name === name) ?? {
              name,
              description: '',
              inputSchema: null,
            },
        ),
        source: 'legacy_manifest',
        fetchedAt: null,
        stale: false,
        message:
          '原界面的子工具与参数定义已恢复；参数尚未通过运行中的 MCP 服务核验，连接状态以服务端检查为准。',
      };
    return {
      tools: names.map((name) => ({ name, description: '', inputSchema: null })),
      source: 'registry',
      fetchedAt: registered?.lastCheckedAt?.toISOString() ?? null,
      stale: false,
      message: '服务尚未提供可验证的输入定义，参数定义暂不可用。不会使用猜测参数。',
    };
  }

  private async ima(refresh: boolean): Promise<KnowledgeToolCatalog> {
    const cached = this.cache.get('ima-legacy');
    if (!refresh && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 60_000)
      return cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.discoverIma(cached);
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  private async discoverIma(
    cached: KnowledgeToolCatalog | undefined,
  ): Promise<KnowledgeToolCatalog> {
    try {
      const tools = await new ImaMcpClient().toolsFor([
        {
          serverId: 'ima-knowledge',
          label: 'ima',
          transport: 'streamable_http',
          toolIds: [...IMA_READ_TOOLS],
        },
      ]);
      const result: KnowledgeToolCatalog = {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        source: 'mcp',
        fetchedAt: new Date().toISOString(),
        stale: false,
        message: '后台建库 / 管理员检查工具；查看定义不会执行工具。',
      };
      this.cache.set('ima-legacy', result);
      return result;
    } catch {
      if (cached) {
        const stale = { ...cached, stale: true, message: '目录刷新失败，以下是上次获取的定义。' };
        this.cache.set('ima-legacy', stale);
        return stale;
      }
      return {
        tools: IMA_READ_TOOLS.map((name) => ({
          name,
          description: '后台建库 / 管理员检查',
          inputSchema: null,
        })),
        source: 'registry',
        fetchedAt: null,
        stale: false,
        message: '无法读取 ima 工具目录，参数定义暂不可用，请重试。',
      };
    }
  }
}
