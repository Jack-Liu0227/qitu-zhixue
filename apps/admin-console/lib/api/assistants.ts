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

export function createPersistedAssistant(
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

export function updatePersistedAssistant(
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
