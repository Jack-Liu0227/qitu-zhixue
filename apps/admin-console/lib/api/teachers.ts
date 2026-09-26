import { createApiClient } from '@qitu/api-client';
import type {
  AdminTeacherDetail,
  AdminTeacherListPageData,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

export interface TeacherListQuery {
  search?: string | null;
  cursor?: string | null;
  limit?: number;
}

export async function fetchTeacherList(query: TeacherListQuery = {}): Promise<AdminTeacherListPageData> {
  const client = createApiClient('');
  const params = new URLSearchParams();

  if (query.search) {
    params.set('search', query.search);
  }
  if (query.cursor) {
    params.set('cursor', query.cursor);
  }
  if (query.limit) {
    params.set('limit', String(query.limit));
  }

  const queryString = params.toString();
  const path = queryString ? `/api/v1/admin/teachers?${queryString}` : '/api/v1/admin/teachers';

  try {
    const response = await client.get<DataEnvelope<AdminTeacherListPageData>>(path);
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}

export async function fetchTeacherDetail(teacherId: string): Promise<AdminTeacherDetail> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<AdminTeacherDetail>>(
      `/api/v1/admin/teachers/${encodeURIComponent(teacherId)}`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TypeError' || (error as { status?: number }).status === 0) {
        throw new AdminOfflineError();
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        throw new AdminPermissionError();
      }
    }
    throw error;
  }
}
