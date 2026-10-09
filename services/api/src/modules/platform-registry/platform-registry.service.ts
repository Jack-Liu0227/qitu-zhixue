import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AdminRuntimeAgent, AdminRuntimeSkill, AdminRuntimeSnapshot, AdminRuntimeAgentUpdateRequest, CurrentUser, TutorAgentMcpDescriptor, TutorAgentToolDescriptor } from '@qitu/contracts';
import type {
  AdminAssistantConfig,
  AdminAssistantCreateInput,
  AdminAssistantUpdateInput,
  AdminTeamConfig,
  AdminTeamCreateInput,
  AdminTeamMember,
  AdminTeamMemberInput,
  AdminTeamPblSpecInput,
  AdminTeamUpdateInput,
  AssistantAgentStatus,
  AssistantDefaults,
  AssistantSource,
  PblPhase,
  PblTeamWorkflowSpec,
  TeamSessionMode,
  TeammateRole,
  TeammateStatus,
  WorkspaceMode,
} from '@qitu/contracts';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { adminAssistants, adminTeamMembers, adminTeams, agentConfigs, agentMcpBindings, agentSkillBindings, agentToolBindings, agentMemoryRecords, auditLogs, knowledgeDocuments, projectTemplates, runtimeMcpServers, tutorPartners, type Database, withTransaction } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { builtinToolRegistry } from './built-in-tools';
import { QITU_LEARNING_PARTNER } from '@qitu/ai-client';
import { AuditWriter } from '../../common/audit/audit.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { assertParentGraph } from './agent-config.validation';
import { PBL_PHASE_GATE_DEFAULTS } from './admin-ai-config.validation';
import type { TutorRuntimePolicy, TutorRuntimeSkill } from '../../common/tutor-runtime/runtime-source';

export interface EffectiveAgentRuntime {
  agent: AdminRuntimeAgent;
  policy: TutorRuntimePolicy;
  skills: readonly TutorRuntimeSkill[];
  tools: readonly TutorAgentToolDescriptor[];
  mcpServers: readonly TutorAgentMcpDescriptor[];
}

/* ==================== admin AI 配置（助手 / 团队） ==================== */

type AssistantRow = typeof adminAssistants.$inferSelect;
type TeamRow = typeof adminTeams.$inferSelect;
type MemberRow = typeof adminTeamMembers.$inferSelect;

/**
 * 服务端兜底的助手默认项：与 `@qitu/ai-client` 内置注册表的
 * `DEFAULT_ASSISTANT_DEFAULTS` 保持一致；客户端只允许覆盖已知项，
 * 缺省字段由这里补齐（冻结契约 AdminAssistantCreateInput.defaults）。
 */
const SERVER_ASSISTANT_DEFAULTS: AssistantDefaults = {
  model: { mode: 'default', value: 'qwen3.8-flash' },
  permission: { mode: 'auto', value: 'supervised' },
  thought_level: { mode: 'high', value: 'balanced' },
  skills: { mode: 'default', value: ['guided', 'planning', 'escalation'] },
  mcps: { mode: 'default', value: [] },
};

function mergeAssistantDefaults(partial?: Partial<AssistantDefaults> | null): AssistantDefaults {
  const d = partial ?? {};
  return {
    model: d.model ?? SERVER_ASSISTANT_DEFAULTS.model,
    permission: d.permission ?? SERVER_ASSISTANT_DEFAULTS.permission,
    thought_level: d.thought_level ?? SERVER_ASSISTANT_DEFAULTS.thought_level,
    skills: d.skills ?? SERVER_ASSISTANT_DEFAULTS.skills,
    mcps: d.mcps ?? SERVER_ASSISTANT_DEFAULTS.mcps,
  };
}

/** 读取侧投影：deletable 由 source 派生，绝不落库、绝不由客户端写入（硬要求 5）。 */
function toAssistantConfig(row: AssistantRow): AdminAssistantConfig {
  const config: AdminAssistantConfig = {
    id: row.id,
    source: row.source as AssistantSource,
    name: row.name,
    description: row.description,
    role: row.role,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    modelProviderId: row.modelProviderId ?? null,
    modelId: row.modelId ?? null,
    instructions: row.instructions,
    enabledSkills: [...row.enabledSkills],
    toolIds: [...row.toolIds],
    mcpServerIds: [...row.mcpServerIds],
    defaults: mergeAssistantDefaults(row.defaults as Partial<AssistantDefaults> | null),
    agentStatus: row.agentStatus as AssistantAgentStatus,
    teamSelectable: row.teamSelectable,
    deletable: row.source !== 'builtin',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.avatar) config.avatar = row.avatar;
  if (row.temperature !== null && row.temperature !== undefined) config.temperature = row.temperature;
  if (row.agentStatusMessage) config.agentStatusMessage = row.agentStatusMessage;
  return config;
}

