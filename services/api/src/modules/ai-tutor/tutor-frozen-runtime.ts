import { ConflictException } from '@nestjs/common';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import type { CompiledTeachingRole } from '../templates/teaching-bundle.types';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import type { TutorTeachingContext } from './tutor-teaching-context';

export function scopeTutorRuntimeToLesson(runtime: EffectiveAgentRuntime, teaching?: TutorTeachingContext | null): EffectiveAgentRuntime {
  if (teaching?.bundle.template.lessonPolicy !== 'lesson-guided.v1') return runtime;
  const lesson = teaching.bundle.template.curriculum?.profiles.find(profile => profile.id === teaching.bundle.scheduleProfileId)
    ?.sessions.find(session => session.sessionIndex === teaching.session.lessonIndex);
  const required = lesson?.requiredSkillIds;
  if (!required?.length || required.some(id => !runtime.skills.some(skill => skill.id === id))) {
    throw new ConflictException({ code: 'LESSON_SKILL_UNAVAILABLE', message: '本课所需教学技能未获当前授权，请管理员检查课时配置。' });
  }
  const skills = runtime.skills.filter(skill => required.includes(skill.id));
  return { ...runtime, skills, agent: { ...runtime.agent, skillIds: skills.map(skill => skill.id) } };
}

/** The current catalogue may revoke capabilities; it cannot rewrite a historical lesson. */
export function freezeTutorRuntime(
  current: EffectiveAgentRuntime,
  role: CompiledTeachingRole,
  modelAvailable: boolean,
): EffectiveAgentRuntime {
  if (current.agent.id !== role.assistantId || !current.agent.enabled) {
    throw new ConflictException({ code: 'AGENT_ROLE_DISABLED', message: '本课时导师已停用，请联系教师或管理员。' });
  }
  const model = role.modelByPurpose.dialogue;
  if (!model || !modelAvailable) {
    throw new ConflictException({ code: 'PROJECT_TEACHING_MODEL_UNAVAILABLE', message: '本项目冻结的教学模型暂不可用，请联系管理员。' });
  }
  const skills = role.skills.flatMap((pin) => {
    // Removal is a revocation. A changed package is not a replacement for a pin.
    if (!current.agent.skillIds.includes(pin.canonicalId)) return [];
    const skill = current.skills.find((entry) => entry.id === pin.canonicalId);
    if (!skill || skill.status !== 'ready' || skill.publicationStatus === 'revoked'
      || (skill.runtime ?? 'teaching') !== 'teaching'
      || skill.version !== pin.version || skill.contentHash !== pin.packageDigest) {
      throw new ConflictException({ code: 'PROJECT_TEACHING_SKILL_UNAVAILABLE', message: '本项目固定版本的教学技能不可用，请联系管理员恢复或审核迁移。' });
    }
    return [skill];
  });
  const tools = current.tools.filter((tool) => role.tools.some((pin) =>
    pin.mcpServerId === null && pin.toolId === tool.id && pin.handlerVersion === tool.version
      && pin.schemaDigest === teachingValueDigest(tool)));
  const mcpServers = current.mcpServers.map((server) => ({
    ...server, toolIds: server.toolIds.filter((id) => role.tools.some((pin) =>
      pin.toolId === id && pin.mcpServerId === server.serverId)),
  })).filter((server) => server.toolIds.length > 0);
  return {
    ...current, skills, tools, mcpServers,
    agent: {
      ...current.agent, roleDefinition: role.instructions.roleDefinition, agentDefinition: role.instructions.agentDefinition,
      promptVersion: `teaching-bundle:${role.assistantConfigDigest}`, modelBinding: 'agent', modelUsage: 'agent.model',
      modelProviderId: model.modelProviderId, modelId: model.modelId, modelAvailable,
      skillIds: skills.map((skill) => skill.id), toolIds: tools.map((tool) => tool.id),
      mcpServerIds: mcpServers.map((server) => server.serverId),
      mcpToolIds: Object.fromEntries(mcpServers.map((server) => [server.serverId, server.toolIds])),
    },
  };
}
