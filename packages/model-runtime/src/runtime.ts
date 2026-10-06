import {
  anthropicMessagesApi,
} from './pi/api/anthropic-messages.lazy.js';
import { openAICompletionsApi } from './pi/api/openai-completions.lazy.js';
import { openAIResponsesApi } from './pi/api/openai-responses.lazy.js';
import { contentText } from './pi/utils/text.js';
import { createModels, createProvider } from './pi/models.js';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderStreams,
  StreamOptions,
} from './pi/types.js';

export type QituModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface ModelRuntimeTarget {
  providerId: string;
  providerName: string;
  modelId: string;
  baseUrl: string;
  api: QituModelApi;
  /** Decrypted server-side credential, if this provider requires one. */
  credential?: string | null;
  /** OpenAI-compatible providers may explicitly opt out of Bearer auth. */
  authHeader?: boolean;
  input?: readonly ('text' | 'image' | 'audio')[];
  contextWindow?: number | null;
  maxTokens?: number | null;
}

export interface ModelRuntimeResolver {
  resolveRuntimeTarget(usageId: string): ModelRuntimeTarget | Promise<ModelRuntimeTarget>;
  resolveRuntimeTargetByModel?(selection: { providerId: string; modelId: string }): ModelRuntimeTarget | Promise<ModelRuntimeTarget>;
}

export interface ModelRuntimeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRuntimeRequest {
  usageId: string;
  providerId?: string;
  modelId?: string;
  messages: readonly ModelRuntimeMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  requestId?: string;
}

export interface ModelRuntimeUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface ModelRuntimeResult {
  providerId: string;
  modelId: string;
  api: QituModelApi;
  text: string;
  finishReason: string | null;
  usage: ModelRuntimeUsage | null;
}

export type ModelRuntimeEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; callId: string; toolName: string; arguments: Record<string, unknown> }
  | { type: 'done'; result: ModelRuntimeResult }
  | { type: 'error'; code: ModelRuntimeErrorCode; message: string; retryable: boolean };

export type ModelRuntimeErrorCode =
  | 'MODEL_USAGE_UNKNOWN'
  | 'MODEL_USAGE_NOT_BOUND'
  | 'MODEL_PROVIDER_NOT_FOUND'
  | 'MODEL_PROVIDER_DISABLED'
  | 'MODEL_BASE_URL_MISSING'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DISABLED'
  | 'MODEL_CREDENTIAL_MISSING'
  | 'MODEL_REQUEST_INVALID'
  | 'MODEL_REQUEST_TIMEOUT'
  | 'MODEL_REQUEST_ABORTED'
  | 'MODEL_UPSTREAM_HTTP_ERROR'
  | 'MODEL_RESPONSE_INVALID'
  | 'MODEL_EMPTY_RESPONSE'
  | 'MODEL_TRANSPORT_ERROR'
  | 'MODEL_STREAM_ERROR';

export class ModelRuntimeError extends Error {
  readonly code: ModelRuntimeErrorCode;
  readonly retryable: boolean;
  readonly upstreamStatus: number | null;

