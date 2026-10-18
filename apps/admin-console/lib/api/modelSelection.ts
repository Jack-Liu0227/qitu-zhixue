import type { ProviderConfigPublic } from '@qitu/contracts';

export interface ConfiguredModelItem {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
}

export function configuredModelKey(model: { providerId: string; id: string }): string {
  return JSON.stringify([model.providerId, model.id]);
}

export function configuredModelLabel(value: string, catalog: readonly ConfiguredModelItem[]): string {
  if (!value) return '未指定（跟随平台默认）';
  const model = catalog.find((item) => configuredModelKey(item) === value);
  if (model) {
    const provider = model.providerName || model.providerId;
    const suffix = ` (${provider})`;
    const name = model.name.endsWith(suffix) ? model.name.slice(0, -suffix.length) : model.name;
    return `${provider} / ${name || model.id}`;
  }
  try {
    const pair: unknown = JSON.parse(value);
    if (Array.isArray(pair) && pair.length === 2 && pair.every((item) => typeof item === 'string')) {
      return `${pair[0] || '未指定供应商'} / ${pair[1]}（当前绑定不可用）`;
    }
  } catch {
    // An unavailable display value must never become a selectable model route.
  }
  return '当前绑定不可用';
}

export function configuredModelPatch(value: string, catalog: readonly ConfiguredModelItem[]) {
  if (!value) return { modelProviderId: null, modelId: null };
  const model = catalog.find((item) => configuredModelKey(item) === value);
  if (!model) throw new Error('模型目录不可用或当前模型已下线，请重新加载后选择。');
  return { modelProviderId: model.providerId, modelId: model.id };
}

export function configuredChatModels(providers: readonly ProviderConfigPublic[]): ConfiguredModelItem[] {
  return providers.flatMap((provider) => {
    const requiresCredential = provider.authHeader || provider.api === 'anthropic-messages' || provider.api === 'google-gemini';
    if (!provider.enabled || !provider.baseUrl || (requiresCredential && !provider.auth.configured)) return [];
    return provider.models.filter((model) => model.input.includes('text') && model.output.includes('text')).map((model) => ({
      id: model.id,
      name: `${model.name || model.id} (${provider.name})`,
      providerId: provider.id,
      providerName: provider.name,
    }));
  });
}
