import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import type { AdminImaSettings, AdminImaSettingsPatch, CurrentUser } from '@qitu/contracts';
import { adminAssistants, agentConfigs, agentMcpBindings, runtimeMcpServers, withTransaction, type Database } from '@qitu/database';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { ImaMcpClient, IMA_MCP_SERVER_ID, IMA_READ_TOOLS } from '../ai-tutor/ima-mcp.client';
import { runtimeIdsForAssistant } from './assistant-runtime-identity';

export function parseImaPatch(body: unknown): AdminImaSettingsPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('ima 配置须为对象');
  const value = body as Record<string, unknown>;
  if (!Object.keys(value).length || Object.keys(value).some((key) => !['enabled', 'assistantBindings', 'agentBindings'].includes(key))) {
    throw new BadRequestException('仅允许修改 ima 总开关和授权列表');
  }
  if ('enabled' in value && typeof value.enabled !== 'boolean') throw new BadRequestException('enabled 须为布尔值');
  for (const key of ['assistantBindings', 'agentBindings']) {
    if (!(key in value)) continue;
    const entries = value[key];
    if (!Array.isArray(entries) || !entries.length || entries.length > 300) throw new BadRequestException('授权列表无效');
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((field) => !['id', 'enabled'].includes(field))
        || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 160 || typeof entry.enabled !== 'boolean' || seen.has(entry.id)) {
        throw new BadRequestException('授权项须包含唯一 id 和布尔 enabled');
      }
      seen.add(entry.id);
    }
  }
  return value as AdminImaSettingsPatch;
}

