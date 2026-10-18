import { createApiClient } from '@qitu/api-client';
import type {
  AdminSettingsIndexData,
  AdminSettingsRegistry,
  AdminSettingsRegistryItem,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, adminEnvelopeRequest, type DataEnvelope } from './types';

export async function fetchSettings(): Promise<AdminSettingsIndexData> {
  const client = createApiClient('');

  try {
    const response = await client.get<DataEnvelope<AdminSettingsIndexData>>('/api/v1/admin/settings');
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

export async function fetchSettingsRegistry(): Promise<AdminSettingsRegistry> {
  return adminEnvelopeRequest<AdminSettingsRegistry>({ path: '/api/v1/admin/settings/registry', method: 'GET' });
}

export interface AdminSettingsBadgeState {
  phase: 'ready' | 'error';
  value?: string;
}

/**
 * 每个设置域独立 settle。一个域离线、被拒绝或返回异常时，其它域仍保留结果。
 */
export async function loadSettingsBadgeStates<T extends Pick<AdminSettingsRegistryItem, 'id'>>(
  items: readonly T[],
  load: (item: T) => Promise<string>,
): Promise<Record<string, AdminSettingsBadgeState>> {
  const settled = await Promise.all(items.map(async (item) => {
    try {
      return [item.id, { phase: 'ready' as const, value: await load(item) }] as const;
    } catch {
      return [item.id, { phase: 'error' as const, value: '读取失败' }] as const;
    }
  }));
  return Object.fromEntries(settled);
}
