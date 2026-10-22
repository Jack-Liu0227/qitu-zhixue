import { BadRequestException } from '@nestjs/common';
import type { ProjectTemplateSpec, TeachingBundleDraft } from '@qitu/contracts';
import { readPublishedAssistant } from '../platform-registry/team-version.snapshot';
import type { TeamVersionRecord } from './templates-binding.types';

/** Uses only explicit template assignments and published member identities. */
export function draftFromPublishedTeam(
  versionId: string, template: ProjectTemplateSpec, team: TeamVersionRecord,
  approvalPolicyVersion: string, scheduleProfileId?: string, phaseAssignments: Readonly<Record<string, string>> = {},
): TeachingBundleDraft {
  const reject = (message: string): never => {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_MAPPING_REQUIRED', message });
  };
  if (!team.pblSpec.teamVersionPublication) reject('请先生成并选择已发布的团队版本。');
  const profiles = template.curriculum?.profiles ?? [];
  const profile = scheduleProfileId ? profiles.find((entry) => entry.id === scheduleProfileId)
    : profiles.length === 1 ? profiles[0] : undefined;
  if (!profile) return reject('请选择该模板中的明确课时排期。');
  if (Object.keys(phaseAssignments).some((phase) => !template.phases.some((entry) => entry.phase === phase))) reject('阶段角色配置不属于该模板。');
  const members = team.members.map((raw) => {
    if (!raw || typeof raw !== 'object' || !('slotId' in raw) || typeof raw.slotId !== 'string'
      || !('assistantId' in raw) || typeof raw.assistantId !== 'string' || !('runtimeSnapshot' in raw)) {
      return reject('团队版本缺少稳定成员标识或已发布的助手快照。');
    }
    return { slotId: raw.slotId, assistantId: raw.assistantId, snapshot: readPublishedAssistant(raw.runtimeSnapshot, raw.assistantId) };
  });
  if (new Set(members.map((member) => member.slotId)).size !== members.length
    || new Set(members.map((member) => member.assistantId)).size !== members.length) reject('团队成员标识重复，请重新发布团队。');
  const sessionRoutes = profile.sessions.map((session) => {
    const assigned = template.lessonPolicy === 'lesson-guided.v1' ? session.leadAssistantId
      : template.phases.find((phase) => phase.phase === session.phase)?.assignedAssistantId;
    const selectedMemberId = template.lessonPolicy === 'lesson-guided.v1' ? undefined : phaseAssignments[session.phase];
    const member = assigned ? members.find((candidate) => candidate.assistantId === assigned
      && (!selectedMemberId || candidate.slotId === selectedMemberId)) : members.find((candidate) => candidate.slotId === selectedMemberId);
    if (!member) return reject(`第 ${session.sessionIndex} 课没有明确匹配的团队成员，请先配置课程阶段的指定助手。`);
    return { sessionIndex: session.sessionIndex, roleSlotId: member.slotId };
  });
  const used = members.filter((member) => member.assistantId === team.leaderAssistantId
    || sessionRoutes.some((route) => route.roleSlotId === member.slotId));
  if (!used.some((member) => member.assistantId === team.leaderAssistantId)) reject('团队负责人不在已发布成员中。');
  const purposes = ['outline', 'session', 'dialogue'] as const;
  return {
    templateVersionId: versionId, teamVersionId: team.id, scheduleProfileId: profile.id,
    approvalPolicyVersion, sessionRoutes,
    roleMap: used.map((member) => ({ roleSlotId: member.slotId, memberId: member.slotId, purposes })),
    skillPins: used.flatMap((member) => member.snapshot.skills.map((pin) => ({ roleSlotId: member.slotId, ...pin }))),
    toolIds: used.flatMap((member) => member.snapshot.tools.map((tool) => ({ roleSlotId: member.slotId, toolId: tool.toolId }))),
    modelByPurpose: Object.fromEntries(used.map((member) => [member.slotId,
      Object.fromEntries(purposes.map((purpose) => [purpose, member.snapshot.model]))])),
    mcpServerIds: [], knowledgeBaseIds: [],
  };
}
