import { parseProjectTemplateSpec } from '@qitu/contracts';
import { canonicalTeachingJson, teachingValueDigest } from './teaching-bundle.canonical';
import {
  TEACHING_BUNDLE_COMPILER_VERSION,
  TEACHING_BUNDLE_SCHEMA_VERSION,
  TEACHING_PURPOSES,
  TeachingBundleCompilationError,
  type CompiledTeachingBundle,
  type CompiledTeachingRole,
  type TeachingBundlePayload,
  type TeachingBundleSource,
  type TeachingKnowledgeGrant,
  type TeachingModelSelection,
  type TeachingPurpose,
  type TeachingRoleSource,
  type TeachingSkillPin,
} from './teaching-bundle.types';

const IMA_TOOLS = new Set([
  'ima_list_knowledge_bases', 'ima_search_knowledge', 'ima_list_documents', 'ima_read_document',
]);
const FORBIDDEN_TOOLS = new Set(['advance_stage', 'mark_mastered', 'approve_artifact', 'write_database']);
const DIGEST = /^[a-f0-9]{64}$/;
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function reject(issue: string, path: string): never {
  throw new TeachingBundleCompilationError(issue, path);
}

function requireId(value: string, path: string): void {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 256) {
    reject('IDENTIFIER_INVALID', path);
  }
}

function requireDigest(value: string, path: string): void {
  if (!DIGEST.test(value)) reject('ARTIFACT_DIGEST_INVALID', path);
}

function uniqueIds(values: readonly string[], path: string): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    requireId(value, path);
    if (result.has(value)) reject('DUPLICATE_REFERENCE', path);
    result.add(value);
  }
  return result;
}

function skillKey(pin: TeachingSkillPin): string {
  requireId(pin.canonicalId, 'skill.canonicalId');
  requireId(pin.version, 'skill.version');
  if (!SKILL_ID.test(pin.canonicalId)) reject('SKILL_CANONICAL_ID_INVALID', 'skill.canonicalId');
  requireDigest(pin.packageDigest, 'skill.packageDigest');
  return `${pin.canonicalId}@${pin.version}`;
}

function indexBy<T>(items: readonly T[], key: (item: T) => string, path: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    requireId(id, path);
    if (result.has(id)) reject('DUPLICATE_REFERENCE', path);
    result.set(id, item);
  }
  return result;
}

