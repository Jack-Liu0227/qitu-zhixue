import type { VisualAssetSummary, VisualBinding, VisualBindingPatch, VisualBindingResult, VisualOwner, VisualUsage } from '@qitu/contracts';
import { adminEnvelopeRequest } from './types';

export function fetchVisualAssets(usage: VisualUsage): Promise<VisualAssetSummary[]> {
  return adminEnvelopeRequest({ path: `/api/v1/admin/visual-assets?usage=${usage}`, method: 'GET' });
}
export function fetchVisualBinding(owner: VisualOwner, usage: VisualUsage): Promise<VisualBinding> {
  return adminEnvelopeRequest({ path: `/api/v1/admin/visual-assets/binding?kind=${owner.kind}&id=${encodeURIComponent(owner.id)}&usage=${usage}`, method: 'GET' });
}
export function saveVisualBindings(inputs: VisualBindingPatch[], idempotencyKey: string): Promise<VisualBindingResult[]> {
  return adminEnvelopeRequest({ path: '/api/v1/admin/visual-assets/bindings', method: 'PATCH', body: inputs, idempotencyKey });
}
