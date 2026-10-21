import type { GrowthProjectionSettings, GrowthProjectionSettingsView } from '@qitu/contracts';
import { adminEnvelopeRequest } from './types';

const path = '/api/v1/admin/growth-projection/settings';

export function fetchGrowthProjectionSettings() {
  return adminEnvelopeRequest<GrowthProjectionSettingsView>({ path, method: 'GET' });
}

export function saveGrowthProjectionSettings(expectedRevision: number, settings: GrowthProjectionSettings, idempotencyKey: string) {
  return adminEnvelopeRequest<GrowthProjectionSettingsView>({
    path, method: 'PATCH', body: { expectedRevision, settings }, idempotencyKey,
  });
}