function compileRole(source: TeachingBundleSource, role: TeachingRoleSource): CompiledTeachingRole {
  const member = source.teamVersion.members.find((entry) => entry.memberId === role.memberId);
  if (member === undefined) reject('ROLE_MEMBER_UNRESOLVED', role.roleSlotId);
  const assistant = source.assistants.find((entry) => entry.assistantId === member.assistantId);
  if (assistant === undefined || !assistant.enabled) reject('ROLE_ASSISTANT_UNAVAILABLE', role.roleSlotId);
  if (typeof assistant.roleDefinition !== 'string' || typeof assistant.agentDefinition !== 'string') {
    reject('ASSISTANT_INSTRUCTIONS_INVALID', role.roleSlotId);
  }
  const assistantSkills = uniqueIds(assistant.skillIds, 'assistant.skillIds');
  const assistantTools = uniqueIds(assistant.toolIds, 'assistant.toolIds');
  const assistantServers = uniqueIds(assistant.mcpServerIds, 'assistant.mcpServerIds');
  const approvedTools = uniqueIds(source.approval.toolIds, 'approval.toolIds');
  const approvedServers = uniqueIds(source.approval.mcpServerIds, 'approval.mcpServerIds');
  const requestedTools = uniqueIds(role.toolIds, 'role.toolIds');
  const purposes = uniqueIds(role.purposes, 'role.purposes');
  if (purposes.size === 0) reject('ROLE_PURPOSE_REQUIRED', role.roleSlotId);
  const models: Partial<Record<TeachingPurpose, TeachingModelSelection>> = {};
  for (const purpose of purposes) {
    if (!TEACHING_PURPOSES.some((candidate) => candidate === purpose)) reject('ROLE_PURPOSE_INVALID', role.roleSlotId);
  }
  for (const purpose of TEACHING_PURPOSES) {
    if (!purposes.has(purpose)) continue;
    const model = assistant.modelByPurpose[purpose];
    if (model === undefined) reject('ROLE_MODEL_REQUIRED', `${role.roleSlotId}.${purpose}`);
    requireId(model.modelProviderId, 'model.modelProviderId');
    requireId(model.modelId, 'model.modelId');
    requireId(model.policyVersion, 'model.policyVersion');
    if (!source.approval.models.some((approved) =>
      approved.modelProviderId === model.modelProviderId && approved.modelId === model.modelId)) {
      reject('MODEL_PAIR_NOT_APPROVED', `${role.roleSlotId}.${purpose}`);
    }
    models[purpose] = {
      modelProviderId: model.modelProviderId, modelId: model.modelId, policyVersion: model.policyVersion,
    };
  }
  uniqueIds(role.skills.map((pin) => pin.canonicalId), 'role.skills');
  const skills = role.skills.map((pin): TeachingSkillPin => {
    const key = skillKey(pin);
    const artifact = source.skillArtifacts.find((entry) => skillKey(entry) === key);
    if (artifact === undefined || artifact.packageDigest !== pin.packageDigest) {
      reject('SKILL_ARTIFACT_UNRESOLVED', pin.canonicalId);
    }
    if (artifact.status !== 'published' || artifact.runtime !== 'teaching') {
      reject('SKILL_REVIEW_REQUIRED', pin.canonicalId);
    }
    if (!assistantSkills.has(pin.canonicalId)) reject('SKILL_ASSISTANT_GRANT_DENIED', pin.canonicalId);
    for (const toolId of uniqueIds(artifact.requiredToolIds, 'skill.requiredToolIds')) {
      if (!requestedTools.has(toolId)) reject('SKILL_TOOL_DEPENDENCY_MISSING', pin.canonicalId);
    }
    return { canonicalId: pin.canonicalId, version: pin.version, packageDigest: pin.packageDigest };
  });
  const tools = [...requestedTools].sort().map((toolId) => {
    if (FORBIDDEN_TOOLS.has(toolId)) reject('DOMAIN_FACT_WRITE_FORBIDDEN', toolId);
    if (!assistantTools.has(toolId) || !approvedTools.has(toolId)) reject('TOOL_GRANT_DENIED', toolId);
    const tool = source.tools.find((entry) => entry.toolId === toolId);
    if (tool === undefined) reject('TOOL_ARTIFACT_UNRESOLVED', toolId);
    requireDigest(tool.schemaDigest, 'tool.schemaDigest');
    requireId(tool.handlerVersion, 'tool.handlerVersion');
    if (tool.mcpServerId !== null &&
      (!assistantServers.has(tool.mcpServerId) || !approvedServers.has(tool.mcpServerId))) {
      reject('MCP_GRANT_DENIED', toolId);
    }
    if (IMA_TOOLS.has(toolId) && tool.mcpServerId !== 'ima-knowledge') reject('IMA_SERVER_INVALID', toolId);
    return {
      toolId, schemaDigest: tool.schemaDigest, handlerVersion: tool.handlerVersion, mcpServerId: tool.mcpServerId,
    };
  });
  const instructions = { roleDefinition: assistant.roleDefinition, agentDefinition: assistant.agentDefinition };
  return {
    roleSlotId: role.roleSlotId, memberId: member.memberId, assistantId: member.assistantId,
    assistantConfigDigest: teachingValueDigest({ instructions, modelByPurpose: models, skills, tools }),
    instructions, modelByPurpose: models, skills, tools,
  };
}

