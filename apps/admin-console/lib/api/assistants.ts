import type { AdminRuntimeAgent, AdminRuntimeAgentUpdateRequest, AdminRuntimeSnapshot } from '@qitu/contracts';
import { fetchRuntimeSnapshot, updateRuntimeAgent, createRuntimeAgent } from './runtime';

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
