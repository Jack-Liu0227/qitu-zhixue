import { ApiError, createApiClient } from '@qitu/api-client';
import type {
  AdminModelResponse,
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ConnectionTestResponse,
  CreateManualModelRequest,
  ModelUsageBinding,
  ProviderConfigPublic,
  RefreshProviderResponse,
  UpdateManualModelRequest,
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

async function mutate<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  // 幂等键只随请求头/请求体传输一次，不写入 URL、日志或本地存储。
  if (idempotencyKey !== undefined && idempotencyKey.length > 0) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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

/* ------------------------------ 连接测试 ------------------------------ */

/**
 * 连接测试三入口统一走 `POST` **空 body**：
 *  - 只用服务端**已保存**的地址与密钥发起探测，密钥永不进 URL / body / 本地状态；
 *  - 上游失败由服务端归一为 `200 + ok=false`（`ConnectionTestResponse`），
 *    因此网络层 4xx/5xx 只代表「请求本身」失败（未知资源 404、未登录 401/403）。
 *  - 测试不修改任何配置，也不写审计，前端只把结果留在组件内。
 */
export function testProviderConnection(providerId: string): Promise<ConnectionTestResponse> {
  return mutate<ConnectionTestResponse>(
    'POST',
    `/api/v1/admin/model-providers/${encodeURIComponent(providerId)}/test`,
  );
}

export function testModelConnection(
  providerId: string,
  modelId: string,
): Promise<ConnectionTestResponse> {
  return mutate<ConnectionTestResponse>(
    'POST',
    `/api/v1/admin/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/test`,
  );
}

export function testUsageConnection(usageId: string): Promise<ConnectionTestResponse> {
  return mutate<ConnectionTestResponse>('POST', `/api/v1/admin/model-usages/${encodeURIComponent(usageId)}/test`);
}

/**
 * 生成一次性幂等键。
 *
 * 优先用 `crypto.randomUUID`；不可用时回退到时间戳 + 随机数。键只在本次
 * 提交里使用，不进 URL / localStorage / 日志。
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `manual-model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 手工新增模型。
 *
 * 幂等键同时放进请求体（契约要求）与 `Idempotency-Key` 头（服务端优先读头，
 * 两者一致才不会 400）。键由调用方在表单提交时生成一次，重试复用同一把。
 */
export function createManualModel(
  providerId: string,
  body: CreateManualModelRequest,
): Promise<AdminModelResponse> {
  return mutate<AdminModelResponse>(
    'POST',
    `/api/v1/admin/model-providers/${encodeURIComponent(providerId)}/models`,
    body,
    body.idempotencyKey,
  );
}

/**
 * 更新手工模型。`modelId` 只在路径里出现，请求体不含它（契约故意不可变）。
 */
export function updateManualModel(
  providerId: string,
  modelId: string,
  body: UpdateManualModelRequest,
): Promise<AdminModelResponse> {
  return mutate<AdminModelResponse>(
    'PATCH',
    `/api/v1/admin/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    body,
    body.idempotencyKey,
  );
}

/**
 * 删除**未被绑定**的手工模型。远程模型与已绑定模型由服务端拒绝（409）。
 * DELETE 无契约 body，幂等键只放请求头。
 */
export function deleteManualModel(
  providerId: string,
  modelId: string,
  idempotencyKey: string,
): Promise<{ providerId: string; modelId: string }> {
  return mutate<{ providerId: string; modelId: string }>(
    'DELETE',
    `/api/v1/admin/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
    undefined,
    idempotencyKey,
  );
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
