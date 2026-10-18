import type { AdminTeamMember, PblPhase, PblTeamWorkflowSpec } from '@qitu/contracts';

type AssistantIdentity = { id: string; name: string; avatar?: string | null };
const phases: readonly PblPhase[] = ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'];
const roles: readonly AdminTeamMember['role'][] = ['leader', 'teammate', 'reviewer', 'coach'];
const statuses: readonly AdminTeamMember['status'][] = ['pending', 'idle', 'active', 'completed', 'failed', 'dormant'];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

/** Expand historical version rows without replacing their frozen membership with the live team. */
export function resolveFrozenTeamMembers(input: {
  versionId: string;
  members: unknown;
  leaderAssistantId: string;
  pblSpec?: PblTeamWorkflowSpec;
  assistants: readonly AssistantIdentity[];
}): readonly AdminTeamMember[] {
  if (!Array.isArray(input.members)) return [];
  return input.members.flatMap((value: unknown, index): AdminTeamMember[] => {
    if (!value || typeof value !== 'object') return [];
    const member = value as Record<string, unknown>;
    const assistantId = text(member.assistantId);
    if (!assistantId) return [];
    const assistant = input.assistants.find((candidate) => candidate.id === assistantId);
    const phaseSpec = input.pblSpec?.phases?.find((phase) => phase.assignedAssistantId === assistantId);
    const phaseValue = member.pblPhase ?? member.phaseScope ?? phaseSpec?.phase;
    const pblPhase = phases.includes(phaseValue as PblPhase) ? phaseValue as PblPhase : undefined;
    const role = roles.includes(member.role as AdminTeamMember['role'])
      ? member.role as AdminTeamMember['role']
      : assistantId === input.leaderAssistantId ? 'leader'
      : pblPhase === 'deliverable_review' ? 'reviewer' : 'coach';
    return [{
      slotId: text(member.slotId) ?? input.versionId + ':' + assistantId + ':' + index,
      assistantId,
      assistantName: text(member.assistantName) ?? assistant?.name ?? assistantId,
      role,
      roleLabel: text(member.roleLabel) ?? phaseSpec?.assignedRoleLabel ?? role,
      status: statuses.includes(member.status as AdminTeamMember['status']) ? member.status as AdminTeamMember['status'] : 'pending',
      ...(text(member.avatar) ?? assistant?.avatar ? { avatar: text(member.avatar) ?? assistant?.avatar ?? undefined } : {}),
      ...(text(member.model) ? { model: text(member.model) } : {}),
      ...(text(member.color) ? { color: text(member.color) } : {}),
      ...(pblPhase ? { pblPhase } : {}),
    }];
  });
}
