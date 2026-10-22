import type { AdminProjectBindingRecovery, AdminProjectBindingReconfirmation, PblPhase, PblTemplateTeamBinding, TeachingBundleDraft } from '@qitu/contracts';
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
export function fetchTemplateBindings(templateId: string, versionId: string) {
  return adminEnvelopeRequest<TemplateTeamBinding[]>({ path: path(templateId, versionId), method: 'GET' });
}
export function fetchTeamVersions(teamId: string) {
  return adminEnvelopeRequest<PublishedTeamVersion[]>({ path: `/api/v1/admin/teams/${encodeURIComponent(teamId)}/versions`, method: 'GET' });
}
export function publishTeamVersion(teamId: string, expectedUpdatedAt: string, key = newIdempotencyKey()) {
  return adminEnvelopeRequest<PublishedTeamVersion>({ path: `/api/v1/admin/teams/${encodeURIComponent(teamId)}/versions`, method: 'POST', body: { expectedUpdatedAt }, idempotencyKey: key });
}
export function createTemplateBinding(templateId: string, versionId: string, teamVersionId: string, key = newIdempotencyKey()) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: path(templateId, versionId), method: 'POST', body: { teamVersionId }, idempotencyKey: key });
}
export function saveTemplateBundle(templateId: string, versionId: string, bindingId: string, draft: unknown, key = newIdempotencyKey()) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/teaching-bundle`, method: 'PATCH', body: draft, idempotencyKey: key });
}
export function prepareTemplateBundle(templateId: string, versionId: string, bindingId: string, scheduleProfileId: string, key = newIdempotencyKey(), phaseAssignments?: Readonly<Record<string, string>>) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/prepare`, method: 'POST', body: { scheduleProfileId, phaseAssignments }, idempotencyKey: key });
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