@Injectable()
export class ImaSettingsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    @Optional() private readonly knowledgeCenter?: KnowledgeCenterService,
  ) {}

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException('ima 配置存储不可用');
    return this.db;
  }

  async getSettings(): Promise<AdminImaSettings> {
    const db = this.database();
    const [servers, assistants, agents, bindings] = await Promise.all([
      db.select().from(runtimeMcpServers), db.select().from(adminAssistants),
      db.select().from(agentConfigs), db.select().from(agentMcpBindings),
    ]);
    const server = servers.find((row) => row.id === IMA_MCP_SERVER_ID);
    let endpointOrigin: string | null = null;
    try { endpointOrigin = new URL(server?.endpointOrigin ?? '').origin; } catch { /* unconfigured */ }
    const unified = this.knowledgeCenter ? (await this.knowledgeCenter.configuration()).config.knowledgeEngines['ima-main'] : undefined;
    return {
      id: IMA_MCP_SERVER_ID, label: server?.label ?? 'ima 教材知识库', registered: !!server,
      enabled: unified?.enabled ?? server?.enabled ?? false,
      status: server?.status === 'connected' ? 'connected' : server?.status === 'error' ? 'error' : server ? 'unknown' : 'not_configured',
      credentialConfigured: !!(process.env.QITU_IMA_MCP_URL && process.env.QITU_IMA_MCP_TOKEN),
      endpointOrigin, transport: 'streamable_http', tools: (server?.toolIds ?? []).filter((id) => IMA_READ_TOOLS.some((tool) => tool === id)),
      toolCount: server?.toolCount ?? null, lastCheckedAt: server?.lastCheckedAt?.toISOString() ?? null,
      // Never expose a legacy upstream error body or credential-bearing URL.
      lastError: server?.lastError ? 'ima 连接检查失败，请检查服务端配置后重试' : null,
      assistants: assistants.map((row) => ({ id: row.id, name: row.name, enabled: row.enabled, authorized: row.mcpServerIds.includes(IMA_MCP_SERVER_ID) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      agents: agents.map((row) => {
        const binding = bindings.find((item) => item.agentId === row.id && item.mcpServerId === IMA_MCP_SERVER_ID);
        return { id: row.id, name: row.displayName, enabled: row.enabled, authorized: binding?.enabled ?? false,
          tools: (binding?.allowedToolIds ?? []).filter((id) => server?.toolIds.includes(id) && IMA_READ_TOOLS.some((tool) => tool === id)) };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async update(actor: CurrentUser, input: AdminImaSettingsPatch): Promise<AdminImaSettings> {
    if (this.knowledgeCenter) throw new ConflictException({code:'CONFIG_REVISION_REQUIRED',message:'ima 已迁入统一知识引擎配置，请在 JSON 工作台读取当前修订后保存'});
    const patch = parseImaPatch(input);
    await withTransaction(this.database(), async (tx) => {
      const [server] = await tx.select().from(runtimeMcpServers).where(eq(runtimeMcpServers.id, IMA_MCP_SERVER_ID)).for('update');
      if (!server) throw new NotFoundException('ima 尚未在服务器注册');
      const assistants = await tx.select().from(adminAssistants);
      const agents = await tx.select().from(agentConfigs);
      if (patch.assistantBindings?.some((item) => !assistants.some((row) => row.id === item.id))
        || patch.agentBindings?.some((item) => !agents.some((row) => row.id === item.id))) throw new BadRequestException('授权对象不存在');
      const now = new Date();
      if (patch.enabled !== undefined) await tx.update(runtimeMcpServers).set({ enabled: patch.enabled, updatedAt: now }).where(eq(runtimeMcpServers.id, IMA_MCP_SERVER_ID));
      for (const entry of patch.assistantBindings ?? []) {
        const current = assistants.find((row) => row.id === entry.id)!;
        await tx.update(adminAssistants).set({
          mcpServerIds: entry.enabled
            ? sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(${adminAssistants.mcpServerIds} || ${JSON.stringify([IMA_MCP_SERVER_ID])}::jsonb))`
            : sql`${adminAssistants.mcpServerIds} - ${IMA_MCP_SERVER_ID}`,
          updatedAt: now, updatedBy: actor.id,
        }).where(eq(adminAssistants.id, current.id));
      }
      for (const entry of patch.agentBindings ?? []) {
        const [existing] = await tx.select().from(agentMcpBindings).where(and(eq(agentMcpBindings.agentId, entry.id), eq(agentMcpBindings.mcpServerId, IMA_MCP_SERVER_ID)));
        await tx.insert(agentMcpBindings).values({
          agentId: entry.id, mcpServerId: IMA_MCP_SERVER_ID, enabled: entry.enabled,
          allowedToolIds: existing?.allowedToolIds ?? server.toolIds.filter((id) => IMA_READ_TOOLS.some((tool) => tool === id)), updatedAt: now,
        }).onConflictDoUpdate({ target: [agentMcpBindings.agentId, agentMcpBindings.mcpServerId], set: { enabled: entry.enabled, updatedAt: now } });
      }
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.mcp.ima.update', targetType: 'runtime_mcp_server', targetId: IMA_MCP_SERVER_ID,
        detail: { ...patch } }, tx);
    });
    return this.getSettings();
  }

  /** A fresh, fail-closed authorization check before discovery and each tool call. */
  async canCall(agentId: string, toolId: string, assistantId?: string): Promise<boolean> {
    if (this.knowledgeCenter) {
      if (!assistantId || !(await this.knowledgeCenter.canRetrieve(assistantId))) return false;
      const engine = (await this.knowledgeCenter.configuration()).config.knowledgeEngines['ima-main'];
      if (!engine?.enabled || (Array.isArray(engine.config.allowedKnowledgeBaseIds) && engine.config.allowedKnowledgeBaseIds.length === 0)) return false;
    }
    if (!this.db || !IMA_READ_TOOLS.some((tool) => tool === toolId)) return false;
    try {
      const [servers, agents, bindings, assistants] = await Promise.all([
        this.db.select().from(runtimeMcpServers), this.db.select().from(agentConfigs),
        this.db.select().from(agentMcpBindings), this.db.select().from(adminAssistants),
      ]);
      const server = servers.find((row) => row.id === IMA_MCP_SERVER_ID);
      // Tutor uses one real assistant identity. An Admin-only assistant needs
      // no unrelated global partner; existing exact/legacy runtime denies hold.
      if (assistantId === agentId) {
        const assistant = assistants.find((row) => row.id === assistantId);
        const runtimeIds = runtimeIdsForAssistant(assistantId);
        const configuredAgents = agents.filter((row) => runtimeIds.includes(row.id));
        return !!(server?.enabled && server.toolIds.includes(toolId) && assistant?.enabled
          && assistant.mcpServerIds.includes(IMA_MCP_SERVER_ID)
          && configuredAgents.every((row) => row.enabled && bindings.some((binding) =>
            binding.agentId === row.id && binding.mcpServerId === IMA_MCP_SERVER_ID
            && binding.enabled && binding.allowedToolIds.includes(toolId))));
      }
      const agent = agents.find((row) => row.id === agentId);
      const binding = bindings.find((row) => row.agentId === agentId && row.mcpServerId === IMA_MCP_SERVER_ID);
      const assistant = assistantId ? assistants.find((row) => row.id === assistantId) : undefined;
      const leader = agentId === 'qitu-learning-partner' ? assistants.find((row) => row.id === 'tutor-leader') : undefined;
      return !!(server?.enabled && agent?.enabled && binding?.enabled && server.toolIds.includes(toolId) && binding.allowedToolIds.includes(toolId)
        && (!assistantId || (assistant?.enabled && assistant.mcpServerIds.includes(IMA_MCP_SERVER_ID))) && (!leader || leader.enabled));
    } catch { return false; }
  }

  async probe(actor: CurrentUser): Promise<AdminImaSettings> {
    const db = this.database();
    const settings = await this.getSettings();
    if (!settings.registered) throw new NotFoundException('ima 尚未在服务器注册');
    let status = 'connected';
    let toolCount: number | null = null;
    let lastError: string | null = null;
    try {
      const tools = await new ImaMcpClient().toolsFor([{ serverId: IMA_MCP_SERVER_ID, label: settings.label, transport: 'streamable_http', toolIds: [...settings.tools] }]);
      toolCount = tools.length;
      const list = tools.find((tool) => tool.name === 'ima_list_knowledge_bases');
      if (!list || (await list.execute({}, AbortSignal.timeout(25_000))).isError) throw new Error('IMA_PROBE_FAILED');
    } catch { status = 'error'; lastError = 'IMA_CONNECTION_CHECK_FAILED'; }
    await withTransaction(db, async (tx) => {
      await tx.update(runtimeMcpServers).set({ status, toolCount, lastError, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(runtimeMcpServers.id, IMA_MCP_SERVER_ID));
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.mcp.ima.probe', targetType: 'runtime_mcp_server', targetId: IMA_MCP_SERVER_ID, detail: { status, toolCount } }, tx);
    });
    return this.getSettings();
  }
}
