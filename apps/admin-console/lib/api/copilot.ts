import type { AdminCopilotCapabilities, AdminCopilotRequest, AdminCopilotResponse } from '@qitu/contracts';
import { adminEnvelopeRequest } from './types';

export function fetchCopilotCapabilities() {
  return adminEnvelopeRequest<AdminCopilotCapabilities>({
    path: '/api/v1/admin/copilot/capabilities', method: 'GET',
  });
}

export function runCopilotTurn(request: AdminCopilotRequest, key: string) {
  return adminEnvelopeRequest<AdminCopilotResponse>({
    path: '/api/v1/admin/copilot/turns', method: 'POST', body: request, idempotencyKey: key,
  });
}
