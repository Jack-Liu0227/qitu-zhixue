import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EffectiveAgentRuntime } from './platform-registry.service';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

export const TEAM_PUBLICATION_SCHEMA = 'qitu.team-version.v1' as const;
export interface PublishedAssistantSnapshot {
  schemaVersion: typeof TEAM_PUBLICATION_SCHEMA;
  assistantId: string;
  promptVersion: string;
  roleDefinition: string;
  agentDefinition: string;
  model: { modelProviderId: string; modelId: string };
  skills: { canonicalId: string; version: string; packageDigest: string }[];
  tools: { toolId: string; handlerVersion: string; schemaDigest: string }[];
  mcpPermissions: { serverId: string; toolIds: string[] }[];
  digest: string;
}
function invalid(code: string): never {
  throw new BadRequestException({ code, message: '团队版本快照不完整、配置不可用或已被撤权，请检查成员配置。' });
}

/** Only an owner-resolved runtime can become publication input; never accept this from HTTP. */
export function freezeTeamAssistant(runtime: EffectiveAgentRuntime): PublishedAssistantSnapshot {
  const { agent } = runtime;
  if (!agent.enabled || !agent.capabilities.includes('teach') || !agent.modelAvailable || !agent.modelProviderId || !agent.modelId || !agent.promptVersion) invalid('TEAM_VERSION_ASSISTANT_UNAVAILABLE');
  if (runtime.policy.status !== 'ready') invalid('TEAM_VERSION_POLICY_UNAVAILABLE');
  if (agent.skillIds.some(id => !runtime.skills.some(skill => skill.id === id)) ||
    runtime.skills.some(skill => skill.runtime !== 'teaching' || skill.status !== 'ready' || skill.publicationStatus !== 'published' || !skill.version)) invalid('TEAM_VERSION_SKILL_UNAVAILABLE');
  if (agent.toolIds.some(id => !runtime.tools.some(tool => tool.id === id)) ||
    agent.mcpServerIds.some(id => !runtime.mcpServers.some(server => server.serverId === id))) invalid('TEAM_VERSION_TOOL_UNAVAILABLE');
  const payload = {
    schemaVersion: TEAM_PUBLICATION_SCHEMA, assistantId: agent.id, promptVersion: agent.promptVersion,
    roleDefinition: agent.roleDefinition, agentDefinition: agent.agentDefinition,
    model: { modelProviderId: agent.modelProviderId, modelId: agent.modelId },
    skills: runtime.skills.map(skill => ({ canonicalId: skill.id, version: skill.version!, packageDigest: skill.contentHash })),
    tools: runtime.tools.map(tool => ({ toolId: tool.id, handlerVersion: tool.version, schemaDigest: teachingValueDigest(tool) })),
    mcpPermissions: runtime.mcpServers.map(server => ({ serverId: server.serverId, toolIds: [...server.toolIds] })),
  };
  return { ...payload, digest: teachingValueDigest(payload) };
}

export function readPublishedAssistant(value: unknown, assistantId: string): PublishedAssistantSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('TEAM_VERSION_SNAPSHOT_INVALID');
  const { digest, ...payload } = value as Record<string, unknown>;
  if (payload.schemaVersion !== TEAM_PUBLICATION_SCHEMA || payload.assistantId !== assistantId ||
    typeof digest !== 'string' || teachingValueDigest(payload) !== digest ||
    !Array.isArray(payload.skills) || !Array.isArray(payload.tools) || !Array.isArray(payload.mcpPermissions) ||
    typeof payload.roleDefinition !== 'string' || typeof payload.agentDefinition !== 'string' ||
    !payload.model || typeof payload.model !== 'object') return invalid('TEAM_VERSION_SNAPSHOT_INVALID');
  const model = payload.model as Record<string, unknown>;
  if (typeof model.modelProviderId !== 'string' || typeof model.modelId !== 'string') return invalid('TEAM_VERSION_SNAPSHOT_INVALID');
  return value as PublishedAssistantSnapshot;
}

/** Current grants can narrow a published snapshot; current prompts/models cannot replace it. */
export function publishedRuntimeSource(snapshot: PublishedAssistantSnapshot, live: EffectiveAgentRuntime) {
  const denied = (): never => { throw new ConflictException({ code: 'TEAM_VERSION_GRANT_REVOKED', message: '已发布团队引用的成员能力已撤销或变更，请重新审核团队版本。' }); };
  if (!live.agent.enabled || !live.agent.capabilities.includes('teach')) denied();
  for (const pin of snapshot.skills) {
    if (!live.skills.some(skill => skill.id === pin.canonicalId && skill.version === pin.version &&
      skill.contentHash === pin.packageDigest && skill.status === 'ready' && skill.runtime === 'teaching' && skill.publicationStatus === 'published')) denied();
  }
  for (const tool of snapshot.tools) {
    if (!live.tools.some(current => current.id === tool.toolId && current.version === tool.handlerVersion && teachingValueDigest(current) === tool.schemaDigest)) denied();
  }
  for (const permission of snapshot.mcpPermissions) {
    const current = live.mcpServers.find(server => server.serverId === permission.serverId);
    if (!current || permission.toolIds.some(id => !current.toolIds.includes(id))) denied();
  }
  return { enabled: true, roleDefinition: snapshot.roleDefinition, agentDefinition: snapshot.agentDefinition,
    skillIds: snapshot.skills.map(skill => skill.canonicalId),
    toolIds: [...snapshot.tools.map(tool => tool.toolId), ...snapshot.mcpPermissions.flatMap(server => server.toolIds)],
    mcpServerIds: snapshot.mcpPermissions.map(server => server.serverId) };
}
