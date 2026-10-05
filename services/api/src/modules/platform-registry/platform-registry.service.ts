import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AdminRuntimeAgent, AdminRuntimeModelUsageOption, AdminRuntimeSkill, AdminRuntimeSnapshot, AdminRuntimeAgentUpdateRequest, CurrentUser, TutorAgentMcpDescriptor, TutorAgentToolDescriptor } from '@qitu/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { agentConfigs, agentMcpBindings, agentSkillBindings, agentToolBindings, agentMemoryRecords, auditLogs, knowledgeDocuments, projectTemplates, runtimeMcpServers, tutorPartners, type Database, withTransaction } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { builtinToolRegistry } from './built-in-tools';
import { QITU_LEARNING_PARTNER } from '@qitu/ai-client';
import { AuditWriter } from '../../common/audit/audit.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { assertParentGraph } from './agent-config.validation';
import type { TutorRuntimePolicy, TutorRuntimeSkill } from '../../common/tutor-runtime/runtime-source';

export interface EffectiveAgentRuntime {
  agent: AdminRuntimeAgent;
  policy: TutorRuntimePolicy;
  skills: readonly TutorRuntimeSkill[];
  tools: readonly TutorAgentToolDescriptor[];
  mcpServers: readonly TutorAgentMcpDescriptor[];
}

