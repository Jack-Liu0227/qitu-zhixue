import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { parseProjectTemplateSpec, type TeachingBundleDraft } from '@qitu/contracts';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import { KnowledgeToolCatalogService } from '../knowledge/knowledge-tool-catalog.service';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import { compileTeachingBundle } from './teaching-bundle.compiler';
import { teachingValueDigest } from './teaching-bundle.canonical';
import {
  TeachingBundleCompilationError,
  type TeachingAssistantSource,
  type TeachingBundleSource,
  type TeachingToolArtifact,
} from './teaching-bundle.types';
import type { TeamVersionRecord } from './templates-binding.types';
import type { ProjectTemplateVersionRecord } from './templates.types';

/** Resolves references from the current server catalog; never accepts executable client payloads. */
@Injectable()
export class TeachingBundleCatalog {
  constructor(
    private readonly registry: PlatformRegistryService,
    private readonly models: ModelRegistryService,
    private readonly knowledge: KnowledgeCenterService,
    private readonly tools: KnowledgeToolCatalogService,
  ) {}

  async compile(version: ProjectTemplateVersionRecord, team: TeamVersionRecord, draft: TeachingBundleDraft) {
    try {
      return compileTeachingBundle(await this.resolve(version, team, draft));
    } catch (error) {
      if (error instanceof TeachingBundleCompilationError) {
        throw new BadRequestException({ code: error.code, issue: error.issue, path: error.path,
          message: `教学配置编译未通过：${error.issue} (${error.path})，草稿尚未生效` });
      }
      throw error;
    }
  }

