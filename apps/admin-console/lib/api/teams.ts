import type { AdminTeamConfig } from '@qitu/contracts';
import { THUNDER_FIGHTER_TEAM_CONFIG } from '@qitu/ai-client';
import type { DataEnvelope } from './types';

export async function fetchAdminTeams(): Promise<AdminTeamConfig[]> {
  try {
    const response = await fetch('/api/v1/admin/ai-runtime/teams', {
      method: 'GET',
      credentials: 'include',
    });
    if (response.ok) {
      const data = ((await response.json()) as DataEnvelope<AdminTeamConfig[]>).data;
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    // Fall back to built-in registered teams
  }
  return [THUNDER_FIGHTER_TEAM_CONFIG];
}

export async function updateAdminTeam(
  id: string,
  patch: Partial<AdminTeamConfig>,
  idempotencyKey: string,
): Promise<AdminTeamConfig> {
  try {
    const response = await fetch(`/api/v1/admin/ai-runtime/teams/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      return ((await response.json()) as DataEnvelope<AdminTeamConfig>).data;
    }
  } catch {
    // If backend endpoint is offline in mock/demo, return merged object
  }

  if (id !== THUNDER_FIGHTER_TEAM_CONFIG.id) {
    throw new Error(`TEAM_NOT_FOUND: ${id}`);
  }
  return {
    ...THUNDER_FIGHTER_TEAM_CONFIG,
    ...patch,
    id: THUNDER_FIGHTER_TEAM_CONFIG.id,
    updatedAt: new Date().toISOString(),
  };
}
