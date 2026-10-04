import { createApiClient } from '@qitu/api-client';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

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