  private async resolve(
    version: ProjectTemplateVersionRecord, team: TeamVersionRecord, draft: TeachingBundleDraft,
  ): Promise<TeachingBundleSource> {
    const reject = (issue: string, path: string): never => { throw new TeachingBundleCompilationError(issue, path); };
    if (draft.templateVersionId !== version.id || draft.teamVersionId !== team.id) {
      reject('BUNDLE_DRAFT_SCOPE_MISMATCH', 'draft');
    }
    const template = parseProjectTemplateSpec(version.content.pbl);
    const runtime = loadTutorRuntimeSource();
    if (runtime.policy.status !== 'ready' || runtime.skillsSource?.status !== 'ready') {
      throw new ServiceUnavailableException({ code: 'BUNDLE_CATALOG_UNAVAILABLE', message: '教学策略或技能目录不可用' });
    }
    if (draft.approvalPolicyVersion !== runtime.policy.version) reject('APPROVAL_POLICY_CHANGED', 'approvalPolicyVersion');
    const profile = template.curriculum?.profiles.find((entry) => entry.id === draft.scheduleProfileId);
    if (!profile) return reject('SCHEDULE_PROFILE_UNRESOLVED', 'scheduleProfileId');
    if (!team.enabled) reject('TEAM_VERSION_DISABLED', 'teamVersion');
    const members = team.members.map((raw) => {
      if (!raw || typeof raw !== 'object') return reject('ROLE_MEMBER_UNRESOLVED', 'teamVersion.members');
      const value = raw as Record<string, unknown>;
      if (typeof value.slotId !== 'string' || typeof value.assistantId !== 'string') {
        return reject('ROLE_MEMBER_UNRESOLVED', 'teamVersion.members');
      }
      return { memberId: value.slotId, assistantId: value.assistantId };
    });
    const slots = new Set(draft.roleMap.map((role) => role.roleSlotId));
    for (const slot of [...draft.skillPins, ...draft.toolIds].map((entry) => entry.roleSlotId).concat(Object.keys(draft.modelByPurpose))) {
      if (!slots.has(slot)) reject('ROLE_REFERENCE_UNRESOLVED', slot);
    }
    const assistants: TeachingAssistantSource[] = [];
    for (const member of members) {
      const roles = draft.roleMap.filter((role) => role.memberId === member.memberId);
      if (!roles.length) continue;
      const effective = await this.registry.getAssistantRuntime(member.assistantId);
      const selections: TeachingAssistantSource['modelByPurpose'] = Object.fromEntries(roles.flatMap((role) =>
        Object.entries(draft.modelByPurpose[role.roleSlotId] ?? {}).map(([purpose, selection]) => [
          purpose, { ...selection, policyVersion: runtime.policy.version },
        ])));
      // One assistant cannot have conflicting policies in two role slots.
      for (const role of roles) for (const [purpose, selection] of Object.entries(draft.modelByPurpose[role.roleSlotId] ?? {})) {
        if (teachingValueDigest(selections[purpose as keyof typeof selections]) !==
          teachingValueDigest({ ...selection, policyVersion: runtime.policy.version })) reject('ROLE_MODEL_CONFLICT', role.roleSlotId);
      }
      assistants.push({
        assistantId: member.assistantId, enabled: effective.agent.enabled,
        roleDefinition: effective.agent.roleDefinition, agentDefinition: effective.agent.agentDefinition,
        skillIds: effective.skills.map((skill) => skill.id),
        toolIds: [...effective.tools.map((tool) => tool.id), ...effective.mcpServers.flatMap((server) => server.toolIds)],
        mcpServerIds: effective.mcpServers.map((server) => server.serverId),
        modelByPurpose: selections,
      });
    }
    const sessionRoutes = draft.sessionRoutes ?? profile.sessions.map((session) => {
      const assistantId = template.phases.find((phase) => phase.phase === session.phase)?.assignedAssistantId;
      const matching = draft.roleMap.filter((role) => role.purposes.includes('dialogue') &&
        members.some((member) => member.memberId === role.memberId && member.assistantId === assistantId));
      if (matching.length !== 1) return reject('SESSION_ROLE_UNRESOLVED', `sessions.${session.sessionIndex}`);
      return { sessionIndex: session.sessionIndex, roleSlotId: matching[0]!.roleSlotId };
    });
    const requestedTools = [...new Set(draft.toolIds.map((entry) => entry.toolId))];
    const artifacts: TeachingToolArtifact[] = builtinToolRegistry.listForAgentIds(requestedTools).map((tool) => ({
      toolId: tool.id, schemaDigest: teachingValueDigest(tool), handlerVersion: tool.version, mcpServerId: null,
    }));
    let approvedKbs: string[] = [];
    if (draft.mcpServerIds.length || draft.knowledgeBaseIds.length) {
      const { config } = await this.knowledge.configuration();
      const imaEntry = Object.entries(config.knowledgeEngines).find(([, engine]) =>
        engine.provider === 'ima' && engine.enabled && engine.config.connectionRef === 'ima-legacy');
      const ima = imaEntry?.[1];
      approvedKbs = Array.isArray(ima?.config.allowedKnowledgeBaseIds)
        ? ima.config.allowedKnowledgeBaseIds.filter((id): id is string => typeof id === 'string') : [];
      for (const serverId of draft.mcpServerIds) {
        if (serverId !== 'ima-knowledge' || !ima) reject('MCP_GRANT_DENIED', serverId);
        const catalog = await this.tools.list('knowledgeEngines', imaEntry![0], true);
        if (catalog.stale || catalog.source !== 'mcp') reject('TOOL_CATALOG_UNVERIFIED', serverId);
        for (const tool of catalog.tools.filter((entry) => requestedTools.includes(entry.name))) {
          if (!tool.inputSchema) reject('TOOL_SCHEMA_UNAVAILABLE', tool.name);
          artifacts.push({ toolId: tool.name, schemaDigest: teachingValueDigest(tool.inputSchema),
            handlerVersion: 'ima-mcp.v1', mcpServerId: serverId });
        }
      }
    }
    const imaTools = artifacts.filter((tool) => tool.mcpServerId === 'ima-knowledge').map((tool) => tool.toolId);
    return {
      templateVersionId: version.id, template, scheduleProfileId: draft.scheduleProfileId,
      teamVersion: { teamVersionId: team.id, teamId: team.teamId, leaderAssistantId: team.leaderAssistantId, members },
      roles: draft.roleMap.map((role) => ({
        ...role,
        skills: draft.skillPins.filter((pin) => pin.roleSlotId === role.roleSlotId).map(({ roleSlotId: _, ...pin }) => pin),
        toolIds: draft.toolIds.filter((tool) => tool.roleSlotId === role.roleSlotId).map((tool) => tool.toolId),
      })),
      sessionRoutes, assistants,
      skillArtifacts: runtime.skills.filter((skill) => draft.skillPins.some((pin) => pin.canonicalId === skill.id)).map((skill) => ({
        canonicalId: skill.id, version: skill.version ?? '', packageDigest: skill.contentHash,
        status: skill.publicationStatus ?? 'quarantined', runtime: 'teaching',
        requiredToolIds: skill.requiredToolIds ?? [],
      })),
      tools: artifacts,
      knowledgeGrant: imaTools.length || draft.knowledgeBaseIds.length
        ? { serverId: 'ima-knowledge', knowledgeBaseIds: draft.knowledgeBaseIds, allowedTools: imaTools } : null,
      approval: {
        version: runtime.policy.version,
        models: this.models.listAgentModelOptions().filter((model) => model.available).map((model) => ({
          modelProviderId: model.providerId, modelId: model.modelId,
        })),
        toolIds: artifacts.map((tool) => tool.toolId), mcpServerIds: draft.mcpServerIds,
        imaKnowledgeBaseIds: approvedKbs,
      },
    };
  }
}
