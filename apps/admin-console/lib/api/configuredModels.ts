import { fetchProviders } from './modelRegistry';

export interface ConfiguredModelItem {
  id: string; // e.g. "gpt-5.6-sol"
  name: string; // e.g. "GPT-5.6 Sol (生产专线)"
  providerId: string;
  providerName: string;
  api: string;
  enabled: boolean;
}

export async function fetchAvailableConfiguredModels(): Promise<ConfiguredModelItem[]> {
  try {
    const data = await fetchProviders();
    const result: ConfiguredModelItem[] = [];

    for (const provider of data.providers) {
      if (!provider.enabled) continue;

      // 从该通道已配置的模型中提取
      if (provider.models && provider.models.length > 0) {
        for (const m of provider.models) {
          result.push({
            id: m.id,
            name: `${m.name || m.id} (${provider.name})`,
            providerId: provider.id,
            providerName: provider.name,
            api: provider.api,
            enabled: true,
          });
        }
      } else {
        // 如果供应商尚未配置单独模型列表，但供应商已配置并启用，注入其典型兼容模型
        const defaultModels = provider.api.includes('anthropic')
          ? ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku']
          : provider.id.includes('deepseek')
            ? ['deepseek-r1', 'deepseek-v3']
            : ['gpt-5.6-sol', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'];

        for (const modId of defaultModels) {
          result.push({
            id: modId,
            name: `${modId} (${provider.name})`,
            providerId: provider.id,
            providerName: provider.name,
            api: provider.api,
            enabled: true,
          });
        }
      }
    }

    return result;
  } catch (err) {
    console.warn('获取配置模型失败，使用安全预设模型', err);
    return [
      { id: 'gpt-5.6-sol', name: 'gpt-5.6-sol (主通道)', providerId: 'default-openai', providerName: 'OpenAI 通道', api: 'openai-completions', enabled: true },
      { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet (Claude 极速通道)', providerId: 'default-anthropic', providerName: 'Anthropic 通道', api: 'anthropic-messages', enabled: true },
      { id: 'deepseek-r1', name: 'deepseek-r1 (推理通道)', providerId: 'default-deepseek', providerName: 'DeepSeek 通道', api: 'openai-completions', enabled: true },
    ];
  }
}
