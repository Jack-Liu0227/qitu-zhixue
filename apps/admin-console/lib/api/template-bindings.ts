import type { AdminProjectBindingRecovery, AdminProjectBindingReconfirmation, PblPhase, PblTemplateTeamBinding, TeachingBundleDraft, PrepareTeachingArrangementInput } from '@qitu/contracts';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

export interface TemplateTeamBinding {
  binding: PblTemplateTeamBinding;
  configurationReady?: boolean;
  teachingReadiness?: { lessonCompletionReady: boolean; lessonSkillsDeclared: boolean; knowledgeRequired: boolean; knowledgeScopeDeclared: boolean };
  team: { id: string; name: string; runtimeSnapshotStatus?: string } | null;
}
export interface PublishedTeamMember {
  slotId: string;
  assistantId: string;
  role?: string;
  roleLabel?: string;
  pblPhase?: PblPhase;
  runtimeSnapshot?: {
    model: NonNullable<TeachingBundleDraft['modelByPurpose'][string]['dialogue']>;
    skills: readonly Omit<TeachingBundleDraft['skillPins'][number], 'roleSlotId'>[];
    tools: readonly { toolId: string; handlerVersion: string; schemaDigest: string }[];
    mcpPermissions: readonly { serverId: string; toolIds: readonly string[] }[];
    promptVersion?: string;
    digest?: string;
  };
}
export interface PublishedTeamVersion {
  id: string; teamId: string; version: number; name: string;
  runtimeSnapshotStatus: 'published' | 'legacy_unpinned';
  leaderAssistantId?: string;
  snapshotDigest?: string | null;
  sourceUpdatedAt?: string | null;
  createdAt?: string;
  members?: readonly PublishedTeamMember[];
}
const path = (templateId: string, versionId: string) => `/api/v1/admin/project-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/bindings`;
export function prepareCurrentTeachingArrangement(templateId: string, versionId: string, input: PrepareTeachingArrangementInput, key: string) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding; replayed: boolean }>({ path: `${path(templateId, versionId)}/prepare-current`, method: 'POST', body: input, idempotencyKey: key });
}
export function fetchTemplateBindings(templateId: string, versionId: string) {
  return adminEnvelopeRequest<TemplateTeamBinding[]>({ path: path(templateId, versionId), method: 'GET' });
}
export function fetchBindingTeamSnapshots(templateId: string, versionId: string, bindingId: string) {
  return adminEnvelopeRequest<{ versions: PublishedTeamVersion[]; issues: { teamVersionId: string; code: string }[] }>({
    path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/team-snapshots`, method: 'GET',
  });
}
export function saveTemplateBundle(templateId: string, versionId: string, bindingId: string, draft: unknown, key = newIdempotencyKey()) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/teaching-bundle`, method: 'PATCH', body: draft, idempotencyKey: key });
}
export function prepareTemplateBundle(templateId: string, versionId: string, bindingId: string, scheduleProfileId: string, key = newIdempotencyKey(), phaseAssignments?: Readonly<Record<string, string>>,
  sessionAssignments?: TeachingBundleDraft['sessionAssignments']) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/prepare`, method: 'POST', body: { scheduleProfileId, phaseAssignments, sessionAssignments }, idempotencyKey: key });
}
export function transitionTemplateBinding(templateId: string, versionId: string, bindingId: string, action: 'validate' | 'activate', key = newIdempotencyKey()) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/${action}`, method: 'POST', idempotencyKey: key });
}
export function fetchProjectBindingRecovery(templateId: string, versionId: string) {
  return adminEnvelopeRequest<AdminProjectBindingRecovery[]>({ path: `${path(templateId, versionId)}/project-recovery`, method: 'GET' });
}
export function reconfirmProjectBinding(templateId: string, versionId: string, bindingId: string, projectId: string, reason: string, key: string) {
  return adminEnvelopeRequest<AdminProjectBindingReconfirmation>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/projects/${encodeURIComponent(projectId)}/reconfirm`,
    method: 'POST', body: { reason }, idempotencyKey: key });
}
