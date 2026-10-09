import type { AdminAssistantConfig } from '@qitu/contracts';
import { BUILTIN_ASSISTANTS } from '@qitu/ai-client';
import type { DataEnvelope } from './types';

export async function fetchAdminAssistants(): Promise<AdminAssistantConfig[]> {
  try {
    const response = await fetch('/api/v1/admin/ai-runtime/assistants', {
      method: 'GET',
      credentials: 'include',
    });
    if (response.ok) {
      const data = ((await response.json()) as DataEnvelope<AdminAssistantConfig[]>).data;
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    // Fall back to built-in registered assistants
  }
  return [...BUILTIN_ASSISTANTS];
}

export async function updateAdminAssistant(
  id: string,
  patch: Partial<AdminAssistantConfig>,
  idempotencyKey: string,
): Promise<AdminAssistantConfig> {
  try {
    const response = await fetch(`/api/v1/admin/ai-runtime/assistants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      return ((await response.json()) as DataEnvelope<AdminAssistantConfig>).data;
    }
  } catch {
    // If backend endpoint is offline in mock/demo, return merged object
  }

  const existing = (BUILTIN_ASSISTANTS as AdminAssistantConfig[]).find((a: AdminAssistantConfig) => a.id === id);
  if (!existing) throw new Error(`ASSISTANT_NOT_FOUND: ${id}`);
  return {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };
}
