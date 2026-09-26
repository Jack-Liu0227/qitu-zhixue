import { createApiClient } from '@qitu/api-client';
import type { AdminOverviewPageData } from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

export async function fetchOverview(): Promise<AdminOverviewPageData> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<AdminOverviewPageData>>('/api/v1/admin/overview');
    return response.data;
  } catch (error) {
    if (error instanceof Error) {
      // Check for TypeError (network failure) or status 0
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