/** 成员的 assistantName / avatar / status 由服务端解析回填（硬要求 1）。 */
function toTeamConfig(team: TeamRow, members: readonly MemberRow[], assistantRows: readonly AssistantRow[]): AdminTeamConfig {
  const byId = new Map(assistantRows.map((row) => [row.id, row]));
  const memberList: AdminTeamMember[] = [...members]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slotId.localeCompare(b.slotId))
    .map((member) => {
      const assistant = byId.get(member.assistantId);
      const resolved: AdminTeamMember = {
        slotId: member.slotId,
        assistantId: member.assistantId,
        assistantName: assistant?.name ?? member.assistantId,
        role: member.role as TeammateRole,
        roleLabel: member.roleLabel ?? assistant?.role ?? '',
        status: member.status as TeammateStatus,
      };
      if (assistant?.avatar) resolved.avatar = assistant.avatar;
      const model = member.model ?? assistant?.modelId ?? undefined;
      if (model) resolved.model = model;
      if (member.color) resolved.color = member.color;
      if (member.pblPhase) resolved.pblPhase = member.pblPhase as PblPhase;
      return resolved;
    });
  const config: AdminTeamConfig = {
    id: team.id,
    name: team.name,
    description: team.description,
    workspaceMode: team.workspaceMode as WorkspaceMode,
    sessionMode: team.sessionMode as TeamSessionMode,
    leaderAssistantId: team.leaderAssistantId,
    members: memberList,
    concurrencyLimit: team.concurrencyLimit,
    enabled: team.enabled,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
  if (team.pblSpec) config.pblSpec = team.pblSpec as unknown as PblTeamWorkflowSpec;
  return config;
}

/**
 * 把写入形状规范化成服务端存储的 PBL 规格：
 * - `theoryMasteredGate` 恒为 true（校验层已拒绝 false/缺失，这里再兜底写死）；
 * - `concept_mastery` 阶段的门禁强制 `TheoryMastered`；
 * - 缺省 `gateCondition` 按阶段补默认门禁；
 * - `allowAutonomousAdvance` 归一为 false。
 */
function normalizePblSpec(
  spec: AdminTeamPblSpecInput,
  members: readonly { assistantId: string; roleLabel?: string | null }[],
  assistantRows: readonly AssistantRow[],
): PblTeamWorkflowSpec {
  const byId = new Map(assistantRows.map((row) => [row.id, row]));
  const roleLabelFor = (assistantId: string): string =>
    members.find((member) => member.assistantId === assistantId)?.roleLabel
    ?? byId.get(assistantId)?.role
    ?? '';
  return {
    projectId: spec.projectId,
    projectName: spec.projectName,
    targetDomain: spec.targetDomain,
    phases: spec.phases.map((phase) => {
      const gate = phase.phase === 'concept_mastery' ? 'TheoryMastered' : (phase.gateCondition ?? PBL_PHASE_GATE_DEFAULTS[phase.phase]);
      const entry = {
        phase: phase.phase,
        title: phase.title,
        assignedAssistantId: phase.assignedAssistantId,
        assignedRoleLabel: phase.assignedRoleLabel ?? roleLabelFor(phase.assignedAssistantId),
        learningObjectives: [...(phase.learningObjectives ?? [])],
        gateCondition: gate,
        ...(phase.deliverableType !== undefined ? { deliverableType: phase.deliverableType } : {}),
      };
      return entry;
    }),
    theoryMasteredGate: true,
    allowAutonomousAdvance: false,
  };
}

