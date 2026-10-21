import type {
  AdminAssistantConfig,
  AdminAssistantCreateInput,
  AdminAssistantUpdateInput,
  AdminRuntimeAgent,
  AdminRuntimeAgentUpdateRequest,
  AdminRuntimeSnapshot,
} from '@qitu/contracts';
import { fetchRuntimeSnapshot, updateRuntimeAgent, createRuntimeAgent } from './runtime';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

export function fetchAdminAssistants(): Promise<AdminRuntimeSnapshot> {
  return fetchRuntimeSnapshot();
}

export async function updateAdminAssistant(
  id: string,
  patch: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  return updateRuntimeAgent(id, patch, idempotencyKey);
}

export function createAdminAssistant(
  id: string,
  input: AdminRuntimeAgentUpdateRequest,
  idempotencyKey: string,
): Promise<AdminRuntimeAgent> {
  return createRuntimeAgent(id, input, idempotencyKey);
}

const ADMIN_ASSISTANTS_PATH = '/api/v1/admin/ai-runtime/assistants';
const ADMIN_ASSISTANT_ITEM_PATH = (id: string) => `${ADMIN_ASSISTANTS_PATH}/${encodeURIComponent(id)}`;

/** Persisted assistant CRUD used by the SDK-compatible settings surfaces. */
export function fetchAdminAssistantConfigs(): Promise<AdminAssistantConfig[]> {
  return adminEnvelopeRequest<AdminAssistantConfig[]>({ path: ADMIN_ASSISTANTS_PATH, method: 'GET' });
}

export async function createPersistedAssistant(
  input: AdminAssistantCreateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminAssistantConfig> {
  const saved = await adminEnvelopeRequest<AdminAssistantConfig>({
    path: ADMIN_ASSISTANTS_PATH,
    method: 'POST',
    body: input,
    idempotencyKey,
  });
  return readAssistant(saved);
}

export async function updatePersistedAssistant(
  id: string,
  patch: AdminAssistantUpdateInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<AdminAssistantConfig> {
  const saved = await adminEnvelopeRequest<AdminAssistantConfig>({
    path: ADMIN_ASSISTANT_ITEM_PATH(id),
    method: 'PATCH',
    body: patch,
    idempotencyKey,
  });
  return readAssistant(saved);
}

async function readAssistant(saved: AdminAssistantConfig): Promise<AdminAssistantConfig> {
  const current = (await fetchAdminAssistantConfigs()).find((item) => item.id === saved.id);
  if (!current || current.updatedAt !== saved.updatedAt) throw new Error('助手保存后的回读未确认，请刷新核对后重试。');
  return current;
}

export function deletePersistedAssistant(
  id: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<{ success: true; deletedAssistantId: string }> {
  return adminEnvelopeRequest<{ success: true; deletedAssistantId: string }>({
    path: ADMIN_ASSISTANT_ITEM_PATH(id),
    method: 'DELETE',
    idempotencyKey,
  });
}

