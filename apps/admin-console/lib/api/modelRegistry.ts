import { ApiError, createApiClient } from '@qitu/api-client';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ModelUsageBinding,
  ProviderConfigPublic,
  RefreshProviderResponse,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

/**
 * 模型接入（供应商 / 用途绑定）API 层。
 *
 * 写接口全部只对 `admin` 开放；明文密钥只在写请求里出现一次（见
 * `packages/contracts/src/models.ts` 与 `settings.ts` 的安全约定），这里同样
 * 不打日志、不进 URL。
 */

const client = createApiClient('');

async function get<T>(path: string): Promise<T> {
  try {
    const response = await client.get<DataEnvelope<T>>(path);
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

async function mutate<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminOfflineError();
  }

  if (response.status === 0) throw new AdminOfflineError();
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | { message?: string }
      | null;
    const message =
      (payload && 'error' in payload && payload.error?.message) ||
      (payload && 'message' in payload && payload.message) ||
      `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status);
  }

  const payload = (await response.json()) as DataEnvelope<T>;
  return payload.data;
}

export function fetchProviders(): Promise<AdminProvidersResponse> {
  return get<AdminProvidersResponse>('/api/v1/admin/model-providers');
}

export function fetchUsages(): Promise<AdminModelUsagesResponse> {
  return get<AdminModelUsagesResponse>('/api/v1/admin/model-usages');
}

export function upsertProvider(id: string, body: UpsertProviderRequest): Promise<ProviderConfigPublic> {
  return mutate<ProviderConfigPublic>(
    'POST',
    `/api/v1/admin/model-providers/${encodeURIComponent(id)}`,
    body,
  );
}

export function deleteProvider(id: string): Promise<{ id: string }> {
  return mutate<{ id: string }>('DELETE', `/api/v1/admin/model-providers/${encodeURIComponent(id)}`);
}

export function refreshProvider(id: string): Promise<RefreshProviderResponse> {
  return mutate<RefreshProviderResponse>(
    'POST',
    `/api/v1/admin/model-providers/${encodeURIComponent(id)}/refresh`,
  );
}

export function bindUsage(usageId: string, body: BindUsageRequest): Promise<ModelUsageBinding> {
  return mutate<ModelUsageBinding>(
    'PATCH',
    `/api/v1/admin/model-usages/${encodeURIComponent(usageId)}`,
    body,
  );
}
