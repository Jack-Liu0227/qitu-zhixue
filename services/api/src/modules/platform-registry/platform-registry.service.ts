import { legacyMcpManifest } from './legacy-mcp-catalog';
import { assertResourceNameAvailable, resourceNameDatabaseConflict } from '../../common/resource-name';
import { assertDomainLeader } from '../../common/intake-boundary';
import { resolveAgentModelSelection } from './agent-model-selection';
import { readTeamTemplateUsage } from './team-template-usage';
import { VisualAssetsService } from '../visual-assets/visual-assets.service';
import { resolveVisualBinding } from '../visual-assets/visual-assets.policy';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, Optional } from '@nestjs/common';
import { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
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
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { adminAssistants, adminTeamMembers, adminTeams, pblTemplateTeamBindings, agentConfigs, agentMcpBindings, agentSkillBindings, agentToolBindings, agentMemoryRecords, auditLogs, knowledgeDocuments, projectTemplates, projectTemplateVersions, runtimeMcpServers, tutorPartners, type Database, withTransaction } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { isTeachingRuntimeSkill, loadRuntimeSkillCatalog, loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { pblPhaseForProjectStage } from '../../common/pbl-phase';
import { builtinToolRegistry } from './built-in-tools';
import { BUILTIN_ASSISTANTS, QITU_LEARNING_PARTNER, KINETIC_ENERGY_PBL_SPEC, THUNDER_FIGHTER_PBL_SPEC } from '@qitu/ai-client';
import { AuditWriter } from '../../common/audit/audit.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { assertParentGraph } from './agent-config.validation';
import { assistantIdsForRuntimeAgent, runtimeIdsForAssistant } from './assistant-runtime-identity';
import { assertGateConditionWritable, resolveGateConditionForPhase } from './admin-ai-config.validation';
import type { TutorRuntimePolicy, TutorRuntimeSkill, TutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';

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
 *
 * ⚠ 这是一份**人工同步的副本**，已经漂移过一次（skills 曾长期写着不存在的
 * 'guided'/'planning'/'escalation'）。去重（导出并 import ai-client 的常量）
 * 登记在 Plan/20261018-skill-tool-governance-and-assignment.md 的 P1-b。
 */
/**
 * migration `0015_agent_runtime_bindings.sql:71-75` 给 `qitu-learning-partner` seed 的
 * 唯一教学技能。健康检查直接验证它能否解析，而不是拿「目录可读」间接推导。
 */
const SEEDED_TEACHING_SKILL_ID = 'tutor-guided-learning';

const SERVER_ASSISTANT_DEFAULTS: AssistantDefaults = {
  model: { mode: 'default', value: 'qwen3.8-flash' },
  permission: { mode: 'auto', value: 'supervised' },
  thought_level: { mode: 'high', value: 'balanced' },
  skills: { mode: 'default', value: ['tutor-guided-learning'] },
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
 * - 缺省 `gateCondition` 由**交付物推导**（`resolveGateConditionForPhase`，
 *   与校验器共用同一个函数，避免「spec 通过校验、落库却换成另一个门禁」）；
 * - 仍然经过 `assertGateConditionWritable` 运行时校验，因为联合已放宽、编译器不再兜底；
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
      const evidenceProfile = phase.evidenceProfile ?? null;
      const gate = assertGateConditionWritable(
        phase.gateCondition ?? resolveGateConditionForPhase(phase.phase, phase.deliverableType, evidenceProfile),
        phase.phase,
        phase.deliverableType,
        evidenceProfile,
      );
      const entry = {
        phase: phase.phase,
        title: phase.title,
        assignedAssistantId: phase.assignedAssistantId,
        assignedRoleLabel: phase.assignedRoleLabel ?? roleLabelFor(phase.assignedAssistantId),
        learningObjectives: [...(phase.learningObjectives ?? [])],
        gateCondition: gate,
        ...(phase.deliverableType !== undefined ? { deliverableType: phase.deliverableType } : {}),
        ...(evidenceProfile !== null ? { evidenceProfile } : {}),
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
  private readonly logger = new Logger(PlatformRegistryService.name);
  /** P0 模板漂移检查每次进程只告警一次，避免刷日志。 */
  private pblDriftReported = false;

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(DATA_MODE_TOKEN) private readonly mode: DataMode,
    private readonly audit: AuditWriter,
    private readonly models: ModelRegistryService,
    @Optional() private readonly knowledgeCenter?: KnowledgeCenterService,
    @Optional() private readonly visuals?: VisualAssetsService,
  ) {}

  async getSnapshot(): Promise<AdminRuntimeSnapshot> {
    const runtime = loadRuntimeSkillCatalog();
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

    const checks = await this.readChecks(databaseAvailable, runtime);
    const danglingBindings = await this.listDanglingAssistantBindings(runtime.skills.filter(isTeachingRuntimeSkill));
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
      runtime: skill.runtime ?? 'teaching',
      publicationStatus: skill.publicationStatus,
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
      builtInTools: builtinToolRegistry.list().map(tool => ({ ...tool, agentIds: agents.filter(agent => agent.toolIds.includes(tool.id)).map(agent => agent.id) })),
      danglingBindings,
      initialization,
    };
  }

  async getAgentRuntime(agentId: string): Promise<EffectiveAgentRuntime> {
    const runtime = loadTutorRuntimeSource();
    const agent = (await this.listAgentsFromDatabase()).find((item) => item.id === agentId);
    if (!agent) throw new NotFoundException('Agent 角色不存在');
    const adminEnabled = await this.getAdminAssistantEnabled(agentId);
    const effectiveAgent = adminEnabled === null
      ? agent
      : { ...agent, enabled: agent.enabled && adminEnabled, status: agent.enabled && adminEnabled ? 'enabled' as const : 'disabled' as const };
    const selectedSkills = runtime.skills.filter((skill) => effectiveAgent.skillIds.includes(skill.id) && skill.status === 'ready' && skill.publicationStatus === 'published');
    if (effectiveAgent.skillIds.some(id => !selectedSkills.some(skill => skill.id === id))) {
      throw new ConflictException({ code: 'ASSISTANT_SKILL_UNAVAILABLE', message: 'A bound teaching skill is unavailable' });
    }
    const tools = builtinToolRegistry.listForAgentIds(effectiveAgent.toolIds);
    const mcpServers = (await this.listMcpServerRows())
      .filter((server) => effectiveAgent.mcpServerIds.includes(server.id) && server.enabled)
      .map((server) => ({
        serverId: server.id,
        label: server.label,
        transport: server.transport as TutorAgentMcpDescriptor['transport'],
        toolIds: (effectiveAgent.mcpToolIds[server.id] ?? server.toolIds).filter((toolId) => server.toolIds.includes(toolId)),
      }));
    return { agent: effectiveAgent, policy: runtime.policy, skills: selectedSkills, tools, mcpServers };
  }

  /**
   * The teaching assistant catalogue owns its duplicated prompt/model/capability
   * bindings. Runtime-only Agents keep their existing resolver; no dual writes.
   * This is a current configuration projection, not a frozen teaching bundle.
   */
  async getAssistantRuntime(assistantId: string): Promise<EffectiveAgentRuntime> {
    if (!this.db) throw new ServiceUnavailableException('Assistant configuration storage is unavailable');
    const assistants = await this.db.select().from(adminAssistants);
    let assistant = assistants.find((row) => row.id === assistantId);
    if (!assistant) {
      const builtin = BUILTIN_ASSISTANTS.find((b) => b.id === assistantId);
      if (builtin) {
        const now = new Date();
        const toInsert = {
          id: builtin.id,
          source: 'builtin',
          name: builtin.name,
          avatar: builtin.avatar ?? null,
          description: builtin.description,
          role: builtin.role,
          enabled: builtin.enabled,
          sortOrder: builtin.sortOrder,
          modelProviderId: builtin.modelProviderId ?? null,
          modelId: builtin.modelId ?? null,
          temperature: builtin.temperature ?? null,
          instructions: builtin.instructions,
          enabledSkills: [...builtin.enabledSkills],
          toolIds: [...builtin.toolIds],
          mcpServerIds: [...builtin.mcpServerIds],
          defaults: mergeAssistantDefaults(builtin.defaults) as unknown as Record<string, unknown>,
          agentStatus: builtin.agentStatus,
          agentStatusMessage: builtin.agentStatusMessage ?? null,
          teamSelectable: builtin.teamSelectable,
          createdAt: builtin.createdAt ? new Date(builtin.createdAt) : now,
          updatedAt: builtin.updatedAt ? new Date(builtin.updatedAt) : now,
        };
        try {
          const insertBuilder = this.db.insert(adminAssistants).values(toInsert as any);
          if (typeof (insertBuilder as any)?.onConflictDoNothing === 'function') {
            await (insertBuilder as any).onConflictDoNothing({ target: adminAssistants.id });
          } else {
            await insertBuilder;
          }
          const fresh = await this.db.select().from(adminAssistants);
          assistant = fresh.find((row) => row.id === assistantId) ?? (toInsert as any);
        } catch (error) {
          const nameConflict = resourceNameDatabaseConflict(error);
          if (nameConflict) throw nameConflict;
          assistant = toInsert as any;
        }
      }
    }
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Teaching assistant is unavailable' });

    const isCopilot = assistantId === 'qitu-assistant' || assistant.role?.includes('Copilot');
    const runtime = isCopilot ? loadRuntimeSkillCatalog() : loadTutorRuntimeSource();
    const selectedSkills = runtime.skills.filter((skill) =>
      assistant.enabledSkills.includes(skill.id) && skill.status === 'ready' && (isCopilot || skill.publicationStatus === 'published')
    );
    if (!isCopilot && assistant.enabledSkills.some((id) => !selectedSkills.some((skill) => skill.id === id))) {
      throw new ConflictException({ code: 'ASSISTANT_SKILL_UNAVAILABLE', message: 'A bound teaching skill is unavailable' });
    }
    // Only exact identity and the explicit historical leader alias may restrict
    // this assistant. Another role's configuration is never inherited.
    const runtimeIds = new Set(runtimeIdsForAssistant(assistantId));
    const configs = (await this.db.select().from(agentConfigs)).filter((config) => runtimeIds.has(config.id));
    const mcpBindings = configs.length === 0 ? [] : await this.db.select().from(agentMcpBindings);
    const exactConfig = configs.find((config) => config.id === assistantId);
    const enabled = (isCopilot ? true : assistant.enabled) && configs.every((config) => config.enabled);
    const modelUsage = exactConfig?.modelUsage ?? (isCopilot ? 'admin.copilot' : 'tutor.chat');
    const selection = resolveAgentModelSelection({
      modelProviderId: assistant.modelProviderId, modelId: assistant.modelId, modelUsage,
    }, (usage) => this.models.resolvePurpose(usage).available ? this.models.resolve(usage) : null);
    const selectedModel = (this.models.listAgentModelOptions?.() ?? [])
      .find((option) => option.providerId === selection.providerId && option.modelId === selection.modelId);
    const mcpServers = (await this.listMcpServerRows())
      .filter((server) => server.enabled && assistant.mcpServerIds.includes(server.id))
      .map((server) => ({
        serverId: server.id, label: server.label,
        transport: server.transport as TutorAgentMcpDescriptor['transport'],
        toolIds: server.toolIds.filter((toolId) => configs.every((config) => mcpBindings.some((binding) =>
          binding.agentId === config.id && binding.mcpServerId === server.id && binding.enabled && binding.allowedToolIds.includes(toolId)))),
      })).filter((server) => server.toolIds.length > 0)
      .sort((left, right) => left.serverId.localeCompare(right.serverId));
    return {
      agent: {
        id: assistant.id, label: assistant.name, description: assistant.description, role: assistant.role,
        roleDefinition: assistant.role, agentDefinition: assistant.instructions,
        parentAgentId: exactConfig?.parentAgentId ?? null, enabled, status: enabled ? 'enabled' : 'disabled',
        modelUsage, modelBinding: assistant.modelProviderId === null && assistant.modelId === null ? 'usage' : 'agent',
        modelProviderId: selection.providerId, modelId: selection.modelId,
        modelLabel: selectedModel?.modelLabel ?? null, modelAvailable: selectedModel?.available ?? false,
        promptVersion: `admin-assistant:${assistant.id}:${assistant.updatedAt instanceof Date ? assistant.updatedAt.toISOString() : (assistant.updatedAt ? new Date(assistant.updatedAt).toISOString() : new Date().toISOString())}`,
        capabilities: ['teach'].filter((capability) => configs.every((config) => config.capabilities.includes(capability))),
        skillIds: [...assistant.enabledSkills], toolIds: [...assistant.toolIds],
        mcpServerIds: [...assistant.mcpServerIds],
        mcpToolIds: Object.fromEntries(mcpServers.map((server) => [server.serverId, [...server.toolIds]])),
      },
      policy: runtime.policy, skills: selectedSkills,
      tools: builtinToolRegistry.listForAgentIds(assistant.toolIds), mcpServers,
    };
  }

  isModelAvailable(selection: { modelProviderId: string; modelId: string }): boolean {
    return (this.models.listAgentModelOptions?.() ?? []).some((option) => option.available
      && option.providerId === selection.modelProviderId && option.modelId === selection.modelId);
  }

  /**
   * Resolve the admin catalogue switch for a runtime Agent. A missing table or
   * missing binding keeps the existing runtime-only behavior for older
   * installations; a present binding is fail-closed on `enabled = false`.
   */
  private async getAdminAssistantEnabled(agentId: string): Promise<boolean | null> {
    if (!this.db) return null;
    const assistantIds = assistantIdsForRuntimeAgent(agentId);
    try {
      const rows = await this.db.select().from(adminAssistants);
      const bound = rows.filter((row) => assistantIds.includes(row.id));
      if (bound.length === 0) return null;
      return bound.every((row) => row.enabled);
    } catch {
      return null;
    }
  }

  /** Resolve the team frozen in a template version's content.linkedTeamId. */
  async getTeamForTemplateVersion(templateVersionId: string): Promise<AdminTeamConfig | null> {
    if (!this.db) return null;
    const [version] = await this.db.select({ content: projectTemplateVersions.content })
      .from(projectTemplateVersions)
      .where(eq(projectTemplateVersions.id, templateVersionId))
      .limit(1);
    const content = version?.content as Record<string, unknown> | null | undefined;
    const teamId = typeof content?.linkedTeamId === 'string' ? content.linkedTeamId : null;
    if (!teamId) return null;
    const teams = await this.listTeams();
    return teams.find((team) => team.id === teamId && team.enabled) ?? null;
  }

  async resolveProjectAssistantId(templateVersionId: string | null, projectStage: string): Promise<string> {
    if (templateVersionId === null) return 'qitu-intake-assistant';
    const team = await this.getTeamForTemplateVersion(templateVersionId);
    if (!team) return 'qitu-intake-assistant';
    const phase = pblPhaseForProjectStage(projectStage);
    return team.pblSpec?.phases.find((candidate) => candidate.phase === phase)?.assignedAssistantId ?? team.leaderAssistantId;
  }
  async getTutorAssistantStatusById(assistantId: string): Promise<{ id: string; name: string; enabled: boolean } | null> {
    if (!this.db) return null;
    try {
      const rows = await this.db.select().from(adminAssistants);
      const assistant = rows.find((row) => row.id === assistantId);
      return assistant ? { id: assistant.id, name: assistant.name, enabled: assistant.enabled } : null;
    } catch {
      return null;
    }
  }

  /**
   * Deprecated title-based lookup intentionally removed. Runtime callers must
   * use `resolveProjectAssistantId(templateVersionId, stage)` instead.
   */

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
          const selection = resolveAgentModelSelection(config, (usage) =>
            this.models.resolvePurpose(usage).available ? this.models.resolve(usage) : null);
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
            modelBinding: config.modelProviderId === null && config.modelId === null ? 'usage' as const : 'agent' as const,
            modelProviderId: selection.providerId,
            modelId: selection.modelId,
            modelLabel: modelOptions.find((option) => option.providerId === selection.providerId && option.modelId === selection.modelId)?.modelLabel ?? null,
            modelAvailable: modelOptions.some((option) => option.providerId === selection.providerId && option.modelId === selection.modelId && option.available),
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
      const servers = await this.db.select().from(runtimeMcpServers);
      const configMcp = this.knowledgeCenter ? (await this.knowledgeCenter.configuration()).config.mcpServers : {};
      return servers.map((s) => {
        const effective = configMcp[s.id]
          || configMcp[`mcp-${s.id}`]
          || Object.values(configMcp).find((c: any) => c?.name === s.id || c?.name === s.label);
        const manifest = legacyMcpManifest(s.id) || legacyMcpManifest(s.label);
        const manifestTools = manifest?.tools.map((t) => t.name) ?? [];

        let toolIds = s.toolIds && s.toolIds.length > 0 ? [...s.toolIds] : [];
        if (effective && Array.isArray(effective.tools) && effective.tools.length > 0) {
          toolIds = effective.tools as string[];
        } else if (toolIds.length === 0 && manifestTools.length > 0) {
          toolIds = manifestTools;
        }

        const toolCount = s.toolCount ?? toolIds.length;

        if (s.id === 'ima-knowledge') {
          return {
            ...s,
            enabled: (configMcp['ima-main'] as any)?.enabled === true || s.enabled,
            toolIds,
            toolCount: toolIds.length,
          };
        }

        return {
          ...s,
          enabled: effective ? effective.enabled === true : s.enabled,
          label: String(effective?.name || s.label || s.id),
          toolIds,
          toolCount,
        };
      });
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
      toolCount: server.toolCount ?? server.toolIds?.length ?? 0,
      endpointOrigin: server.endpointOrigin,
      lastCheckedAt: server.lastCheckedAt?.toISOString() ?? null,
      lastError: server.lastError,
    }));
  }

  async updateAgent(actor: CurrentUser, agentId: string, input: AdminRuntimeAgentUpdateRequest): Promise<AdminRuntimeAgent> {
    if (!this.db) throw new ServiceUnavailableException('角色治理存储不可用');
    const allowedCapabilities = new Set(['explore', 'plan', 'teach', 'review', 'reflect']);
    const label = input.label?.trim();
    if (label !== undefined) assertResourceNameAvailable('agent', label,
      (await this.listAgentsFromDatabase()).map(agent => ({ id: agent.id, name: agent.label })), agentId);
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
    assertResourceNameAvailable('agent', input.label, agents.map(agent => ({ id: agent.id, name: agent.label })));
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
    let rows = await this.db
      .select()
      .from(adminAssistants)
      .orderBy(asc(adminAssistants.sortOrder), asc(adminAssistants.id));

    const existingIds = new Set(rows.map((r) => r.id));
    const missingBuiltins = BUILTIN_ASSISTANTS.filter((b) => !existingIds.has(b.id));

    if (missingBuiltins.length > 0) {
      try {
        const now = new Date();
        const toInsert = missingBuiltins.map((b) => ({
          id: b.id,
          source: 'builtin',
          name: b.name,
          avatar: b.avatar ?? null,
          description: b.description,
          role: b.role,
          enabled: b.enabled,
          sortOrder: b.sortOrder,
          modelProviderId: b.modelProviderId ?? null,
          modelId: b.modelId ?? null,
          temperature: b.temperature ?? null,
          instructions: b.instructions,
          enabledSkills: [...b.enabledSkills],
          toolIds: [...b.toolIds],
          mcpServerIds: [...b.mcpServerIds],
          defaults: mergeAssistantDefaults(b.defaults) as unknown as Record<string, unknown>,
          agentStatus: b.agentStatus,
          agentStatusMessage: b.agentStatusMessage ?? null,
          teamSelectable: b.teamSelectable,
          createdAt: b.createdAt ? new Date(b.createdAt) : now,
          updatedAt: b.updatedAt ? new Date(b.updatedAt) : now,
        }));
        const insertBuilder = this.db.insert(adminAssistants).values(toInsert as any);
        if (typeof (insertBuilder as any)?.onConflictDoNothing === 'function') {
          await (insertBuilder as any).onConflictDoNothing({ target: adminAssistants.id });
        } else {
          await insertBuilder;
        }
        rows = await this.db
          .select()
          .from(adminAssistants)
          .orderBy(asc(adminAssistants.sortOrder), asc(adminAssistants.id));
      } catch (err) {
        const nameConflict = resourceNameDatabaseConflict(err);
        if (nameConflict) throw nameConflict;
        this.logger.warn(`Failed to auto-seed missing builtin assistants: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const configs = rows.map(toAssistantConfig);
    const finalIds = new Set(configs.map((c) => c.id));
    for (const b of BUILTIN_ASSISTANTS) {
      if (!finalIds.has(b.id)) {
        configs.push({ ...b });
      }
    }
    if (this.visuals) {
      const bindings = await this.visuals.presentationSnapshot();
      for (const config of configs) config.avatar = this.visuals.avatar(config.id, config.avatar, bindings);
    }
    return configs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
  }

  /**
   * 创建助手：`id` / `source: 'user'` / `deletable`（读取侧派生）/ `agentStatus:
   * 'unchecked'` / `createdAt` / `updatedAt` 全部由服务端补全；`sortOrder` 缺省
   * 追加到列表末尾。
   */
  async createAssistant(actor: CurrentUser, input: AdminAssistantCreateInput, creationId?: string): Promise<AdminAssistantConfig> {
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    await this.assertAssistantReferences(input);
    const rows = await this.db.select().from(adminAssistants);
    const replay = creationId ? rows.find(row => row.id === creationId) : undefined;
    if (replay) return this.assistantVisualView(toAssistantConfig(replay));
    assertResourceNameAvailable('assistant', input.name, [...rows, ...BUILTIN_ASSISTANTS.filter(b => !rows.some(row => row.id === b.id))]);
    const now = new Date();
    const id = creationId ?? `assistant-${randomUUID()}`;
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
    return this.assistantVisualView(toAssistantConfig(record));
  }

  async updateAssistant(actor: CurrentUser, assistantId: string, patch: AdminAssistantUpdateInput, expectedUpdatedAt?: string): Promise<AdminAssistantConfig> {
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    return withTransaction(this.db, async (tx) => {
      const rows = expectedUpdatedAt
        ? await tx.select().from(adminAssistants).where(eq(adminAssistants.id, assistantId)).for('update')
        : await tx.select().from(adminAssistants);
      let existing = rows.find((row) => row.id === assistantId);
      if (!existing) {
        const builtin = BUILTIN_ASSISTANTS.find((b) => b.id === assistantId);
        if (builtin) {
          const now = new Date();
          const record: AssistantRow = {
            id: builtin.id,
            source: 'builtin',
            name: builtin.name,
            avatar: builtin.avatar ?? null,
            description: builtin.description,
            role: builtin.role,
            enabled: builtin.enabled,
            sortOrder: builtin.sortOrder,
            modelProviderId: builtin.modelProviderId ?? null,
            modelId: builtin.modelId ?? null,
            temperature: builtin.temperature ?? null,
            instructions: builtin.instructions,
            enabledSkills: [...builtin.enabledSkills],
            toolIds: [...builtin.toolIds],
            mcpServerIds: [...builtin.mcpServerIds],
            defaults: mergeAssistantDefaults(builtin.defaults) as unknown as Record<string, unknown>,
            agentStatus: builtin.agentStatus,
            agentStatusMessage: builtin.agentStatusMessage ?? null,
            teamSelectable: builtin.teamSelectable,
            updatedBy: actor.id,
            createdAt: builtin.createdAt ? new Date(builtin.createdAt) : now,
            updatedAt: now,
          };
          await tx.insert(adminAssistants).values({ ...record });
          existing = record;
        } else {
          throw new NotFoundException('助手不存在');
        }
      }
      if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new ConflictException({ code: 'COPILOT_RESOURCE_CHANGED', message: '助手已被修改，请重新读取后生成计划' });
      }
      const now = new Date();
      // 引用校验必须晚于 existing 解析：管理面矩阵提交的是「存量数组 ± 一项」
      // （tools/page.tsx:213-216、264-266），只有拿到存量才能只拦「本次新引入」的未知 id，
      // 否则任何带历史脏引用的助手都无法再被授权。脏引用不在此静默清理，
      // 由 snapshot.danglingBindings 暴露给管理面。
      await this.assertAssistantReferences(patch, {
        enabledSkills: existing.enabledSkills,
        toolIds: existing.toolIds,
        mcpServerIds: existing.mcpServerIds,
      });
      const set: Partial<typeof adminAssistants.$inferInsert> = { updatedBy: actor.id, updatedAt: now };
      if (patch.name !== undefined) {
        const catalog = expectedUpdatedAt ? await tx.select().from(adminAssistants) : rows;
        assertResourceNameAvailable('assistant', patch.name, [...catalog, ...BUILTIN_ASSISTANTS.filter(b => !catalog.some(row => row.id === b.id))], assistantId);
        set.name = patch.name;
      }
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

  private async assistantVisualView(config: AdminAssistantConfig): Promise<AdminAssistantConfig> {
    if (!this.visuals) return config;
    const bindings = await this.visuals.presentationSnapshot();
    return { ...config, avatar: this.visuals.avatar(config.id, config.avatar, bindings) };
  }

  async listTeams(): Promise<AdminTeamConfig[]> {
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    const [teams, members, assistants] = await Promise.all([
      this.db.select().from(adminTeams).orderBy(asc(adminTeams.createdAt), asc(adminTeams.id)),
      this.db.select().from(adminTeamMembers).orderBy(asc(adminTeamMembers.sortOrder)),
      this.db.select().from(adminAssistants),
    ]);
    if (!this.pblDriftReported) {
      this.pblDriftReported = true;
      this.reportPblTemplateDrift(teams);
    }
    const configs = teams.map((team) => toTeamConfig(team, members.filter((member) => member.teamId === team.id), assistants));
    if (this.visuals) {
      const bindings = await this.visuals.presentationSnapshot();
      for (const config of configs) {
        config.iconAssetId = resolveVisualBinding({ kind: 'team', id: config.id }, 'icon', bindings).effectiveAssetId;
        for (const member of config.members) member.avatar = this.visuals.avatar(member.assistantId, member.avatar, bindings);
      }
    }
    return configs;
  }

  /**
   * P0 模板漂移检查：**只读并告警，绝不写库**。
   *
   * 背景：`database/seeds/admin-ai-config.sql` 里的 `pbl_spec` 是 JSONB 文本，
   * 而 `@qitu/ai-client` 的同名 TS 常量是评测/编排侧的另一份声明。两份内容一旦
   * 分叉，学生看到的阶段标签与服务端门禁就会不一致。种子里的
   * `ON CONFLICT DO UPDATE SET pbl_spec = EXCLUDED.pbl_spec` 对管理员在后台改过的
   * spec 是**破坏性**的（会静默覆盖），因此**不能**用种子作为对账手段；
   * 这里只做读-比-告警。
   *
   * 检查两件事：
   * 1. 保留的两个模板（`pbl-thunder-fighter` / `pbl-kinetic-energy`）是否都在库里；
   * 2. 库里每个模板的 `phases[].gateCondition` 是否与代码常量逐字一致。
   *
   * 不抛异常：漂移是运营问题，不该让管理端接口 500。
   */
  private reportPblTemplateDrift(teams: readonly TeamRow[]): void {
    try {
      const canonical = new Map(
        [THUNDER_FIGHTER_PBL_SPEC, KINETIC_ENERGY_PBL_SPEC].map((spec) => [spec.projectId, spec]),
      );
      const present = new Set<string>();
      for (const team of teams) {
        const raw = team.pblSpec as Record<string, unknown> | null;
        const projectId = typeof raw?.projectId === 'string' ? raw.projectId : null;
        if (projectId === null) continue;
        present.add(projectId);
        const expected = canonical.get(projectId);
        if (!expected) {
          this.logger.warn(`PBL 模板漂移：团队 ${team.id} 引用未在代码常量中登记的 projectId=${projectId}（代码侧只有 ${[...canonical.keys()].join(' / ')}）`);
          continue;
        }
        const expectedGates = new Map(expected.phases.map((phase) => [phase.phase, phase.gateCondition]));
        const actualPhases = Array.isArray(raw?.phases) ? (raw?.phases as Record<string, unknown>[]) : [];
        for (const [phase, gate] of expectedGates) {
          const actual = actualPhases.find((item) => item.phase === phase);
          const actualGate = typeof actual?.gateCondition === 'string' ? actual.gateCondition : null;
          if (actualGate !== gate) {
            this.logger.warn(`PBL 模板漂移：团队 ${team.id} 阶段 ${phase} 的 gateCondition 库里为 ${actualGate ?? '(缺失)'}，代码常量为 ${gate}`);
          }
        }
      }
      for (const projectId of canonical.keys()) {
        if (!present.has(projectId)) {
          this.logger.warn(`PBL 模板缺失：代码常量声明了 ${projectId}，但 admin_teams 中没有对应模板行`);
        }
      }
    } catch (error) {
      this.logger.warn(`PBL 模板漂移检查失败（只读检查，不影响接口）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createTeam(actor: CurrentUser, input: AdminTeamCreateInput, creationId?: string): Promise<AdminTeamConfig> {
    assertDomainLeader(input.leaderAssistantId);
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    const replay = creationId ? (await this.listTeams()).find(team => team.id === creationId) : undefined;
    if (replay) return replay;
    assertResourceNameAvailable('team', input.name, await this.db.select().from(adminTeams));
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
    const id = creationId ?? `team-${randomUUID()}`;
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
  async updateTeam(actor: CurrentUser, teamId: string, patch: AdminTeamUpdateInput, expectedUpdatedAt?: string): Promise<AdminTeamConfig> {
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    return withTransaction(this.db, async (tx) => {
      const teams = expectedUpdatedAt
        ? await tx.select().from(adminTeams).where(eq(adminTeams.id, teamId)).for('update')
        : await tx.select().from(adminTeams);
      const existing = teams.find((team) => team.id === teamId);
      if (!existing) throw new NotFoundException('团队不存在');
      if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
        throw new ConflictException({ code: 'COPILOT_RESOURCE_CHANGED', message: '团队已被修改，请重新读取后生成计划' });
      }
      if (patch.name !== undefined) assertResourceNameAvailable('team', patch.name,
        expectedUpdatedAt ? await tx.select().from(adminTeams) : teams, teamId);
      const allMembers = await tx.select().from(adminTeamMembers);
      const currentMembers = allMembers.filter((member) => member.teamId === teamId);
      const assistantRows = await tx.select().from(adminAssistants);
      const leaderAssistantId = patch.leaderAssistantId ?? existing.leaderAssistantId;
      assertDomainLeader(leaderAssistantId);
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

  async deleteAssistant(actor: CurrentUser, assistantId: string, expectedUpdatedAt?: string): Promise<{ success: true; deletedAssistantId: string }> {
    if (actor.role !== 'admin') throw new ForbiddenException('助手删除仅管理员可用');
    if (!this.db) throw new ServiceUnavailableException('助手配置存储不可用');
    return withTransaction(this.db, async tx => {
      const [existing] = await tx.select().from(adminAssistants).where(eq(adminAssistants.id, assistantId)).for('update');
      if (!existing) throw new NotFoundException('助手不存在');
      if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'ADMIN_AI_CONFIG_CONFLICT', message: '助手已变化，请回读后重新删除' });
      const members = await tx.select({ id: adminTeamMembers.slotId }).from(adminTeamMembers).where(eq(adminTeamMembers.assistantId, assistantId)).limit(1);
      const teams = await tx.select({ id: adminTeams.id }).from(adminTeams).where(sql`${adminTeams.leaderAssistantId}=${assistantId} OR ${adminTeams.pblSpec}::jsonb->'phases' @> ${JSON.stringify([{ assignedAssistantId: assistantId }])}::jsonb`).limit(1);
      const versions = await tx.select({ id: pblTemplateTeamBindings.id }).from(pblTemplateTeamBindings).where(sql`EXISTS (SELECT 1 FROM jsonb_each(${pblTemplateTeamBindings.teamSnapshots}) AS frozen WHERE frozen.value->>'leaderAssistantId'=${assistantId} OR frozen.value->'members' @> ${JSON.stringify([{ assistantId }])}::jsonb)`).limit(1);
      if (members.length || teams.length || versions.length) throw new ConflictException({ code: 'ASSISTANT_IN_USE', message: '助手仍被团队或教学绑定引用，请先解除当前关联；历史来源可停用，不能删除' });
      const purposes = await tx.execute<{ used: boolean }>(sql`SELECT (
        EXISTS(SELECT 1 FROM platform_configuration_revisions p WHERE p.revision=(SELECT max(revision) FROM platform_configuration_revisions)
          AND (p.config->'growthProjection'->>'profileAssistantId'=${assistantId} OR p.config->'growthProjection'->>'growthAssistantId'=${assistantId}
            OR p.config->'platformTools'->'project-knowledge'->'boundAssistants' @> ${JSON.stringify([assistantId])}::jsonb))
        OR EXISTS(SELECT 1 FROM knowledge_base_agent_bindings b JOIN knowledge_bases k ON k.id=b.kb_id
          WHERE b.agent_id=${assistantId} AND b.enabled=true AND k.lifecycle='active')
        OR EXISTS(SELECT 1 FROM agent_configs WHERE parent_agent_id=${assistantId})
      ) AS used`);
      if (purposes.rows[0]?.used !== false) throw new ConflictException({ code: 'ASSISTANT_IN_USE', message: '助手仍有画像、成长、知识库授权或子 Agent 引用，请先解除用途关联' });
      const runtimeIds = [...runtimeIdsForAssistant(assistantId)];
      await tx.delete(agentSkillBindings).where(inArray(agentSkillBindings.agentId, runtimeIds));
      await tx.delete(agentToolBindings).where(inArray(agentToolBindings.agentId, runtimeIds));
      await tx.delete(agentMcpBindings).where(inArray(agentMcpBindings.agentId, runtimeIds));
      await tx.delete(agentConfigs).where(inArray(agentConfigs.id, runtimeIds));
      await tx.delete(adminAssistants).where(eq(adminAssistants.id, assistantId));
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.assistant.delete',
        targetType: 'admin_assistant', targetId: assistantId, detail: { name: existing.name, source: existing.source, role: existing.role } }, tx);
      return { success: true, deletedAssistantId: assistantId };
    });
  }

  async getTeamTemplateUsage(actor: CurrentUser, teamId: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('团队关联仅管理员可查看');
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    const [team] = await this.db.select().from(adminTeams).where(eq(adminTeams.id, teamId)).limit(1);
    if (!team) throw new NotFoundException('团队不存在');
    return readTeamTemplateUsage(this.db, teamId, team.updatedAt);
  }

  async deleteTeam(actor: CurrentUser, teamId: string, expectedUpdatedAt?: string): Promise<{ success: true; deletedTeamId: string }> {
    if (actor.role !== 'admin') throw new ForbiddenException('团队删除仅管理员可用');
    if (!this.db) throw new ServiceUnavailableException('团队配置存储不可用');
    return withTransaction(this.db, async tx => {
      const [existing] = await tx.select().from(adminTeams).where(eq(adminTeams.id, teamId)).for('update');
      if (!existing) throw new NotFoundException('团队不存在');
      if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException({ code: 'ADMIN_AI_CONFIG_CONFLICT', message: '团队已变化，请回读后重新删除' });
      const usage = await readTeamTemplateUsage(tx, teamId, existing.updatedAt);
      await tx.delete(adminTeamMembers).where(eq(adminTeamMembers.teamId, teamId));
      await tx.delete(adminTeams).where(eq(adminTeams.id, teamId));
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.team.delete',
        targetType: 'admin_team', targetId: teamId, detail: { name: existing.name, leaderAssistantId: existing.leaderAssistantId,
          retainedTemplateCount: usage.templateCount, retainedBindingCount: usage.bindingCount,
          retainedProjectCount: usage.projectCount, frozenConfigurationPreserved: true } }, tx);
      return { success: true, deletedTeamId: teamId };
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

  private async assertAssistantReferences(
    input: Pick<AdminAssistantCreateInput, 'enabledSkills' | 'toolIds' | 'mcpServerIds'>,
    baseline?: { enabledSkills: readonly string[]; toolIds: readonly string[]; mcpServerIds: readonly string[] },
  ): Promise<void> {
    const runtime = loadRuntimeSkillCatalog();
    if (input.enabledSkills !== undefined) {
      const deniedScopes = new Set(runtime.skills.filter(skill => !isTeachingRuntimeSkill(skill)).map(skill => skill.id));
      const deniedSkill = input.enabledSkills.find(id => deniedScopes.has(id));
      if (deniedSkill) throw new BadRequestException({
        code: 'ASSISTANT_SKILL_SCOPE_INVALID',
        message: `Skill ${deniedSkill} 不属于教学运行范围，不能绑定普通助手`,
      });
      const unavailable = input.enabledSkills.find(id => runtime.skills.some(skill => skill.id === id && skill.status !== 'ready') && !(baseline?.enabledSkills ?? []).includes(id));
      if (unavailable) throw new BadRequestException({ code: 'ASSISTANT_SKILL_UNAVAILABLE', message: 'Only published skills can be newly bound' });
      const knownSkills = new Set(runtime.skills.filter(isTeachingRuntimeSkill).map((skill) => skill.id));
      const inherited = new Set(baseline?.enabledSkills ?? []);
      const unknownSkill = input.enabledSkills.find((skillId) => !knownSkills.has(skillId) && !inherited.has(skillId));
      if (unknownSkill !== undefined) throw new BadRequestException(`未知的 Skill: ${unknownSkill}`);
    }
    if (input.toolIds !== undefined) {
      const knownTools = new Set(builtinToolRegistry.list().map((tool) => tool.id));
      const inherited = new Set(baseline?.toolIds ?? []);
      const unknownTool = input.toolIds.find((toolId) => !knownTools.has(toolId) && !inherited.has(toolId));
      if (unknownTool !== undefined) throw new BadRequestException(`未知的内置 Tool: ${unknownTool}`);
    }
    if (input.mcpServerIds !== undefined) {
      const knownMcpServers = new Set((await this.listMcpServerRows()).map((server) => server.id));
      const inherited = new Set(baseline?.mcpServerIds ?? []);
      const unknownMcpServer = input.mcpServerIds.find((serverId) => !knownMcpServers.has(serverId) && !inherited.has(serverId));
      if (unknownMcpServer !== undefined) throw new BadRequestException(`未知的 MCP Server: ${unknownMcpServer}`);
    }
  }

  private async listDanglingAssistantBindings(
    skills: readonly TutorRuntimeSkill[],
  ): Promise<AdminRuntimeSnapshot['danglingBindings']> {
    // null 与 [] 语义不同：null = 无法计算，[] = 确实没有脏引用。
    // 这里绝不能 catch 后返回 []：本字段是 D3 存量脏引用的**唯一暴露面**，
    // 把查询失败伪装成「干净」等于把 D5 的静默失败反模式复制到新监控信号上。
    if (!this.db) return null;
    try {
      const [assistants, mcpServers] = await Promise.all([
        this.db.select().from(adminAssistants),
        this.listMcpServerRows(),
      ]);
      const knownSkills = new Set(skills.map((skill) => skill.id));
      const knownTools = new Set(builtinToolRegistry.list().map((tool) => tool.id));
      const knownMcpServers = new Set(mcpServers.map((server) => server.id));
      return assistants.flatMap((assistant) => {
        const unknownSkillIds = assistant.enabledSkills.filter((skillId) => !knownSkills.has(skillId));
        const unknownToolIds = assistant.toolIds.filter((toolId) => !knownTools.has(toolId));
        const unknownMcpServerIds = assistant.mcpServerIds.filter((serverId) => !knownMcpServers.has(serverId));
        return unknownSkillIds.length > 0 || unknownToolIds.length > 0 || unknownMcpServerIds.length > 0
          // source 让管理面能把「内置助手的已知存量债务」与「新出现的脏引用」分开看，
          // 否则信号恒定非空、无法当告警用。
          ? [{ assistantId: assistant.id, source: assistant.source, unknownSkillIds, unknownToolIds, unknownMcpServerIds }]
          : [];
      });
    } catch (error) {
      this.logger.warn(`无法计算 danglingBindings：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async readChecks(databaseAvailable: boolean, runtime?: TutorRuntimeSource): Promise<AdminRuntimeSnapshot['initialization']['checks']> {
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
    checks.push(this.buildSkillsCheck(runtime, checkedAt));
    return checks;
  }

  /**
   * 技能目录健康检查。
   *
   * 判据必须能支撑文案：不能拿「目录可读」推导「学生拿得到教学规则」。
   * 目录可读但 seed 绑定的技能缺失/正文为空时， prompt 里什么也没有，
   * 这正是 D5 要消灭的「看着绿其实空」，不能换个地方重犯。
   * 反之，单个**无关**技能包损坏也不得把全局 overall 推到 degraded，
   * 只进 detail。
   */
  private buildSkillsCheck(
    runtime: TutorRuntimeSource | undefined,
    checkedAt: string,
  ): AdminRuntimeSnapshot['initialization']['checks'][number] {
    const skillsSource = runtime?.skillsSource;
    // 管理面不需要部署绝对路径；能相对化就相对化。
    const root = skillsSource === undefined
      ? null
      : runtime !== undefined && skillsSource.root.startsWith(runtime.root)
        ? skillsSource.root.slice(runtime.root.length).replace(/^\/+/, '') || '.'
        : skillsSource.root;
    const seeded = runtime?.skills.find((skill) => skill.id === SEEDED_TEACHING_SKILL_ID);
    const seededReady = seeded?.status === 'ready' && seeded.content.trim().length > 0;
    const broken = skillsSource?.brokenPackages ?? [];
    const brokenNote = broken.length > 0
      ? ` 另有 ${broken.length} 个技能包损坏（${broken.map((entry) => entry.id).join('、')}），不影响本项判定。`
      : '';

    let status: 'ready' | 'missing' | 'failed' | 'unknown';
    let detail: string;
    if (skillsSource === undefined) {
      status = 'unknown';
      detail = `技能目录状态无法确认；无法判定 migration 0015 seed 绑定的 ${SEEDED_TEACHING_SKILL_ID} 是否可解析。`;
    } else if (skillsSource.status === 'missing') {
      status = 'missing';
      detail = `技能目录缺失（${root}）；migration 0015 seed 绑定的 ${SEEDED_TEACHING_SKILL_ID} 无法解析，学生拿不到教学规则。`;
    } else if (skillsSource.status === 'unreadable') {
      status = 'failed';
      detail = `技能目录不可读（${root}）；migration 0015 seed 绑定的 ${SEEDED_TEACHING_SKILL_ID} 无法解析，学生拿不到教学规则。${skillsSource.detail ? ` 诊断：${skillsSource.detail}` : ''}`;
    } else if (!seededReady) {
      status = 'failed';
      const why = seeded === undefined
        ? '目录不存在'
        : seeded.status !== 'ready'
          ? `status=${seeded.status}`
          : '正文为空';
      detail = `技能目录可读（${root}），但 migration 0015 seed 绑定的 ${SEEDED_TEACHING_SKILL_ID} 不可用（${why}），学生拿不到教学规则。${brokenNote}`;
    } else {
      status = 'ready';
      detail = `技能目录就绪（${root}），${SEEDED_TEACHING_SKILL_ID} 可解析并会注入教学规则。${brokenNote}`;
    }

    return {
      id: 'runtime.skills',
      label: 'Tutor 技能目录',
      area: 'tutor',
      status,
      detail,
      checkedAt,
      remediation: status === 'ready'
        ? null
        : `请在部署节点确认 .agents/skills/${SEEDED_TEACHING_SKILL_ID}/SKILL.md 存在、可读且正文非空，然后重新检查运行时健康状态。`,
      lastRun: null,
      operatorRequired: true,
      executeAllowed: false,
    };
  }
}