function assertModelSelectionPair(input: AdminRuntimeAgentUpdateRequest): void {
  const providerSpecified = input.modelProviderId !== undefined;
  const modelSpecified = input.modelId !== undefined;
  if (providerSpecified !== modelSpecified) {
    throw new BadRequestException('模型供应商和模型必须同时提交或同时省略');
  }
  if (providerSpecified && ((input.modelProviderId === null) !== (input.modelId === null))) {
    throw new BadRequestException('模型供应商和模型必须同时选择或同时清空');
  }
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
      modelOptions: this.models.listAgentModelOptions?.() ?? [],
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
    const modelOptions = this.models.listAgentModelOptions?.() ?? [];
    const legacyTutorModel = this.models.getUsages().bindings.find((binding) => binding.usageId === 'tutor.chat')?.resolved ?? null;
    const toLegacyAgent = (partner: typeof tutorPartners.$inferSelect): AdminRuntimeAgent => ({
      id: partner.id,
      label: partner.displayName,
      description: null,
      role: 'tutor',
      roleDefinition: partner.roleDefinition || QITU_LEARNING_PARTNER.roleDefinition,
      agentDefinition: '',
      parentAgentId: null,
      enabled: partner.enabled,
      status: partner.enabled ? 'enabled' as const : 'disabled' as const,
      modelProviderId: legacyTutorModel?.providerId ?? null,
      modelId: legacyTutorModel?.modelId ?? null,
      modelLabel: modelOptions.find((option) => option.providerId === legacyTutorModel?.providerId && option.modelId === legacyTutorModel?.modelId)?.modelLabel ?? null,
      modelAvailable: modelOptions.some((option) => option.providerId === legacyTutorModel?.providerId && option.modelId === legacyTutorModel?.modelId && option.available),
      promptVersion: partner.promptVersion,
      capabilities: Array.isArray(partner.capabilities) ? partner.capabilities : [],
      skillIds: [],
      toolIds: [],
      mcpServerIds: [],
      mcpToolIds: {},
    });
    try {
      const configs = await this.db.select().from(agentConfigs);
      if (configs.length > 0) {
        const configAgents = await Promise.all(configs.map(async (config) => {
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
            modelProviderId: config.modelProviderId ?? null,
            modelId: config.modelId ?? null,
            modelLabel: modelOptions.find((option) => option.providerId === config.modelProviderId && option.modelId === config.modelId)?.modelLabel ?? null,
            modelAvailable: modelOptions.some((option) => option.providerId === config.modelProviderId && option.modelId === config.modelId && option.available),
            promptVersion: `agent-config.v${config.configVersion}`,
            capabilities: Array.isArray(config.capabilities) ? config.capabilities : [],
            skillIds: skills.filter((binding) => binding.enabled).map((binding) => binding.skillId),
            toolIds: tools.filter((binding) => binding.enabled).map((binding) => binding.toolId),
            mcpServerIds: mcp.filter((binding) => binding.enabled).map((binding) => binding.mcpServerId),
            mcpToolIds: Object.fromEntries(mcp.filter((binding) => binding.enabled).map((binding) => [binding.mcpServerId, binding.allowedToolIds])),
          };
        }));
        // A partially migrated database can contain only some Agent rows. Keep
        // the remaining legacy partners visible until the migration catches up.
        try {
          const partners = await this.db.select().from(tutorPartners);
          const configIds = new Set(configs.map((config) => config.id));
          return [
            ...configAgents,
            ...partners.filter((partner) => !configIds.has(partner.id)).map(toLegacyAgent),
          ];
        } catch {
          return configAgents;
        }
      }
    } catch {
      // Pre-0015 databases use Tutor Partner as the compatibility projection.
    }

    try {
      const partners = await this.db.select().from(tutorPartners);
      return partners.map(toLegacyAgent);
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
    assertModelSelectionPair(input);
    if (input.modelProviderId !== undefined && input.modelProviderId !== null && input.modelId !== undefined && input.modelId !== null) {
      const selected = (this.models.listAgentModelOptions?.() ?? []).some((option) => option.providerId === input.modelProviderId && option.modelId === input.modelId && option.available);
      if (!selected) throw new BadRequestException('所选模型不存在或已下线');
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
      let [existing] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentId)).limit(1);
      if (!existing) {
        // 0015 already creates these rows for normal upgrades. This branch keeps
        // a partially migrated database writable when the compatibility view
        // still comes from tutor_partners.
        const [legacyPartner] = await tx.select().from(tutorPartners).where(eq(tutorPartners.id, agentId)).limit(1);
        if (!legacyPartner) throw new NotFoundException('Agent 配置不存在');
        const legacyModel = this.models.getUsages().bindings.find((binding) => binding.usageId === legacyPartner.modelUsage)?.resolved ?? null;
        const now = new Date();
        await tx.insert(agentConfigs).values({
          id: legacyPartner.id,
          displayName: legacyPartner.displayName,
          role: 'tutor',
          roleDefinition: legacyPartner.roleDefinition || QITU_LEARNING_PARTNER.roleDefinition,
          agentDefinition: '',
          modelProviderId: legacyModel?.providerId ?? null,
          modelId: legacyModel?.modelId ?? null,
          modelUsage: legacyPartner.modelUsage,
          capabilities: Array.isArray(legacyPartner.capabilities) ? legacyPartner.capabilities : [],
          enabled: legacyPartner.enabled,
          configVersion: 1,
          updatedBy: actor.id,
          createdAt: legacyPartner.createdAt,
          updatedAt: now,
        });
        [existing] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentId)).limit(1);
      }
      if (!existing) throw new ServiceUnavailableException('Agent 配置迁移后未返回记录');
      const now = new Date();
      await tx.update(agentConfigs).set({
        ...(label !== undefined ? { displayName: label } : {}),
        ...(definition !== undefined ? { roleDefinition: definition } : {}),
        ...(agentDefinition !== undefined ? { agentDefinition } : {}),
        ...(input.modelUsage !== undefined ? { modelUsage: input.modelUsage } : {}),
        ...(input.modelProviderId !== undefined ? { modelProviderId: input.modelProviderId } : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
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
    assertModelSelectionPair(input);
    if (input.modelProviderId && input.modelId && !(this.models.listAgentModelOptions?.() ?? []).some((option) => option.providerId === input.modelProviderId && option.modelId === input.modelId && option.available)) {
      throw new BadRequestException('所选模型不存在或已下线');
    }
    const now = new Date();
    await withTransaction(this.db, async (tx) => {
      await tx.insert(agentConfigs).values({
        id: agentId,
        displayName: input.label!,
        role: 'custom',
        roleDefinition: input.roleDefinition!,
        agentDefinition: input.agentDefinition ?? '',
        modelProviderId: input.modelProviderId ?? null,
        modelId: input.modelId ?? null,
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

  /* ==================== admin 助手 CRUD ==================== */

  async listAssistants(): Promise<AdminAssistantConfig[]> {
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    const rows = await this.db
      .select()
      .from(adminAssistants)
      .orderBy(asc(adminAssistants.sortOrder), asc(adminAssistants.id));
    return rows.map(toAssistantConfig);
  }

  /**
   * 创建助手：`id` / `source: 'user'` / `deletable`（读取侧派生）/ `agentStatus:
   * 'unchecked'` / `createdAt` / `updatedAt` 全部由服务端补全；`sortOrder` 缺省
   * 追加到列表末尾。
   */
  async createAssistant(actor: CurrentUser, input: AdminAssistantCreateInput): Promise<AdminAssistantConfig> {
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    const rows = await this.db.select().from(adminAssistants);
    const now = new Date();
    const id = `assistant-${randomUUID()}`;
    const sortOrder = input.sortOrder ?? rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    const record: AssistantRow = {
      id,
      source: 'user',
      name: input.name,
      avatar: input.avatar ?? null,
      description: input.description,
      role: input.role,
      enabled: input.enabled ?? true,
      sortOrder,
      modelProviderId: input.modelProviderId ?? null,
      modelId: input.modelId ?? null,
      temperature: input.temperature ?? null,
      instructions: input.instructions,
      enabledSkills: [...(input.enabledSkills ?? [])],
      toolIds: [...(input.toolIds ?? [])],
      mcpServerIds: [...(input.mcpServerIds ?? [])],
      defaults: mergeAssistantDefaults(input.defaults) as unknown as Record<string, unknown>,
      agentStatus: 'unchecked',
      agentStatusMessage: null,
      teamSelectable: input.teamSelectable ?? true,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await withTransaction(this.db, async (tx) => {
      await tx.insert(adminAssistants).values({ ...record });
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.assistant.create',
        targetType: 'admin_assistant', targetId: id,
        // 审计不存提示词正文，只存变更元数据（未成年人数据最小可见 + 留痕）。
        detail: {
          source: 'user',
          changedFields: Object.keys(input).filter((key) => key !== 'instructions'),
          instructionsChanged: true,
          teamSelectable: record.teamSelectable,
          enabled: record.enabled,
        },
      }, tx);
    });
    return toAssistantConfig(record);
  }

  async updateAssistant(actor: CurrentUser, assistantId: string, patch: AdminAssistantUpdateInput): Promise<AdminAssistantConfig> {
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    return withTransaction(this.db, async (tx) => {
      const rows = await tx.select().from(adminAssistants);
      const existing = rows.find((row) => row.id === assistantId);
      if (!existing) throw new NotFoundException('助手不存在');
      const now = new Date();
      const set: Partial<typeof adminAssistants.$inferInsert> = { updatedBy: actor.id, updatedAt: now };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.role !== undefined) set.role = patch.role;
      if (patch.instructions !== undefined) set.instructions = patch.instructions;
      if (patch.avatar !== undefined) set.avatar = patch.avatar;
      if (patch.modelProviderId !== undefined) set.modelProviderId = patch.modelProviderId;
      if (patch.modelId !== undefined) set.modelId = patch.modelId;
      if (patch.temperature !== undefined) set.temperature = patch.temperature;
      if (patch.enabledSkills !== undefined) set.enabledSkills = [...patch.enabledSkills];
      if (patch.toolIds !== undefined) set.toolIds = [...patch.toolIds];
      if (patch.mcpServerIds !== undefined) set.mcpServerIds = [...patch.mcpServerIds];
      if (patch.defaults !== undefined) {
        set.defaults = mergeAssistantDefaults({
          ...(existing.defaults as Partial<AssistantDefaults>),
          ...patch.defaults,
        }) as unknown as Record<string, unknown>;
      }
      if (patch.teamSelectable !== undefined) set.teamSelectable = patch.teamSelectable;
      if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      await tx.update(adminAssistants).set(set).where(eq(adminAssistants.id, assistantId));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.assistant.update',
        targetType: 'admin_assistant', targetId: assistantId,
        detail: {
          source: existing.source,
          changedFields: Object.keys(patch).filter((key) => key !== 'instructions'),
          // 内置助手的提示词改写必须留下审计标记（冻结契约）。
          instructionsChanged: patch.instructions !== undefined,
        },
      }, tx);
      return toAssistantConfig({ ...existing, ...set });
    });
  }

  /* ==================== admin 团队 CRUD ==================== */

  async listTeams(): Promise<AdminTeamConfig[]> {
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    const [teams, members, assistants] = await Promise.all([
      this.db.select().from(adminTeams).orderBy(asc(adminTeams.createdAt), asc(adminTeams.id)),
      this.db.select().from(adminTeamMembers).orderBy(asc(adminTeamMembers.sortOrder)),
      this.db.select().from(adminAssistants),
    ]);
    return teams.map((team) => toTeamConfig(team, members.filter((member) => member.teamId === team.id), assistants));
  }

  async createTeam(actor: CurrentUser, input: AdminTeamCreateInput): Promise<AdminTeamConfig> {
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    const assistantRows = await this.db.select().from(adminAssistants);
    const existingMembers = await this.db.select().from(adminTeamMembers);
    this.assertTeamMembers(input.members, assistantRows);
    if (!input.members.some((member) => member.assistantId === input.leaderAssistantId)) {
      throw new BadRequestException('leaderAssistantId 必须是 members 中的某个助手');
    }
    const explicitSlots = input.members.map((member) => member.slotId).filter((slot): slot is string => !!slot);
    if (existingMembers.some((member) => explicitSlots.includes(member.slotId))) {
      throw new BadRequestException('slotId 已被既有团队成员占用');
    }
    const now = new Date();
    const id = `team-${randomUUID()}`;
    const memberRows: MemberRow[] = input.members.map((member, index) => ({
      slotId: member.slotId ?? `slot-${randomUUID()}`,
      teamId: id,
      assistantId: member.assistantId,
      role: member.role,
      roleLabel: member.roleLabel ?? null,
      model: member.model ?? null,
      color: member.color ?? null,
      pblPhase: member.pblPhase ?? null,
      status: 'idle',
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    }));
    const pblSpec = input.pblSpec ? normalizePblSpec(input.pblSpec, memberRows, assistantRows) : null;
    const teamRow: TeamRow = {
      id,
      name: input.name,
      description: input.description,
      workspaceMode: input.workspaceMode ?? 'shared',
      sessionMode: input.sessionMode ?? 'supervised',
      leaderAssistantId: input.leaderAssistantId,
      concurrencyLimit: input.concurrencyLimit ?? 1,
      pblSpec: pblSpec as unknown as Record<string, unknown> | null,
      enabled: input.enabled ?? true,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await withTransaction(this.db, async (tx) => {
      await tx.insert(adminTeams).values({ ...teamRow });
      await tx.insert(adminTeamMembers).values(memberRows.map((member) => ({ ...member })));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.team.create',
        targetType: 'admin_team', targetId: id,
        detail: {
          memberCount: memberRows.length,
          leaderAssistantId: input.leaderAssistantId,
          concurrencyLimit: teamRow.concurrencyLimit,
          pblSpecPresent: pblSpec !== null,
          theoryMasteredGate: true,
        },
      }, tx);
    });
    return toTeamConfig(teamRow, memberRows, assistantRows);
  }

  /** members 为整体替换语义（不是增量 diff）；slotId 回填可保持引用稳定。 */
  async updateTeam(actor: CurrentUser, teamId: string, patch: AdminTeamUpdateInput): Promise<AdminTeamConfig> {
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    return withTransaction(this.db, async (tx) => {
      const teams = await tx.select().from(adminTeams);
      const existing = teams.find((team) => team.id === teamId);
      if (!existing) throw new NotFoundException('团队不存在');
      const allMembers = await tx.select().from(adminTeamMembers);
      const currentMembers = allMembers.filter((member) => member.teamId === teamId);
      const assistantRows = await tx.select().from(adminAssistants);
      const leaderAssistantId = patch.leaderAssistantId ?? existing.leaderAssistantId;
      const now = new Date();
      let memberRows: readonly MemberRow[] = currentMembers;
      let replaced = false;
      if (patch.members !== undefined) {
        this.assertTeamMembers(patch.members, assistantRows);
        if (!patch.members.some((member) => member.assistantId === leaderAssistantId)) {
          throw new BadRequestException('leaderAssistantId 必须是 members 中的某个助手');
        }
        const explicitSlots = patch.members.map((member) => member.slotId).filter((slot): slot is string => !!slot);
        if (allMembers.some((member) => member.teamId !== teamId && explicitSlots.includes(member.slotId))) {
          throw new BadRequestException('slotId 已被其他团队占用');
        }
        memberRows = patch.members.map((member, index) => ({
          slotId: member.slotId ?? `slot-${randomUUID()}`,
          teamId,
          assistantId: member.assistantId,
          role: member.role,
          roleLabel: member.roleLabel ?? null,
          model: member.model ?? null,
          color: member.color ?? null,
          pblPhase: member.pblPhase ?? null,
          status: 'idle',
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        }));
        replaced = true;
      } else if (!currentMembers.some((member) => member.assistantId === leaderAssistantId)) {
        throw new BadRequestException('leaderAssistantId 必须是 members 中的某个助手');
      }
      const set: Partial<typeof adminTeams.$inferInsert> = { updatedBy: actor.id, updatedAt: now };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.leaderAssistantId !== undefined) set.leaderAssistantId = patch.leaderAssistantId;
      if (patch.workspaceMode !== undefined) set.workspaceMode = patch.workspaceMode;
      if (patch.sessionMode !== undefined) set.sessionMode = patch.sessionMode;
      if (patch.concurrencyLimit !== undefined) set.concurrencyLimit = patch.concurrencyLimit;
      if (patch.enabled !== undefined) set.enabled = patch.enabled;
      if (patch.pblSpec !== undefined) {
        set.pblSpec = normalizePblSpec(patch.pblSpec, memberRows, assistantRows) as unknown as Record<string, unknown> | null;
      }
      await tx.update(adminTeams).set(set).where(eq(adminTeams.id, teamId));
      if (replaced) {
        await tx.delete(adminTeamMembers).where(eq(adminTeamMembers.teamId, teamId));
        await tx.insert(adminTeamMembers).values(memberRows.map((member) => ({ ...member })));
      }
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.team.update',
        targetType: 'admin_team', targetId: teamId,
        detail: {
          changedFields: Object.keys(patch),
          membersReplaced: replaced,
          memberCount: memberRows.length,
          leaderAssistantId,
          pblSpecChanged: patch.pblSpec !== undefined,
          theoryMasteredGate: true,
        },
      }, tx);
      return toTeamConfig({ ...existing, ...set }, memberRows, assistantRows);
    });
  }

  /** 每个成员助手必须存在且 teamSelectable && enabled（硬要求 3，服务端二次校验）。 */
  private assertTeamMembers(members: readonly AdminTeamMemberInput[], assistantRows: readonly AssistantRow[]): void {
    const byId = new Map(assistantRows.map((row) => [row.id, row]));
    for (const member of members) {
      const assistant = byId.get(member.assistantId);
      if (!assistant) throw new BadRequestException(`团队成员助手 ${member.assistantId} 不存在`);
      if (!assistant.teamSelectable || !assistant.enabled) {
        throw new BadRequestException(`团队成员助手 ${member.assistantId} 未启用或不可被团队选用`);
      }
    }
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
