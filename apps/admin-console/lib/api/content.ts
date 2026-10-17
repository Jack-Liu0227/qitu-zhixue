import { createApiClient } from '@qitu/api-client';
import {
  adminEnvelopeRequest,
  AdminOfflineError,
  AdminPermissionError,
  newIdempotencyKey,
  type DataEnvelope,
} from './types';

export interface AdminKnowledgeDocument {
  id: string;
  scope: string;
  schoolId: string | null;
  ownerUserId: string | null;
  projectId: string | null;
  title: string;
  summary: string;
  tags: string[];
  version: string;
  status: string;
  source: string;
  sourceRef: string | null;
  checksum: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  contentLength: number;
}

export interface AdminProjectTemplate {
  id: string;
  schoolId: string | null;
  scope: string;
  slug: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  learningObjectives: string[];
  status: string;
  verifiedAt: string | null;
  latestPublishedVersionId: string | null;
  updatedAt: string;
}

export interface AdminTemplateStage {
  id: string;
  label: string;
}

/**
 * 治理端版本详情（GET /admin/project-templates/:id/versions）。
 *
 * `content` 是随版本冻结的正文 JSON：阶段设计编辑器把
 * `{ phases, linkedTeamId }` 写进去、读出来，形成读写闭环。
 */
export interface AdminTemplateVersionDetail {
  id: string;
  templateId: string;
  version: string;
  stages: AdminTemplateStage[];
  content: Record<string, unknown>;
  rubric: unknown[];
  status: string;
  publishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface AdminTemplateMutation {
  template: AdminProjectTemplate;
  replayed: boolean;
}

export interface AdminTemplateVersionMutation {
  template: AdminProjectTemplate;
  version: {
    id: string;
    templateId: string;
    version: string;
    stages: AdminTemplateStage[];
    status: string;
    publishedAt: string | null;
    createdAt: string;
  };
  replayed: boolean;
}

const client = createApiClient('');

async function get<T>(path: string): Promise<T> {
  try {
    const response = await client.get<DataEnvelope<T>>(path);
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      const status = (error as { status?: number }).status;
      if (error.name === 'TypeError' || status === 0) throw new AdminOfflineError();
      if (status === 401 || status === 403) throw new AdminPermissionError();
    }
    throw error;
  }
}

export function fetchAdminKnowledge(): Promise<AdminKnowledgeDocument[]> {
  return get('/api/v1/admin/knowledge/documents');
}

export function fetchAdminTemplates(): Promise<AdminProjectTemplate[]> {
  return get('/api/v1/admin/project-templates');
}

export function fetchAdminTemplateVersions(id: string): Promise<AdminTemplateVersionDetail[]> {
  return get(`/api/v1/admin/project-templates/${encodeURIComponent(id)}/versions`);
}

export function createAdminTemplate(input: Record<string, unknown>): Promise<AdminTemplateMutation> {
  return adminEnvelopeRequest<AdminTemplateMutation>({
    path: '/api/v1/admin/project-templates',
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  });
}

export function updateAdminTemplate(
  id: string,
  input: Record<string, unknown>,
): Promise<AdminTemplateMutation> {
  return adminEnvelopeRequest<AdminTemplateMutation>({
    path: `/api/v1/admin/project-templates/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  });
}

export function createAdminTemplateVersion(
  id: string,
  input: { stages: AdminTemplateStage[]; content: Record<string, unknown>; rubric?: unknown[] },
): Promise<AdminTemplateVersionMutation> {
  return adminEnvelopeRequest<AdminTemplateVersionMutation>({
    path: `/api/v1/admin/project-templates/${encodeURIComponent(id)}/versions`,
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  });
}

export function archiveAdminTemplate(id: string): Promise<AdminTemplateMutation> {
  return adminEnvelopeRequest<AdminTemplateMutation>({
    path: `/api/v1/admin/project-templates/${encodeURIComponent(id)}/archive`,
    method: 'POST',
    body: { reason: 'Archived from admin template editor' },
    idempotencyKey: newIdempotencyKey(),
  });
}
