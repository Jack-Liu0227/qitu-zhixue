import { createApiClient } from '@qitu/api-client';
import type { AdminRuntimeAgentUpdateRequest, AdminRuntimeSnapshot, AdminRuntimeAgent } from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, type DataEnvelope } from './types';

/**
 * AI 运行时治理（只读）API 层。
 *
 * 对应 `GET /api/v1/admin/ai-runtime`。这是**唯一**的读取路径：
 *  - 只发 GET，浏览器侧没有任何写入 transport；
 *  - 响应已由服务端脱敏（无密钥 / 无 MCP 凭据 / 无完整提示词 / 无原始对话）；
 *  - 接口尚未部署时返回 404，归一为 `AdminRuntimeUnavailableError`，
 *    由页面明确标注「尚未启用」，而不是伪装成通用错误或空数据。
 */

/** 治理接口尚未在该环境部署（HTTP 404）。与「权限不足」「离线」区分开。 */
export class AdminRuntimeUnavailableError extends Error {
  constructor() {
    super('AI 运行时治理接口尚未在该环境启用');
    this.name = 'AdminRuntimeUnavailableError';
  }
}

const client = createApiClient('');

export async function updateRuntimeAgent(
  agentId: string,
  input: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  const response = await fetch(`/api/v1/admin/ai-runtime/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string; message?: string } | null;
    const error = new Error(payload?.detail ?? payload?.message ?? '角色保存失败') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return ((await response.json()) as DataEnvelope<AdminRuntimeAgent>).data;
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
