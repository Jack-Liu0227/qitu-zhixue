import { createApiClient } from '@qitu/api-client';
import type { AdminSettingsIndexData, ModelConfigPublic, ModelSlot, UpdateModelConfigRequest } from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

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

/** 只通过管理员端提交模型插槽配置；响应永不包含 API Key。 */
export async function updateModelConfig(
  slot: ModelSlot,
  body: UpdateModelConfigRequest,
): Promise<ModelConfigPublic> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/models/${encodeURIComponent(slot)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `模型配置失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as DataEnvelope<ModelConfigPublic>;
  return payload.data;
}