@Injectable()
export class PlatformRegistryService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(DATA_MODE_TOKEN) private readonly mode: DataMode,
    private readonly audit: AuditWriter,
    private readonly models: ModelRegistryService,
  ) {}

  async getSnapshot(): Promise<AdminRuntimeSnapshot> {
    const runtime = loadTutorRuntimeSource();
    let agents: AdminRuntimeAgent[] = [];
    let databaseAvailable = false;

    if (this.db) {
      try {
        await this.db.execute(sql`select 1`);
        databaseAvailable = true;
      } catch {
        databaseAvailable = false;
      }
      if (databaseAvailable) agents = await this.listAgentsFromDatabase();
    }

    const checks = await this.readChecks(databaseAvailable);
    const initialization = {
      overall: checks.some((check) => check.status === 'failed') ? 'degraded' as const
        : checks.some((check) => check.status === 'missing') ? 'not_ready' as const : 'unknown' as const,
      dataMode: this.mode,
      database: this.db === null ? 'in_memory' as const : databaseAvailable ? 'connected' as const : 'unavailable' as const,
      migrationVersion: null,
      checks,
    };

    const skills: AdminRuntimeSkill[] = runtime.skills.map((skill) => ({
      id: skill.id,
      label: skill.label,
      description: skill.description,
      version: skill.version,
      source: 'runtime',
      status: skill.status === 'ready' ? 'ready' : 'unavailable',
      content: skill.content,
      agentIds: agents.filter((agent) => agent.skillIds.includes(skill.id)).map((agent) => agent.id),
    }));

    const usages = this.models.getUsages();
    const modelUsageOptions: AdminRuntimeModelUsageOption[] = usages.bindings.map((binding) => {
      const usage = usages.usages.find((item) => item.id === binding.usageId);
      return { id: binding.usageId, label: usage?.label ?? binding.usageId, available: binding.resolved !== null, modelId: binding.resolved?.modelId ?? null };
    });

    return {
      generatedAt: new Date().toISOString(),
      overall: initialization.overall,
      dataSource: this.mode === 'live' ? 'live' : 'demo',
      policy: {
        id: runtime.policy.id,
        version: runtime.policy.version,
        contentHash: runtime.policy.contentHash,
        status: runtime.policy.status,
        content: runtime.policy.content || null,
      },
      skills,
      mcpServers: await this.listMcpServers(),
      agents: agents.sort((a, b) => a.label.localeCompare(b.label)),
      modelUsageOptions,
      builtInTools: builtinToolRegistry.list(),
      initialization,
    };
  }

  async getAgentRuntime(agentId: string): Promise<EffectiveAgentRuntime> {
    const runtime = loadTutorRuntimeSource();
    const agent = (await this.listAgentsFromDatabase()).find((item) => item.id === agentId);
    if (!agent) throw new NotFoundException('Agent 角色不存在');
    const selectedSkills = runtime.skills.filter((skill) => agent.skillIds.includes(skill.id) && skill.status === 'ready');
    const tools = builtinToolRegistry.listForAgentIds(agent.toolIds);
    const mcpServers = (await this.listMcpServerRows())
      .filter((server) => agent.mcpServerIds.includes(server.id) && server.enabled)
      .map((server) => ({
        serverId: server.id,
        label: server.label,
        transport: server.transport as TutorAgentMcpDescriptor['transport'],
        toolIds: (agent.mcpToolIds[server.id] ?? server.toolIds).filter((toolId) => server.toolIds.includes(toolId)),
      }));
    return { agent, policy: runtime.policy, skills: selectedSkills, tools, mcpServers };
  }

  private async listAgentsFromDatabase(): Promise<AdminRuntimeAgent[]> {
    if (!this.db) return [];
    try {
      const configs = await this.db.select().from(agentConfigs);
      if (configs.length > 0) {
        return Promise.all(configs.map(async (config) => {
          const [skills, tools, mcp] = await Promise.all([
            this.db!.select().from(agentSkillBindings).where(eq(agentSkillBindings.agentId, config.id)),
            this.db!.select().from(agentToolBindings).where(eq(agentToolBindings.agentId, config.id)),
            this.db!.select().from(agentMcpBindings).where(eq(agentMcpBindings.agentId, config.id)),
          ]);
          return {
            id: config.id,
            label: config.displayName,
            description: null,
            role: config.role,
            roleDefinition: config.roleDefinition,
            agentDefinition: config.agentDefinition,
            parentAgentId: config.parentAgentId,
            enabled: config.enabled,
            status: config.enabled ? 'enabled' as const : 'disabled' as const,
            modelUsage: config.modelUsage,
            promptVersion: `agent-config.v${config.configVersion}`,
            capabilities: Array.isArray(config.capabilities) ? config.capabilities : [],
            skillIds: skills.filter((binding) => binding.enabled).map((binding) => binding.skillId),
            toolIds: tools.filter((binding) => binding.enabled).map((binding) => binding.toolId),
            mcpServerIds: mcp.filter((binding) => binding.enabled).map((binding) => binding.mcpServerId),
            mcpToolIds: Object.fromEntries(mcp.filter((binding) => binding.enabled).map((binding) => [binding.mcpServerId, binding.allowedToolIds])),
          };
        }));
      }
    } catch {
      // Pre-0015 databases use Tutor Partner as the compatibility projection.
    }

    try {
      const partners = await this.db.select().from(tutorPartners);
      return partners.map((partner) => ({
        id: partner.id,
        label: partner.displayName,
        description: null,
        role: 'tutor',
        roleDefinition: partner.roleDefinition || QITU_LEARNING_PARTNER.roleDefinition,
        agentDefinition: '',
        parentAgentId: null,
        enabled: partner.enabled,
        status: partner.enabled ? 'enabled' as const : 'disabled' as const,
        modelUsage: partner.modelUsage,
        promptVersion: partner.promptVersion,
        capabilities: Array.isArray(partner.capabilities) ? partner.capabilities : [],
        skillIds: [],
        toolIds: [],
        mcpServerIds: [],
        mcpToolIds: {},
      }));
    } catch {
      return [];
    }
  }

  private async listMcpServerRows() {
    if (!this.db) return [];
    try {
      return await this.db.select().from(runtimeMcpServers);
    } catch {
      return [];
    }
  }

  private async listMcpServers(): Promise<AdminRuntimeSnapshot['mcpServers']> {
    const rows = await this.listMcpServerRows();
    return rows.map((server) => ({
      id: server.id,
      label: server.label,
      transport: server.transport as AdminRuntimeSnapshot['mcpServers'][number]['transport'],
      status: server.status as AdminRuntimeSnapshot['mcpServers'][number]['status'],
      enabled: server.enabled,
      toolCount: server.toolCount,
      endpointOrigin: server.endpointOrigin,
      lastCheckedAt: server.lastCheckedAt?.toISOString() ?? null,
      lastError: server.lastError,
    }));
  }

  async updateAgent(actor: CurrentUser, agentId: string, input: AdminRuntimeAgentUpdateRequest): Promise<AdminRuntimeAgent> {
    if (!this.db) throw new ServiceUnavailableException('角色治理存储不可用');
    const allowedCapabilities = new Set(['explore', 'plan', 'teach', 'review', 'reflect']);
    const label = input.label?.trim();
    const definition = input.roleDefinition?.trim();
    const agentDefinition = input.agentDefinition?.trim();
    if (label !== undefined && (label.length < 2 || label.length > 80)) throw new BadRequestException('角色名称长度须为 2 至 80 个字符');
    if (definition !== undefined && (definition.length < 20 || definition.length > 4000)) throw new BadRequestException('角色定义长度须为 20 至 4000 个字符');
    if (agentDefinition !== undefined && agentDefinition.length > 12000) throw new BadRequestException('agents.md 定义不能超过 12000 个字符');
    if (input.capabilities && (input.capabilities.length === 0 || input.capabilities.length > 5 || input.capabilities.some((item) => !allowedCapabilities.has(item)))) {
      throw new BadRequestException('角色能力列表无效');
    }
    if (input.modelUsage !== undefined && !this.models.getUsages().usages.some((item) => item.id === input.modelUsage)) {
      throw new BadRequestException('未知的模型用途');
    }
    const runtime = loadTutorRuntimeSource();
    const skillIds = input.skillIds ?? input.skillBindings?.map((binding) => binding.skillId);
    if (skillIds !== undefined) {
      const knownSkills = new Set(runtime.skills.map((skill) => skill.id));
      if (skillIds.some((skillId) => !knownSkills.has(skillId))) throw new BadRequestException('未知的 Skill');
    }
    if (input.toolIds !== undefined) {
      const knownTools = new Set(builtinToolRegistry.listForAgentIds(input.toolIds).map((tool) => tool.id));
      if (knownTools.size !== input.toolIds.length) throw new BadRequestException('未知的内置 Tool');
    }
    const mcpRows = await this.listMcpServerRows();
    const mcpBindings = input.mcpBindings?.map((binding) => ({
      serverId: binding.serverId,
      toolIds: [...new Set(binding.toolIds ?? [])],
    }));
    if (mcpBindings?.some((binding) => {
      const server = mcpRows.find((row) => row.id === binding.serverId);
      return !server || binding.toolIds.some((toolId) => !server.toolIds.includes(toolId));
    })) throw new BadRequestException('未知的 MCP Server 或 Tool');
    if (input.parentAgentId !== undefined) {
      if (input.parentAgentId === agentId) throw new BadRequestException('Agent 不能将自己设为父 Agent');
      if (input.parentAgentId !== null && !(await this.listAgentsFromDatabase()).some((agent) => agent.id === input.parentAgentId)) {
        throw new BadRequestException('父 Agent 不存在');
      }
      assertParentGraph(agentId, input.parentAgentId ?? null, await this.listAgentsFromDatabase());
    }

    await withTransaction(this.db, async (tx) => {
      const [existing] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentId)).limit(1);
      if (!existing) throw new NotFoundException('Agent 配置不存在');
      const now = new Date();
      await tx.update(agentConfigs).set({
        ...(label !== undefined ? { displayName: label } : {}),
        ...(definition !== undefined ? { roleDefinition: definition } : {}),
        ...(agentDefinition !== undefined ? { agentDefinition } : {}),
        ...(input.modelUsage !== undefined ? { modelUsage: input.modelUsage } : {}),
        ...(input.capabilities !== undefined ? { capabilities: [...new Set(input.capabilities)] } : {}),
        ...(input.parentAgentId !== undefined ? { parentAgentId: input.parentAgentId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        configVersion: existing.configVersion + 1,
        updatedBy: actor.id,
        updatedAt: now,
      }).where(eq(agentConfigs.id, agentId));
      if (skillIds !== undefined) {
        await tx.delete(agentSkillBindings).where(eq(agentSkillBindings.agentId, agentId));
        const requestedSkillBindings: Array<{ skillId: string; inheritToChildren?: boolean }> = input.skillBindings ?? skillIds.map((skillId) => ({ skillId }));
        const bindingMap = new Map(requestedSkillBindings.map((binding) => [binding.skillId, binding]));
        if (bindingMap.size > 0) await tx.insert(agentSkillBindings).values([...bindingMap.values()].map((binding) => ({
          agentId, skillId: binding.skillId, enabled: true, inheritToChildren: binding.inheritToChildren === true, updatedAt: now,
        })));
      }
      if (input.toolIds !== undefined) {
        await tx.delete(agentToolBindings).where(eq(agentToolBindings.agentId, agentId));
        if (input.toolIds.length > 0) await tx.insert(agentToolBindings).values(input.toolIds.map((toolId) => ({ agentId, toolId, enabled: true, updatedAt: now })));
      }
      if (mcpBindings !== undefined) {
        await tx.delete(agentMcpBindings).where(eq(agentMcpBindings.agentId, agentId));
        if (mcpBindings.length > 0) await tx.insert(agentMcpBindings).values(mcpBindings.map((binding) => ({
          agentId, mcpServerId: binding.serverId, allowedToolIds: binding.toolIds, enabled: true, updatedAt: now,
        })));
      }
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.agent_config.update',
        targetType: 'agent_config', targetId: agentId,
        detail: {
          changedFields: Object.keys(input).filter((key) => key !== 'roleDefinition' && key !== 'agentDefinition'),
          roleDefinitionChanged: definition !== undefined,
          agentDefinitionChanged: agentDefinition !== undefined,
          modelUsage: input.modelUsage,
          skillCount: skillIds?.length,
          toolCount: input.toolIds?.length,
          mcpCount: mcpBindings?.length,
        },
      }, tx);
    });
    const updated = (await this.listAgentsFromDatabase()).find((agent) => agent.id === agentId);
    if (!updated) throw new ServiceUnavailableException('角色更新未返回记录');
    return updated;
  }
  async createAgent(actor: CurrentUser, agentId: string, input: AdminRuntimeAgentUpdateRequest): Promise<AdminRuntimeAgent> {
    if (!this.db) throw new ServiceUnavailableException('角色治理存储不可用');
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(agentId)) throw new BadRequestException('Agent ID 无效');
    if (!input.label || !input.roleDefinition) throw new BadRequestException('新 Agent 必须提供名称和角色定义');
    if ((await this.listAgentsFromDatabase()).some((agent) => agent.id === agentId)) throw new BadRequestException('Agent 已存在');
    const parentId = input.parentAgentId ?? null;
    const agents = await this.listAgentsFromDatabase();
    assertParentGraph(agentId, parentId, agents);
    const capabilities = input.capabilities ?? ['teach'];
    const now = new Date();
    await withTransaction(this.db, async (tx) => {
      await tx.insert(agentConfigs).values({
        id: agentId,
        displayName: input.label!,
        role: 'custom',
        roleDefinition: input.roleDefinition!,
        agentDefinition: input.agentDefinition ?? '',
        modelUsage: input.modelUsage ?? 'tutor.chat',
        capabilities: [...new Set(capabilities)],
        parentAgentId: parentId,
        enabled: input.enabled ?? true,
        configVersion: 1,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      });
      if (input.skillIds && input.skillIds.length > 0) await tx.insert(agentSkillBindings).values(input.skillIds.map((skillId) => ({ agentId, skillId, enabled: true, inheritToChildren: false, updatedAt: now })));
      if (input.toolIds && input.toolIds.length > 0) await tx.insert(agentToolBindings).values(input.toolIds.map((toolId) => ({ agentId, toolId, enabled: true, updatedAt: now })));
      if (input.mcpBindings && input.mcpBindings.length > 0) await tx.insert(agentMcpBindings).values(input.mcpBindings.map((binding) => ({ agentId, mcpServerId: binding.serverId, allowedToolIds: binding.toolIds ?? [], enabled: true, updatedAt: now })));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.agent_config.create',
        targetType: 'agent_config', targetId: agentId,
        detail: { modelUsage: input.modelUsage ?? 'tutor.chat', skillCount: input.skillIds?.length ?? 0, toolCount: input.toolIds?.length ?? 0, mcpCount: input.mcpBindings?.length ?? 0 },
      }, tx);
    });
    const created = (await this.listAgentsFromDatabase()).find((agent) => agent.id === agentId);
    if (!created) throw new ServiceUnavailableException('Agent 创建未返回记录');
    return created;
  }

  getAgentRuntimeTools(runtime: EffectiveAgentRuntime) {
    return builtinToolRegistry.asAgentRegistryForIds(runtime.agent.toolIds);
  }

  private async readChecks(databaseAvailable: boolean): Promise<AdminRuntimeSnapshot['initialization']['checks']> {
    const checkedAt = new Date().toISOString();
    const checks: AdminRuntimeSnapshot['initialization']['checks'] = [
      {
        id: 'database.schema', label: 'Database schema migrations', area: 'database',
        status: 'unknown', detail: 'Migration state is not inspected by the API.',
        checkedAt, remediation: 'Run the versioned database migrations through the operator deployment path.',
        lastRun: null, operatorRequired: true, executeAllowed: false,
      },
    ];

    for (const area of ['knowledge', 'template', 'tutor'] as const) {
      const action = `admin.initialization.${area}.execute`;
      let lastRun: string | null = null;
      let status: 'ready' | 'missing' | 'failed' | 'unknown' = this.db ? 'unknown' : 'missing';
      let detail: string | null = null;
      if (this.db && databaseAvailable) {
        try {
          const records = area === 'knowledge'
            ? await this.db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
                .where(eq(knowledgeDocuments.id, 'foundation-knowledge-theory-gate')).limit(1)
            : area === 'template'
              ? await this.db.select({ id: projectTemplates.id }).from(projectTemplates)
                  .where(eq(projectTemplates.id, 'foundation-template-project-learning')).limit(1)
              : await this.db.select({ id: agentMemoryRecords.id }).from(agentMemoryRecords)
                  .where(eq(agentMemoryRecords.id, 'foundation-agent-memory-strategy')).limit(1);
          status = records.length > 0 ? 'ready' : 'missing';
          detail = records.length > 0 ? 'Foundation records are present.' : 'Foundation records are not present.';
        } catch {
          status = 'failed';
          detail = 'Foundation state could not be inspected.';
        }
        try {
          const runs = await this.db.select({ at: auditLogs.at }).from(auditLogs)
            .where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.at)).limit(1);
          lastRun = runs[0]?.at.toISOString() ?? null;
        } catch {
          // An absent audit table is represented by an unknown run time, never logged with raw DB errors.
        }
      }
      checks.push({
        id: `${area}.foundation`, label: area === 'knowledge'
          ? 'Knowledge base foundation'
          : area === 'template'
            ? 'Template library foundation'
            : 'Session memory foundation',
        area, status, detail, checkedAt, remediation: status === 'ready' ? null : 'Retry the idempotent foundation initialization after the database schema is available.',
        lastRun, operatorRequired: false, executeAllowed: this.db !== null && databaseAvailable && status !== 'failed',
      });
    }
    return checks;
  }
}
