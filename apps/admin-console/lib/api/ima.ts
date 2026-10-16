import type { AdminImaSettings, AdminImaSettingsPatch } from '@qitu/contracts';
import { adminEnvelopeRequest } from './types';

const path = '/api/v1/admin/ai-runtime/mcp/ima-knowledge';
export const fetchImaSettings = () => adminEnvelopeRequest<AdminImaSettings>({ path, method: 'GET' });
export const saveImaSettings = (body: AdminImaSettingsPatch, idempotencyKey: string) =>
  adminEnvelopeRequest<AdminImaSettings>({ path, method: 'PATCH', body, idempotencyKey });
export const checkImaConnection = (idempotencyKey: string) =>
  adminEnvelopeRequest<AdminImaSettings>({ path: `${path}/check`, method: 'POST', idempotencyKey });
