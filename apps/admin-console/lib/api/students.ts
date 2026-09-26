import { createApiClient } from '@qitu/api-client';
import type {
  AdminStudentDetail,
  AdminStudentFilter,
  AdminStudentListPageData,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

export interface StudentListQuery {
  filter?: AdminStudentFilter;
  classLabel?: string | null;
  mentorId?: string | null;
  search?: string | null;
  cursor?: string | null;
  limit?: number;
}

export async function fetchStudentList(query: StudentListQuery = {}): Promise<AdminStudentListPageData> {
  const client = createApiClient('');
  const params = new URLSearchParams();

  if (query.filter && query.filter !== 'all') {
    params.set('filter', query.filter);
  }
  if (query.classLabel) {
    params.set('classLabel', query.classLabel);
  }
  if (query.mentorId) {
    params.set('mentorId', query.mentorId);
  }
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
  const path = queryString ? `/api/v1/admin/students?${queryString}` : '/api/v1/admin/students';

  try {
    const response = await client.get<DataEnvelope<AdminStudentListPageData>>(path);
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

export async function fetchStudentDetail(studentId: string): Promise<AdminStudentDetail> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<AdminStudentDetail>>(
      `/api/v1/admin/students/${encodeURIComponent(studentId)}`,
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
