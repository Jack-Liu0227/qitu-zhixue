import type { ModelApi } from '@qitu/contracts';
import { providerAuthHeaders, protocolUrl } from './fetch-models';
import type {
  ModelChatMessage,
  ModelCompletionRequest,
  ModelRuntimeTarget,
  ModelTokenUsage,
} from './model-gateway.types';

/**
 * 三种协议的**唯一**适配层。
 *
 * 每个适配器负责两件事：
 *  1. `build`：把统一请求翻译成该协议的 URL / 请求头 / 请求体；
 *  2. `parse`：把该协议的响应 JSON 翻译成统一文本 + 用量 + 结束原因。
 *
 * 约定：`baseUrl` 是网关根；`/v1` 由 `protocolUrl()` 统一补，管理员已写 `/v1`
 * 时不重复补。鉴权头统一由 `providerAuthHeaders()` 构造（Anthropic 走
 * `x-api-key` + `anthropic-version`，其余按 `authHeader` 决定是否 Bearer）。
 *
 * 适配器是纯函数，不读环境、不碰数据库、不构造 fetch，因此可脱离网络单测。
 */

/** 适配器产出的请求描述，交给 `ModelGateway` 统一发送。 */
export interface AdapterRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 适配器解析出的统一响应。 */
export interface AdapterResponse {
  text: string;
  finishReason: string | null;
  usage: ModelTokenUsage | null;
}

export interface ProviderAdapter {
  readonly api: ModelApi;
  build(target: ModelRuntimeTarget, request: ModelCompletionRequest): AdapterRequest;
  parse(payload: unknown): AdapterResponse;
}

/** Anthropic Messages 的 `max_tokens` 是必填；调用方没给时用这个保守默认。 */
const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumOrNull(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  return left + right;
}

/** 统一请求头：JSON + 该协议的鉴权头。 */
function completionHeaders(target: ModelRuntimeTarget): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...providerAuthHeaders(target.api, target.credential, target.authHeader),
  };
}

/** 拆分 system 提示：Anthropic / Responses 把 system 放在独立字段。 */
function splitSystem(messages: readonly ModelChatMessage[]): {
  system: string;
  rest: { role: string; content: string }[];
} {
  const systemParts: string[] = [];
  const rest: { role: string; content: string }[] = [];
  for (const message of messages) {
    if (message.role === 'system') systemParts.push(message.content);
    else rest.push({ role: message.role, content: message.content });
  }
  return { system: systemParts.join('\n\n'), rest };
}

/** OpenAI Chat 的 `message.content` 可能是字符串，也可能是分块数组。 */
function contentToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const parts: string[] = [];
  for (const block of value) {
    const record = asRecord(block);
    if (record !== null && typeof record.text === 'string') parts.push(record.text);
  }
  return parts.join('');
}

/* ------------------------- openai-completions ------------------------- */

