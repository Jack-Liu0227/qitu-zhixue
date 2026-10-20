import type { ToolBindingMigrationPlan, ToolBindingMigrationResult } from '@qitu/contracts';
import { adminEnvelopeRequest, newIdempotencyKey } from './types';

const path = '/api/v1/admin/ai-runtime/tools/bindings-migration';

export function fetchToolBindingMigrationPlan(): Promise<ToolBindingMigrationPlan> {
  return adminEnvelopeRequest({ path, method: 'GET' });
}

export function migrateToolBindings(revision: string): Promise<ToolBindingMigrationResult> {
  return adminEnvelopeRequest({ path, method: 'PATCH', body: { revision }, idempotencyKey: newIdempotencyKey() });
}
