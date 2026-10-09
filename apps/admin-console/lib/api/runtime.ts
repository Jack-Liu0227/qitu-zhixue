import { createApiClient } from '@qitu/api-client';
import type { AdminRuntimeAgentUpdateRequest, AdminRuntimeSnapshot, AdminRuntimeAgent } from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

/**
 * AI 运行时治理 API 层。
 *
 * 读取使用 `GET /api/v1/admin/ai-runtime`，角色配置使用 Admin-only
 * `PATCH /api/v1/admin/ai-runtime/agents/:agentId`；所有写入都带幂等键，
 * 服务端负责权限、字段校验、审计和脱敏。
 */

/** 治理接口尚未在该环境部署（HTTP 404）。与「权限不足」「离线」区分开。 */
export class AdminRuntimeUnavailableError extends Error {
  constructor() {
    super('AI 运行时治理接口尚未在该环境启用');
    this.name = 'AdminRuntimeUnavailableError';
  }
}

const client = createApiClient('');

export async function createRuntimeAgent(
  agentId: string,
  input: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  return mutateRuntimeAgent('POST', agentId, input, idempotencyKey);
}

export async function updateRuntimeAgent(
  agentId: string,
  input: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  return mutateRuntimeAgent('PATCH', agentId, input, idempotencyKey);
}

async function mutateRuntimeAgent(
  method: 'POST' | 'PATCH',
  agentId: string,
  input: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/ai-runtime/agents/${encodeURIComponent(agentId)}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  const payload = await response.json().catch(() => null) as DataEnvelope<AdminRuntimeAgent> & { detail?: string; message?: string } | null;
  if (!response.ok) {
    const error = new Error(payload?.detail ?? payload?.message ?? (method === 'POST' ? '角色创建失败' : '角色保存失败')) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  if (!payload || !payload.data) throw new Error('服务端未返回角色配置');
  return payload.data;
}
export async function fetchRuntimeSnapshot(): Promise<AdminRuntimeSnapshot> {
  try {
    const response = await client.get<DataEnvelope<AdminRuntimeSnapshot>>('/api/v1/admin/ai-runtime');
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
      if (status === 404) {
        throw new AdminRuntimeUnavailableError();
      }
    }
    throw error;
  }
}