  constructor(
    code: ModelRuntimeErrorCode,
    message: string,
    options: { retryable?: boolean; upstreamStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'ModelRuntimeError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

export interface ModelRuntime {
  complete(input: ModelRuntimeRequest): Promise<ModelRuntimeResult>;
  stream(input: ModelRuntimeRequest): AsyncGenerator<ModelRuntimeEvent>;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 4_096;

export function createModelRuntime(resolver: ModelRuntimeResolver): ModelRuntime {
  const runtime: ModelRuntime = {
    complete: (input: ModelRuntimeRequest) => completeWithPi(resolver, input),
    stream: (input: ModelRuntimeRequest) => streamWithPi(resolver, input),
  };
  return Object.freeze(runtime);
}

async function completeWithPi(
  resolver: ModelRuntimeResolver,
  input: ModelRuntimeRequest,
): Promise<ModelRuntimeResult> {
  assertRequest(input);
  const target = await resolveTarget(resolver, input);
  const { models, model } = createPiModels(target);
  const context = toPiContext(input, target);

  let message: AssistantMessage;
  try {
    message = await models.complete(model, context, toPiOptions(input));
  } catch (error) {
    throw mapRuntimeError(error, input.signal);
  }

  if (message.stopReason === 'aborted') {
    throw new ModelRuntimeError('MODEL_REQUEST_ABORTED', '模型调用已被调用方取消');
  }
  if (message.stopReason === 'error') {
    throw new ModelRuntimeError('MODEL_STREAM_ERROR', '模型调用失败', { retryable: true });
  }

  const text = contentText(message.content).trim();
  if (text.length === 0) {
    throw new ModelRuntimeError('MODEL_EMPTY_RESPONSE', '模型返回了空文本');
  }
  return toResult(target, message, text);
}

async function* streamWithPi(
  resolver: ModelRuntimeResolver,
  input: ModelRuntimeRequest,
): AsyncGenerator<ModelRuntimeEvent> {
  assertRequest(input);
  const target = await resolveTarget(resolver, input);
  const { models, model } = createPiModels(target);
  const stream = models.stream(model, toPiContext(input, target), toPiOptions(input));

  try {
    for await (const event of stream) {
      yield* mapPiEvent(target, event);
    }
  } catch (error) {
    const mapped = mapRuntimeError(error, input.signal);
    yield { type: 'error', code: mapped.code, message: mapped.message, retryable: mapped.retryable };
  }
}

function createPiModels(target: ModelRuntimeTarget): {
  models: ReturnType<typeof createModels>;
  model: Model<Api>;
} {
  // Anthropic uses `x-api-key` (or its OAuth variant) inside the adapter,
  // so `authHeader=false` only disables the OpenAI-compatible Bearer header.
  // It must never turn a missing Anthropic credential into a keyless request.
  const credentialRequired = target.api === 'anthropic-messages' || target.authHeader !== false;
  if (credentialRequired && !target.credential?.trim()) {
    throw new ModelRuntimeError('MODEL_CREDENTIAL_MISSING', '模型凭证不可用');
  }

  const model = toPiModel(target);
  const provider = createProvider({
    id: target.providerId,
    name: target.providerName,
    baseUrl: normalizeBaseUrl(target.baseUrl),
    models: [model],
    auth: {
      apiKey: {
        name: `${target.providerName} runtime credential`,
        resolve: async () => ({
          // The resolver still returns a configured result for keyless
          // gateways; API adapters omit this placeholder when authHeader is
          // false, before constructing the HTTP client.
          auth: { apiKey: target.credential?.trim() || 'unused' },
          source: 'qitu-model-registry',
        }),
      },
    },
    api: apiFor(target.api),
  });

  const models = createModels();
  models.setProvider(provider);
  const resolved = models.getModel(target.providerId, target.modelId);
  if (resolved === undefined) {
    throw new ModelRuntimeError('MODEL_RESPONSE_INVALID', '模型运行时未能解析模型');
  }
  return { models, model: resolved };
}

function toPiModel(target: ModelRuntimeTarget): Model<Api> {
  return {
    id: target.modelId,
    name: target.modelId,
    api: target.api,
    provider: target.providerId,
    baseUrl: normalizeBaseUrl(target.baseUrl),
    reasoning: false,
    input: (target.input ?? ['text']).filter(
      (modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image',
    ),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: positiveInt(target.contextWindow) ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: positiveInt(target.maxTokens) ?? DEFAULT_MAX_TOKENS,
    authHeader: target.authHeader !== false,
  } as Model<Api>;
}

function apiFor(api: QituModelApi): ProviderStreams {
  switch (api) {
    case 'openai-completions':
      return openAICompletionsApi();
    case 'openai-responses':
      return openAIResponsesApi();
    case 'anthropic-messages':
      return anthropicMessagesApi();
  }
}

function toPiContext(input: ModelRuntimeRequest, target: ModelRuntimeTarget): Context {
  return {
    messages: input.messages.map((message) => {
      const timestamp = Date.now();
      if (message.role === 'system') return { role: 'system' as const, content: message.content, timestamp };
      if (message.role === 'user') return { role: 'user' as const, content: message.content, timestamp };
      return {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: message.content }],
        api: target.api,
        provider: target.providerId,
        model: target.modelId,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop' as const,
        timestamp,
      };
    }),
  };
}

function toPiOptions(input: ModelRuntimeRequest): StreamOptions {
  return {
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    sessionId: input.requestId,
  };
}

function mapPiEvent(target: ModelRuntimeTarget, event: AssistantMessageEvent): ModelRuntimeEvent[] {
  switch (event.type) {
    case 'text_delta':
      return [{ type: 'text-delta', text: event.delta }];
    case 'toolcall_end':
      return [{
        type: 'tool-call',
        callId: event.toolCall.id,
        toolName: event.toolCall.name,
        arguments: event.toolCall.arguments as Record<string, unknown>,
      }];
    case 'done': {
      const text = contentText(event.message.content).trim();
      if (text.length === 0 && event.reason === 'stop') {
        return [{ type: 'error', code: 'MODEL_EMPTY_RESPONSE', message: '模型返回了空文本', retryable: false }];
      }
      return [{ type: 'done', result: toResult(target, event.message, text) }];
    }
    case 'error':
      return [{ type: 'error', code: event.reason === 'aborted' ? 'MODEL_REQUEST_ABORTED' : 'MODEL_STREAM_ERROR', message: '模型调用失败', retryable: event.reason !== 'aborted' }];
    default:
      return [];
  }
}

function toResult(target: ModelRuntimeTarget, message: AssistantMessage, text: string): ModelRuntimeResult {
  return {
    providerId: target.providerId,
    modelId: target.modelId,
    api: target.api,
    text,
    finishReason: message.stopReason,
    usage: {
      inputTokens: finiteOrNull(message.usage.input),
      outputTokens: finiteOrNull(message.usage.output),
      totalTokens: finiteOrNull(message.usage.totalTokens),
    },
  };
}

async function resolveTarget(resolver: ModelRuntimeResolver, input: ModelRuntimeRequest): Promise<ModelRuntimeTarget> {
  let target: ModelRuntimeTarget;
  try {
    const providerSpecified = input.providerId !== undefined;
    const modelSpecified = input.modelId !== undefined;
    if (providerSpecified !== modelSpecified) {
      throw new ModelRuntimeError('MODEL_REQUEST_INVALID', '模型供应商和模型必须同时指定');
    }
    if (providerSpecified && (!input.providerId?.trim() || !input.modelId?.trim())) {
      throw new ModelRuntimeError('MODEL_REQUEST_INVALID', '模型供应商和模型不能为空');
    }
    if (providerSpecified && resolver.resolveRuntimeTargetByModel) {
      target = await resolver.resolveRuntimeTargetByModel({ providerId: input.providerId!, modelId: input.modelId! });
    } else if (providerSpecified) {
      throw new ModelRuntimeError('MODEL_NOT_FOUND', '当前运行时不支持 Agent 级模型选择');
    } else {
      target = await resolver.resolveRuntimeTarget(input.usageId);
    }
  } catch (error) {
    if (error instanceof ModelRuntimeError) throw error;
    const code = errorCode(error);
    if (code !== null) {
      throw new ModelRuntimeError(code, '模型用途不可用');
    }
    throw new ModelRuntimeError('MODEL_USAGE_UNKNOWN', '模型用途不可用');
  }
  if (!target || !target.providerId || !target.modelId || !target.baseUrl || !target.api) {
    throw new ModelRuntimeError('MODEL_USAGE_UNKNOWN', '模型用途未解析到可用模型');
  }
  return target;
}

function errorCode(error: unknown): ModelRuntimeErrorCode | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  const supported: readonly ModelRuntimeErrorCode[] = [
    'MODEL_USAGE_UNKNOWN',
    'MODEL_USAGE_NOT_BOUND',
    'MODEL_PROVIDER_NOT_FOUND',
    'MODEL_PROVIDER_DISABLED',
    'MODEL_BASE_URL_MISSING',
    'MODEL_NOT_FOUND',
    'MODEL_DISABLED',
    'MODEL_CREDENTIAL_MISSING',
  ];
  return typeof code === 'string' && supported.includes(code as ModelRuntimeErrorCode)
    ? code as ModelRuntimeErrorCode
    : null;
}
function assertRequest(input: ModelRuntimeRequest): void {
  if (!input.usageId.trim() || input.messages.length === 0) {
    throw new ModelRuntimeError('MODEL_REQUEST_INVALID', '模型请求无效');
  }
  if (input.messages.some((message) => !message.content || !['system', 'user', 'assistant'].includes(message.role))) {
    throw new ModelRuntimeError('MODEL_REQUEST_INVALID', '模型消息无效');
  }
}

function mapRuntimeError(error: unknown, signal?: AbortSignal): ModelRuntimeError {
  if (error instanceof ModelRuntimeError) return error;
  if (signal?.aborted) return new ModelRuntimeError('MODEL_REQUEST_ABORTED', '模型调用已被调用方取消');
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ModelRuntimeError('MODEL_REQUEST_TIMEOUT', '模型调用超时', { retryable: true });
  }
  return new ModelRuntimeError('MODEL_TRANSPORT_ERROR', '无法连接模型网关', { retryable: true });
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    // Credentials and URL query/fragment values are a second credential
    // channel. The registry must provide a clean origin/path instead of
    // letting them reach fetch or appear in diagnostics.
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('credential-bearing URL');
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('/v1')) url.pathname = `${pathname}/v1`;
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new ModelRuntimeError('MODEL_REQUEST_INVALID', '模型网关地址无效');
  }
}

function positiveInt(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isInteger(value) && value > 0 ? value : null;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function isModelRuntimeError(error: unknown): error is ModelRuntimeError {
  return error instanceof ModelRuntimeError;
}
