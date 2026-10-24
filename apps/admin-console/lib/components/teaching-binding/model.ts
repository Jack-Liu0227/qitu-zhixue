import type { AdminTeamConfig, ProjectTemplateSpec, TeachingBundleDraft, TeachingSessionAssignment, TeachingSessionSelection } from '@qitu/contracts';
import type { PublishedTeamMember, PublishedTeamVersion } from '../../api/template-bindings';

export type DraftPreview = { kind: 'empty' } | { kind: 'invalid'; message: string }
  | { kind: 'ready'; draft: TeachingBundleDraft };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
const fields = (value: unknown, names: readonly string[]) => record(value) && names.every((name) => typeof value[name] === 'string');

function isDraft(value: unknown): value is TeachingBundleDraft {
  if (!record(value) || !fields(value, ['templateVersionId', 'teamVersionId', 'scheduleProfileId', 'approvalPolicyVersion'])) return false;
  if (!Array.isArray(value.roleMap) || !value.roleMap.every((item: unknown) => record(item)
    && fields(item, ['roleSlotId', 'memberId']) && strings(item.purposes)
    && item.purposes.every((purpose) => ['outline', 'session', 'dialogue'].includes(purpose)))) return false;
  if (!Array.isArray(value.skillPins) || !value.skillPins.every((item: unknown) => fields(item, ['roleSlotId', 'canonicalId', 'version', 'packageDigest']))) return false;
  if (!Array.isArray(value.toolIds) || !value.toolIds.every((item: unknown) => fields(item, ['roleSlotId', 'toolId']))) return false;
  if (!strings(value.mcpServerIds) || !strings(value.knowledgeBaseIds) || !record(value.modelByPurpose)) return false;
  if (!Object.values(value.modelByPurpose).every((models) => record(models) && Object.entries(models).every(([purpose, model]) =>
    ['outline', 'session', 'dialogue'].includes(purpose) && fields(model, ['modelProviderId', 'modelId'])))) return false;
  if (value.sessionAssignments !== undefined && (!Array.isArray(value.sessionAssignments) || value.sessionAssignments.length < 1
    || value.sessionAssignments.length > 128 || !value.sessionAssignments.every((entry: unknown) => record(entry)
      && typeof entry.sessionIndex === 'number' && Number.isSafeInteger(entry.sessionIndex) && entry.sessionIndex > 0
      && typeof entry.teamVersionId === 'string' && entry.teamVersionId.length > 0
      && (entry.kind === 'team' && entry.memberId === undefined || entry.kind === 'assistant' && typeof entry.memberId === 'string' && entry.memberId.length > 0))
    || new Set(value.sessionAssignments.map(entry => entry.sessionIndex)).size !== value.sessionAssignments.length)) return false;
  return value.sessionRoutes === undefined || Array.isArray(value.sessionRoutes) && value.sessionRoutes.every((route: unknown) =>
    record(route) && typeof route.sessionIndex === 'number' && Number.isInteger(route.sessionIndex)
    && route.sessionIndex >= 1 && typeof route.roleSlotId === 'string');
}

export function parseDraftPreview(text: string): DraftPreview {
  if (!text.trim()) return { kind: 'empty' };
  try {
    const value: unknown = JSON.parse(text);
    return isDraft(value) ? { kind: 'ready', draft: value }
      : { kind: 'invalid', message: '配置字段不完整，请在高级配置中检查。原文已保留。' };
  } catch {
    return { kind: 'invalid', message: 'JSON 格式有误，请在高级配置中修正。原文已保留。' };
  }
}

export function initialSessionAssignments(profile: NonNullable<ProjectTemplateSpec['curriculum']>['profiles'][number] | undefined,
  phases: ProjectTemplateSpec['phases'], members: readonly PublishedTeamMember[], teamVersionId: string,
  draft: TeachingBundleDraft | null): readonly TeachingSessionAssignment[] {
  if (draft?.sessionAssignments) return draft.sessionAssignments;
  if (!profile || !teamVersionId) return [];
  return profile.sessions.flatMap(session => {
    const route = draft?.sessionRoutes?.find(entry => entry.sessionIndex === session.sessionIndex);
    const role = draft?.roleMap.find(entry => entry.roleSlotId === route?.roleSlotId);
    const explicitId = session.leadAssistantId ?? phases.find(phase => phase.phase === session.phase)?.assignedAssistantId;
    const member = role ? members.find(entry => entry.slotId === role.memberId) : members.find(entry => entry.assistantId === explicitId);
    return member && member.assistantId !== 'qitu-intake-assistant'
      ? [{ sessionIndex: session.sessionIndex, teamVersionId, kind: 'assistant' as const, memberId: member.slotId }] : [];
  });
}

