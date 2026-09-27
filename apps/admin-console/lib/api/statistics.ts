import { createApiClient } from '@qitu/api-client';
import type {
  AdminStudentStatsPageData,
  AdminStudentStatsRange,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

export async function fetchStudentStatistics(
  range: AdminStudentStatsRange = '7d',
): Promise<AdminStudentStatsPageData> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<AdminStudentStatsPageData>>(
      `/api/v1/admin/students/statistics?range=${range}`,
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
