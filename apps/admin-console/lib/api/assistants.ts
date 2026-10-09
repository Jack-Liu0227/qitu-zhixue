/**
 * 管理端「助手」API —— 真实接口，无任何静默回退。
 *
 * 对应冻结契约（`@qitu/contracts` team-runtime 写入侧 DTO）：
 *   GET    /api/v1/admin/ai-runtime/assistants
 *   POST   /api/v1/admin/ai-runtime/assistants
 *   PATCH  /api/v1/admin/ai-runtime/assistants/:id
 *
 * 失败一律抛出（断网 → AdminOfflineError；401/403 → AdminPermissionError；
 * 其余 → AdminApiError 携带服务端错误码）。页面据此渲染 loading / empty /
 * error / 断网 / 权限失败五种可见状态；禁止回退到内置常量假装成功。
 */
import type {
  AdminAssistantConfig,
  AdminAssistantCreateInput,
  AdminAssistantUpdateInput,
} from '@qitu/contracts';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

const ADMIN_ASSISTANTS_PATH = '/api/v1/admin/ai-runtime/assistants';

const ADMIN_ASSISTANT_ITEM_PATH = (id: string) =>
  `${ADMIN_ASSISTANTS_PATH}/${encodeURIComponent(id)}`;

/** 助手列表；空数组是合法的 empty 态，由页面渲染「暂无助手」。 */
export function fetchAdminAssistants(): Promise<AdminAssistantConfig[]> {
  return adminEnvelopeRequest<AdminAssistantConfig[]>({
    path: ADMIN_ASSISTANTS_PATH,
    method: 'GET',
  });
}

/**
 * 创建助手（POST）。幂等键只走 `Idempotency-Key` HTTP 头，不进 body、不进 URL；
 * 缺省自动生成，未确认的重试应由调用方传入同一键。
 */
export function createAdminAssistant(
  input: AdminAssistantCreateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminAssistantConfig> {
  return adminEnvelopeRequest<AdminAssistantConfig>({
    path: ADMIN_ASSISTANTS_PATH,
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

/**
 * 更新助手（PATCH）。`id`/`source`/`deletable`/`agentStatus` 等运行态字段
 * 不可写，类型上就不存在；空补丁会被服务端拒绝（错误码原样上抛显示）。
 */
export function updateAdminAssistant(
  id: string,
  patch: AdminAssistantUpdateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminAssistantConfig> {
  return adminEnvelopeRequest<AdminAssistantConfig>({
    path: ADMIN_ASSISTANT_ITEM_PATH(id),
    method: 'PATCH',
    body: patch,
    idempotencyKey,
  });
}
