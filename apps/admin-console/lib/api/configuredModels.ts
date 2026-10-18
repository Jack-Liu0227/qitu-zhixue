import { fetchProviders } from './modelRegistry';

export interface ConfiguredModelItem {
  id: string; // e.g. "deepseek-chat"
  name: string; // e.g. "DeepSeek-V3 (DeepSeek 官方网关)"
  rawModelId?: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  api: string;
  authHeader?: boolean;
  authConfigured?: boolean;
  enabled: boolean;
}

/**
 * 获取系统中当前真实已配置并启用的模型列表。
 *
 * 核心原则：
 * 严格仅从管理员已配置并启用的供应商通道（Provider）中提取真实模型；
 * 严禁自动填充任何虚假的、未由用户或系统配置的模型（如未配置的 gpt-5.6-sol 或 claude-3-7-sonnet）。
 */
export async function fetchAvailableConfiguredModels(): Promise<ConfiguredModelItem[]> {
  try {
    const data = await fetchProviders();
    const result: ConfiguredModelItem[] = [];

    for (const provider of data.providers) {
      if (!provider.enabled) continue;

      // 仅从该通道已配置（自动拉取或管理员手动登记）的模型列表中提取
      if (provider.models && provider.models.length > 0) {
        for (const m of provider.models) {
          result.push({
            id: m.id,
            name: `${m.name || m.id} (${provider.name})`,
            rawModelId: m.id,
            providerId: provider.id,
            providerName: provider.name,
            baseUrl: provider.baseUrl,
            api: provider.api,
            authHeader: provider.authHeader,
            authConfigured: provider.auth.configured,
            enabled: true,
          });
        }
      }
    }

    // 同步将真实获取到的配置模型写入缓存，供离线提示使用
    if (typeof window !== 'undefined' && result.length > 0) {
      try {
        localStorage.setItem('qitu.cached_configured_models', JSON.stringify(result));
      } catch {
        // 忽略存储配额异常
      }
    }

    return result;
  } catch (err) {
    console.warn('获取配置模型失败，尝试读取本地缓存的真实配置', err);
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.cached_configured_models');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // 忽略
      }
    }
    // 未配置任何模型时返回空列表，绝不生成假数据
    return [];
  }
}
