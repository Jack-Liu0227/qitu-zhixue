import type { ProviderPreset } from '@qitu/contracts';

/**
 * 预置供应商模板。
 *
 * 存在的意义有两个：
 *  1. 少手填 -> 少配错（`baseUrl` + 协议 + 认证头是配错的重灾区）。
 *  2. **诚实声明模态**。上游 `/models` 不返回模态信息，所以「这个模型能不能
 *     听、能不能说」只能由人声明。这里只写我们确实知道的：
 *     `qwen-audio-3.0-realtime-plus` 是我们要用的语音模型，因此显式给
 *     `audio`；其余一律只声明 `text`。
 *
 * 新增预置时请**同时**确认模态，不要把猜测写进来。
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'qwen-dashscope',
    name: '通义千问（DashScope 兼容模式）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    api: 'openai-completions',
    authHeader: true,
    suggestedModels: [
      {
        id: 'qwen-audio-3.0-realtime-plus',
        name: 'Qwen Audio 3.0 Realtime Plus',
        input: ['text', 'audio'],
        output: ['text', 'audio'],
      },
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', input: ['text'], output: ['text'] },
      { id: 'qwen-plus', name: 'Qwen Plus', input: ['text'], output: ['text'] },
      { id: 'qwen-max', name: 'Qwen Max', input: ['text'], output: ['text'] },
      // 检索用：文本向量化，是知识库 RAG 的前置。
      { id: 'text-embedding-v3', name: 'Text Embedding v3', input: ['text'], output: ['text'] },
    ],
  },
  {
    id: 'qwen-token-plan',
    name: '通义千问（百炼 Token Plan）',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode',
    api: 'openai-completions',
    authHeader: true,
    suggestedModels: [
      { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', input: ['text'], output: ['text'] },
      { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', input: ['text'], output: ['text'] },
      { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', input: ['text'], output: ['text'] },
      {
        id: 'qwen-audio-3.0-realtime-plus',
        name: 'Qwen Audio 3.0 Realtime Plus',
        input: ['text', 'audio'],
        output: ['text', 'audio'],
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    api: 'openai-responses',
    authHeader: true,
    suggestedModels: [
      { id: 'gpt-realtime', name: 'GPT Realtime', input: ['text', 'audio'], output: ['text', 'audio'] },
      { id: 'gpt-4.1', name: 'GPT-4.1', input: ['text', 'image'], output: ['text'] },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    authHeader: true,
    // 官方没有实时语音模型；只声明文本能力，不要凑数。
    suggestedModels: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', input: ['text'], output: ['text'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', input: ['text'], output: ['text'] },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    authHeader: false,
    suggestedModels: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', input: ['text', 'image'], output: ['text'] },
    ],
  },
];