export function publishedMemberName(member: PublishedTeamMember, team?: AdminTeamConfig): string {
  return team?.members.find((item) => item.assistantId === member.assistantId)?.assistantName || member.assistantId;
}

export function sessionSelectionsFromSnapshots(assignments: readonly TeachingSessionAssignment[], versions: readonly PublishedTeamVersion[]): readonly TeachingSessionSelection[] {
  return assignments.flatMap((assignment): TeachingSessionSelection[] => {
    const version = versions.find(item => item.id === assignment.teamVersionId);
    if (!version) return [];
    if (assignment.kind === 'team') return [{ sessionIndex: assignment.sessionIndex, teamId: version.teamId, kind: 'team' }];
    const member = version.members?.find(item => item.slotId === assignment.memberId);
    return member ? [{ sessionIndex: assignment.sessionIndex, teamId: version.teamId, kind: 'assistant', assistantId: member.assistantId }] : [];
  });
}

export function routeSession(draft: TeachingBundleDraft, sessionIndex: number, roleSlotId: string): TeachingBundleDraft {
  if (!Number.isInteger(sessionIndex) || sessionIndex < 1 || !draft.roleMap.some((role) => role.roleSlotId === roleSlotId && role.purposes.includes('dialogue'))) return draft;
  const routes = draft.sessionRoutes ?? [];
  return { ...draft, sessionRoutes: [...routes.filter((route) => route.sessionIndex !== sessionIndex),
    { sessionIndex, roleSlotId }].sort((a, b) => a.sessionIndex - b.sessionIndex) };
}

export function routeSessionToMember(draft: TeachingBundleDraft, sessionIndex: number, member: PublishedTeamMember): TeachingBundleDraft {
  const snapshot = member.runtimeSnapshot;
  if (!snapshot || !Number.isInteger(sessionIndex) || sessionIndex < 1) return draft;
  const existing = draft.roleMap.find((role) => role.memberId === member.slotId && role.purposes.includes('dialogue'));
  if (existing) return routeSession(draft, sessionIndex, existing.roleSlotId);
  // A new role copies only the selected member's exact published pins.
  if (draft.roleMap.some((role) => role.roleSlotId === member.slotId)) return draft;
  const role: TeachingBundleDraft['roleMap'][number] = {
    roleSlotId: member.slotId, memberId: member.slotId, purposes: ['outline', 'session', 'dialogue'],
  };
  return routeSession({ ...draft, roleMap: [...draft.roleMap, role],
    skillPins: [...draft.skillPins, ...snapshot.skills.map((pin) => ({ roleSlotId: role.roleSlotId, ...pin }))],
    toolIds: [...draft.toolIds, ...snapshot.tools.map((tool) => ({ roleSlotId: role.roleSlotId, toolId: tool.toolId }))],
    modelByPurpose: { ...draft.modelByPurpose, [role.roleSlotId]: {
      outline: snapshot.model, session: snapshot.model, dialogue: snapshot.model,
    } },
  }, sessionIndex, role.roleSlotId);
}

export function togglePublishedSkill(draft: TeachingBundleDraft, roleSlotId: string, member: PublishedTeamMember,
  canonicalId: string, enabled: boolean): TeachingBundleDraft {
  if (!draft.roleMap.some((role) => role.roleSlotId === roleSlotId && role.memberId === member.slotId)) return draft;
  const pin = member.runtimeSnapshot?.skills.find((skill) => skill.canonicalId === canonicalId);
  if (!pin) return draft;
  const retained = draft.skillPins.filter((skill) => skill.roleSlotId !== roleSlotId || skill.canonicalId !== canonicalId);
  return { ...draft, skillPins: enabled ? [...retained, { roleSlotId, ...pin }] : retained };
}

export function togglePublishedTool(draft: TeachingBundleDraft, roleSlotId: string, member: PublishedTeamMember,
  toolId: string, enabled: boolean): TeachingBundleDraft {
  const snapshot = member.runtimeSnapshot;
  if (!snapshot || !draft.roleMap.some((role) => role.roleSlotId === roleSlotId && role.memberId === member.slotId)) return draft;
  const server = snapshot.mcpPermissions.find((permission) => permission.toolIds.includes(toolId));
  if (!server && !snapshot.tools.some((tool) => tool.toolId === toolId)) return draft;
  const retained = draft.toolIds.filter((tool) => tool.roleSlotId !== roleSlotId || tool.toolId !== toolId);
  return { ...draft, toolIds: enabled ? [...retained, { roleSlotId, toolId }] : retained,
    mcpServerIds: enabled && server ? [...new Set([...draft.mcpServerIds, server.serverId])] : draft.mcpServerIds };
}
