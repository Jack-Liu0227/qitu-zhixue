import type { BindUsageRequest } from '@qitu/contracts';

/** Explicit selections never silently fall back; null pairs opt into purpose routing. */
export function resolveAgentModelSelection(
  config: { modelProviderId: string | null; modelId: string | null; modelUsage: string },
  resolveUsage: (usageId: string) => BindUsageRequest | null,
): BindUsageRequest {
  if (config.modelProviderId !== null || config.modelId !== null) {
    return { providerId: config.modelProviderId, modelId: config.modelId };
  }
  return resolveUsage(config.modelUsage) ?? { providerId: null, modelId: null };
}
