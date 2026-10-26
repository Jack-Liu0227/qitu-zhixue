import type { ModelApi, ProviderPreset } from '@qitu/contracts';

export const API_OPTIONS: Array<{ value: ModelApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'google-gemini', label: 'Google Gemini Native (v1beta)' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

export function formatTime(value: string | null | undefined): string {
  if (!value) return '未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未同步' : date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 从预置模板的 `api` / `authHeader` 如实推导鉴权方式展示文案。
 */
export function presetAuthLabel(preset: ProviderPreset): string {
  if (preset.api === 'anthropic-messages') return 'apiKey (x-api-key)';
  return preset.authHeader ? 'apiKey (Authorization: Bearer)' : '无鉴权头';
}

/** 展示归类（仅用于弹窗分组，不是数据硬编码）。 */
export type ModelGroup = 'OpenAI' | '阿里百炼 / 通义千问' | 'DeepSeek' | 'Anthropic Claude' | 'Google Gemini' | '其他';

export function classifyModelGroup(modelId: string): ModelGroup {
  const lower = modelId.toLowerCase();
  if (lower.includes('gemini') || lower.includes('google')) {
    return 'Google Gemini';
  }
  if (lower.startsWith('gpt-') || lower.startsWith('o1-') || lower.startsWith('o3-') || lower.includes('openai') || lower.includes('embedding')) {
    return 'OpenAI';
  }
  if (lower.includes('qwen') || lower.includes('bailian') || lower.includes('wanx')) {
    return '阿里百炼 / 通义千问';
  }
  if (lower.includes('deepseek')) {
    return 'DeepSeek';
  }
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return 'Anthropic Claude';
  }
  return '其他';
}