function compileKnowledgeGrant(
  source: TeachingBundleSource,
  roles: readonly CompiledTeachingRole[],
): TeachingKnowledgeGrant | null {
  const usedImaTools = roles.flatMap((role) => role.tools.filter((tool) => tool.mcpServerId === 'ima-knowledge'));
  const grant = source.knowledgeGrant;
  if (grant === null) {
    if (usedImaTools.length > 0) reject('KNOWLEDGE_SCOPE_REQUIRED', 'knowledgeGrant');
    return null;
  }
  if (grant.serverId !== 'ima-knowledge') reject('IMA_SERVER_INVALID', 'knowledgeGrant.serverId');
  if (!source.approval.mcpServerIds.includes(grant.serverId)) reject('MCP_GRANT_DENIED', 'knowledgeGrant');
  const approvedKbs = uniqueIds(source.approval.imaKnowledgeBaseIds, 'approval.imaKnowledgeBaseIds');
  const kbIds = uniqueIds(grant.knowledgeBaseIds, 'knowledgeGrant.knowledgeBaseIds');
  const tools = uniqueIds(grant.allowedTools, 'knowledgeGrant.allowedTools');
  if (kbIds.size === 0 || tools.size === 0) reject('KNOWLEDGE_SCOPE_REQUIRED', 'knowledgeGrant');
  for (const id of kbIds) {
    if (!approvedKbs.has(id)) reject('KNOWLEDGE_SCOPE_DENIED', 'knowledgeGrant.knowledgeBaseIds');
  }
  for (const toolId of tools) {
    if (!IMA_TOOLS.has(toolId) || !source.approval.toolIds.includes(toolId)) {
      reject('KNOWLEDGE_TOOL_DENIED', 'knowledgeGrant.allowedTools');
    }
  }
  for (const tool of usedImaTools) {
    if (!tools.has(tool.toolId)) reject('KNOWLEDGE_TOOL_DENIED', tool.toolId);
  }
  return { serverId: grant.serverId, knowledgeBaseIds: [...kbIds].sort(), allowedTools: [...tools].sort() };
}

function freezeTree(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeTree(child);
  }
  Object.freeze(value);
}

