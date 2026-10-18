import { fetchProviders } from './modelRegistry';
import { configuredChatModels } from './modelSelection';

export { configuredModelKey, configuredModelLabel, configuredModelPatch } from './modelSelection';
export type { ConfiguredModelItem } from './modelSelection';

/** Current server catalog only. Offline caches never authorize a model route. */
export async function fetchAvailableConfiguredModels() {
  return configuredChatModels((await fetchProviders()).providers);
}
