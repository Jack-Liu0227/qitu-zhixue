import type { PblTemplateTeamBinding } from '@qitu/contracts';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

export interface TemplateTeamBinding { binding: PblTemplateTeamBinding; team: { id: string; name: string } | null }
export interface PublishedTeamVersion { id: string; teamId: string; version: number; name: string; runtimeSnapshotStatus: 'published' | 'legacy_unpinned' }
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
export function transitionTemplateBinding(templateId: string, versionId: string, bindingId: string, action: 'validate' | 'activate', key = newIdempotencyKey()) {
  return adminEnvelopeRequest<{ binding: PblTemplateTeamBinding }>({ path: `${path(templateId, versionId)}/${encodeURIComponent(bindingId)}/${action}`, method: 'POST', idempotencyKey: key });
}