const openaiCompletions: ProviderAdapter = {
  api: 'openai-completions',
  build(target, request) {
    const body: Record<string, unknown> = {
      model: target.modelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: false,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    return {
      url: protocolUrl(target.baseUrl, '/chat/completions'),
      headers: completionHeaders(target),
      body: JSON.stringify(body),
    };
  },
  parse(payload) {
    const root = asRecord(payload);
    const choices = Array.isArray(root?.choices) ? root.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    return {
      text: contentToText(message?.content),
      finishReason: typeof first?.finish_reason === 'string' ? first.finish_reason : null,
      usage: openaiUsage(root?.usage),
    };
  },
};

function openaiUsage(value: unknown): ModelTokenUsage | null {
  const usage = asRecord(value);
  if (usage === null) return null;
  const inputTokens = numberOrNull(usage.prompt_tokens);
  const outputTokens = numberOrNull(usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrNull(usage.total_tokens) ?? sumOrNull(inputTokens, outputTokens),
  };
}

/* -------------------------- openai-responses -------------------------- */

const openaiResponses: ProviderAdapter = {
  api: 'openai-responses',
  build(target, request) {
    const { system, rest } = splitSystem(request.messages);
    const body: Record<string, unknown> = {
      model: target.modelId,
      input: rest.map((message) => ({ role: message.role, content: message.content })),
      stream: false,
    };
    // Responses 用 `instructions` 承载 system，而不是放进 input。
    if (system.length > 0) body.instructions = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
    return {
      url: protocolUrl(target.baseUrl, '/responses'),
      headers: completionHeaders(target),
      body: JSON.stringify(body),
    };
  },
  parse(payload) {
    const root = asRecord(payload);
    return {
      text: responsesOutputText(root),
      finishReason: typeof root?.status === 'string' ? root.status : null,
      usage: responsesUsage(root?.usage),
    };
  },
};

/**
 * 从 OpenAI Responses 的 `output` 里提取文本。
 *
 * 新版 Responses 返回的结构形如：
 * ```jsonc
 * {
 *   "output": [
 *     { "type": "reasoning", ... },
 *     { "type": "message", "role": "assistant",
 *       "content": [{ "type": "output_text", "text": "…", "annotations": [] }] }
 *   ]
 * }
 * ```
 * 因此只认 `type === 'output_text'`（兼容少数网关的 `'text'`）的 text 块；
 * 若网关直接给了顶层 `output_text` 字符串（部分兼容层会带），优先使用；
 * 也兼容 `output` 本身就是字符串的情况。非文本块（如 reasoning）跳过。
 */
function responsesOutputText(root: Record<string, unknown> | null): string {
  if (root === null) return '';
  const direct = root.output_text;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const output = root.output;
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record === null) continue;
    const content = record.content;
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const blockRecord = asRecord(block);
      if (blockRecord === null) continue;
      const type = blockRecord.type;
      if ((type === 'output_text' || type === 'text') && typeof blockRecord.text === 'string') {
        parts.push(blockRecord.text);
      }
    }
  }
  return parts.join('');
}

function responsesUsage(value: unknown): ModelTokenUsage | null {
  const usage = asRecord(value);
  if (usage === null) return null;
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrNull(usage.total_tokens) ?? sumOrNull(inputTokens, outputTokens),
  };
}

/* -------------------------- anthropic-messages -------------------------- */

const anthropicMessages: ProviderAdapter = {
  api: 'anthropic-messages',
  build(target, request) {
    const { system, rest } = splitSystem(request.messages);
    const body: Record<string, unknown> = {
      model: target.modelId,
      // Anthropic 要求 max_tokens 必填；调用方没给时用保守默认。
      max_tokens: request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      messages: rest.map((message) => ({ role: message.role, content: message.content })),
    };
    if (system.length > 0) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    return {
      url: protocolUrl(target.baseUrl, '/messages'),
      headers: completionHeaders(target),
      body: JSON.stringify(body),
    };
  },
  parse(payload) {
    const root = asRecord(payload);
    const content = Array.isArray(root?.content) ? root.content : [];
    const parts: string[] = [];
    for (const block of content) {
      const record = asRecord(block);
      if (record !== null && record.type === 'text' && typeof record.text === 'string') {
        parts.push(record.text);
      }
    }
    const usage = asRecord(root?.usage);
    const inputTokens = numberOrNull(usage?.input_tokens);
    const outputTokens = numberOrNull(usage?.output_tokens);
    return {
      text: parts.join(''),
      finishReason: typeof root?.stop_reason === 'string' ? root.stop_reason : null,
      usage:
        usage === null
          ? null
          : { inputTokens, outputTokens, totalTokens: sumOrNull(inputTokens, outputTokens) },
    };
  },
};

const ADAPTERS: Record<ModelApi, ProviderAdapter> = {
  'openai-completions': openaiCompletions,
  'openai-responses': openaiResponses,
  'anthropic-messages': anthropicMessages,
};

/** 按协议取适配器。三种协议在类型层已穷尽，运行时仍兜底给清晰错误。 */
export function adapterFor(api: ModelApi): ProviderAdapter {
  const adapter = ADAPTERS[api];
  if (adapter === undefined) {
    // 类型系统保证不会走到这里；防御未来新增协议值时忘记接线。
    throw new Error(`未实现的模型协议适配器：${String(api)}`);
  }
  return adapter;
}