/** Pure compile core; does not activate a binding, authorize a call, or persist facts. */
export function compileTeachingBundle(source: TeachingBundleSource): CompiledTeachingBundle {
  canonicalTeachingJson(source);
  const template = parseProjectTemplateSpec(source.template);
  requireId(source.templateVersionId, 'templateVersionId');
  requireId(source.scheduleProfileId, 'scheduleProfileId');
  requireId(source.approval.version, 'approval.version');
  const profile = template.curriculum?.profiles.find((entry) => entry.id === source.scheduleProfileId);
  if (profile === undefined) reject('SCHEDULE_PROFILE_UNRESOLVED', 'scheduleProfileId');
  requireId(source.teamVersion.teamVersionId, 'teamVersion.teamVersionId');
  if (source.teamVersion.teamId !== template.teamId) reject('TEMPLATE_TEAM_MISMATCH', 'teamVersion.teamId');
  requireId(source.teamVersion.leaderAssistantId, 'teamVersion.leaderAssistantId');
  indexBy(source.teamVersion.members, (member) => member.memberId, 'teamVersion.members');
  indexBy(source.teamVersion.members, (member) => member.assistantId, 'teamVersion.members.assistantId');
  if (!source.teamVersion.members.some((member) => member.assistantId === source.teamVersion.leaderAssistantId)) {
    reject('TEAM_LEADER_NOT_MEMBER', 'teamVersion.leaderAssistantId');
  }
  indexBy(source.assistants, (assistant) => assistant.assistantId, 'assistants');
  indexBy(source.roles, (role) => role.roleSlotId, 'roles');
  indexBy(source.skillArtifacts, skillKey, 'skillArtifacts');
  indexBy(source.tools, (tool) => tool.toolId, 'tools');
  if (source.roles.length === 0) reject('ROLE_REQUIRED', 'roles');
  const roles = [...source.roles].sort((a, b) => a.roleSlotId < b.roleSlotId ? -1 : a.roleSlotId > b.roleSlotId ? 1 : 0)
    .map((role) => compileRole(source, role));
  const routeIndices = new Set<number>();
  const sessionRoutes = source.sessionRoutes.map((route) => {
    if (!Number.isSafeInteger(route.sessionIndex) ||
      !profile.sessions.some((session) => session.sessionIndex === route.sessionIndex)) {
      reject('SESSION_ROUTE_INVALID', 'sessionRoutes.sessionIndex');
    }
    if (routeIndices.has(route.sessionIndex)) reject('DUPLICATE_REFERENCE', 'sessionRoutes.sessionIndex');
    routeIndices.add(route.sessionIndex);
    const role = roles.find((entry) => entry.roleSlotId === route.roleSlotId);
    if (role === undefined || role.modelByPurpose.dialogue === undefined) {
      reject('SESSION_ROLE_UNRESOLVED', 'sessionRoutes.roleSlotId');
    }
    const session = profile.sessions.find((entry) => entry.sessionIndex === route.sessionIndex);
    if (session?.teachingRequirements?.includes('dynamic_lesson') && (!role.skills.some(skill => skill.canonicalId === 'pbl-dynamic-lesson')
      || !role.tools.some(tool => tool.toolId === 'tutor.propose_lesson_activity'))) {
      reject('LESSON_DYNAMIC_CAPABILITY_REQUIRED', `sessionRoutes.${route.sessionIndex}`);
    }
    if (session?.teachingRequirements?.includes('project_knowledge') && (!source.knowledgeGrant?.knowledgeBaseIds.length
      || !['ima_search_knowledge', 'ima_read_document'].every(id => source.knowledgeGrant?.allowedTools.includes(id)
        && role.tools.some(tool => tool.toolId === id && tool.mcpServerId === 'ima-knowledge')))) {
      reject('LESSON_KNOWLEDGE_CAPABILITY_REQUIRED', `sessionRoutes.${route.sessionIndex}`);
    }
    const phase = template.phases.find((entry) => entry.phase === session?.phase);
    if (phase?.assignedAssistantId !== null && phase?.assignedAssistantId !== role.assistantId) {
      reject('TEMPLATE_ROLE_MISMATCH', 'sessionRoutes.roleSlotId');
    }
    return { sessionIndex: route.sessionIndex, roleSlotId: route.roleSlotId };
  }).sort((a, b) => a.sessionIndex - b.sessionIndex);
  if (routeIndices.size !== profile.sessions.length) reject('SESSION_ROUTE_INCOMPLETE', 'sessionRoutes');
  const payload: TeachingBundlePayload = structuredClone({
    schemaVersion: TEACHING_BUNDLE_SCHEMA_VERSION,
    compilerVersion: TEACHING_BUNDLE_COMPILER_VERSION,
    templateVersionId: source.templateVersionId,
    template, templateDigest: teachingValueDigest(template), scheduleProfileId: source.scheduleProfileId,
    teamVersion: {
      teamVersionId: source.teamVersion.teamVersionId, teamId: source.teamVersion.teamId,
      leaderAssistantId: source.teamVersion.leaderAssistantId,
      members: source.teamVersion.members.map((member) => ({ memberId: member.memberId, assistantId: member.assistantId }))
        .sort((a, b) => a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0),
    },
    roles, sessionRoutes, knowledgeGrant: compileKnowledgeGrant(source, roles),
    approvalPolicyVersion: source.approval.version,
  });
  const canonicalPayload = canonicalTeachingJson(payload);
  const digest = teachingValueDigest(payload);
  freezeTree(payload);
  return Object.freeze({ payload, canonicalPayload, digest });
}
