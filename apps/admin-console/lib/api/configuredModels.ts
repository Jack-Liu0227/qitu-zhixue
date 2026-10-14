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

    // 检查管理员本地浏览器缓存中是否有已保存的已配置模型 (qitu.admin.custom_models)
    if (typeof window !== 'undefined') {
      try {
        const localCustom = localStorage.getItem('qitu.admin.custom_models');
        if (localCustom) {
          const parsed: ConfiguredModelItem[] = JSON.parse(localCustom);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.id && !result.some((r) => r.id === item.id && r.providerId === item.providerId)) {
                result.push(item);
              }
            }
          }
        }

        // 若成功获取到了已配置模型，同步写入本地缓存
        if (result.length > 0) {
          localStorage.setItem('qitu.cached_configured_models', JSON.stringify(result));
        }
      } catch {
        // 忽略本地存储异常
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
