import { Compile } from 'typebox/compile';
import { anthropicMessagesApi } from './pi/api/anthropic-messages.lazy.js';
import { googleGeminiApi } from './gemini-native.lazy.js';
import { openAICompletionsApi } from './pi/api/openai-completions.lazy.js';
import { openAIResponsesApi } from './pi/api/openai-responses.lazy.js';
import { contentText } from './pi/utils/text.js';
import { createModels, createProvider } from './pi/models.js';
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  ProviderStreams,
  StreamOptions,
  Tool,
} from './pi/types.js';

export type QituModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-gemini';

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
  input?: readonly ('text' | 'image' | 'audio' | 'embedding')[];
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
  /** Server-authorized tools only. Execution closures never cross the model boundary. */
  tools?: readonly ModelRuntimeTool[];
  onToolEvent?: (event: ModelRuntimeToolEvent) => void;
}

export interface ModelRuntimeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError?: boolean }>;
}

export type ModelRuntimeToolEvent =
  | { type: 'call'; callId: string; name: string }
  | { type: 'result'; callId: string; name: string; isError: boolean };

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

async function completeWithPi(resolver: ModelRuntimeResolver, input: ModelRuntimeRequest): Promise<ModelRuntimeResult> {
  for await (const event of runWithPi(resolver, input)) {
    if (event.type === 'done') return event.result;
  }
  throw new ModelRuntimeError('MODEL_EMPTY_RESPONSE', 'Model returned no final response');
}

async function* streamWithPi(resolver: ModelRuntimeResolver, input: ModelRuntimeRequest): AsyncGenerator<ModelRuntimeEvent> {
  try { yield* runWithPi(resolver, input); }
  catch (error) {
    const mapped = mapRuntimeError(error);
    yield { type: 'error', code: mapped.code, message: mapped.message, retryable: mapped.retryable };
  }
}

/** One bounded execution loop for complete and stream, with native tool receipts. */
async function* runWithPi(resolver: ModelRuntimeResolver, input: ModelRuntimeRequest): AsyncGenerator<ModelRuntimeEvent> {
  assertRequest(input);
  const target = await resolveTarget(resolver, input);
  const { models, model } = createPiModels(target);
  const context = toPiContext(input, target);
  const transport = requestTransport(input);
  const { signal } = transport;
  const tools = new Map<string, { tool: ModelRuntimeTool; check: ReturnType<typeof Compile> }>();
  for (const tool of input.tools ?? []) {
    if (!tool.name || tools.has(tool.name)) throw new ModelRuntimeError('MODEL_REQUEST_INVALID', 'Duplicate or empty tool ID');
    try { tools.set(tool.name, { tool, check: Compile(tool.inputSchema) }); }
    catch { throw new ModelRuntimeError('MODEL_REQUEST_INVALID', 'Invalid tool schema'); }
  }
  context.tools = [...tools.values()].map(({ tool }) => ({
    name: tool.name, description: tool.description, parameters: tool.inputSchema as Tool['parameters'],
  }));
  const receipts = new Map<string, { fingerprint: string; output: { text: string; isError?: boolean } }>();
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let toolCount = 0;
  for (;;) {
    let message: AssistantMessage | undefined;
    try {
      for await (const event of models.stream(model, context, transport.options)) {
        if (signal.aborted || transport.error() || event.type === 'error') throw transport.failure();
        if (event.type === 'text_delta') yield { type: 'text-delta', text: event.delta };
        if (event.type === 'done') message = event.message;
      }
    } catch (error) { throw transport.failure(error); }
    if (signal.aborted || transport.error()) throw transport.failure();
    if (!message) throw new ModelRuntimeError('MODEL_EMPTY_RESPONSE', 'Model returned no final response');
    usage.inputTokens += finiteOrNull(message.usage.input) ?? 0;
    usage.outputTokens += finiteOrNull(message.usage.output) ?? 0;
    usage.totalTokens += finiteOrNull(message.usage.totalTokens) ?? 0;
    const calls = message.content.filter(part => part.type === 'toolCall');
    if (!calls.length) {
      const text = contentText(message.content).trim();
      if (!text) throw new ModelRuntimeError('MODEL_EMPTY_RESPONSE', 'Model returned empty text');
      yield { type: 'done', result: { ...toResult(target, message, text), usage } };
      return;
    }
    context.messages.push(message);
    for (const call of calls) {
      if (signal.aborted) throw transport.failure();
      if (++toolCount > 8) throw new ModelRuntimeError('MODEL_REQUEST_INVALID', 'Tool call budget exceeded');
      const configured = tools.get(call.name);
      const fingerprint = JSON.stringify([call.name, call.arguments]);
      let output: { text: string; isError?: boolean } = { text: 'TOOL_NOT_ALLOWED', isError: true };
      input.onToolEvent?.({ type: 'call', callId: call.id, name: call.name });
      yield { type: 'tool-call', callId: call.id, toolName: call.name, arguments: call.arguments as Record<string, unknown> };
      const previous = receipts.get(call.id);
      if (previous) output = previous.fingerprint === fingerprint ? previous.output : { text: 'TOOL_CALL_ID_CONFLICT', isError: true };
      else if (configured) {
        const args = call.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args) || fingerprint.length > 64_000 || !configured.check.Check(args)) {
          output = { text: 'TOOL_ARGUMENT_INVALID', isError: true };
        } else {
          try {
            output = await withAbort(configured.tool.execute(args as Record<string, unknown>, signal), signal);
            if (!output || typeof output.text !== 'string') output = { text: 'TOOL_RESPONSE_INVALID', isError: true };
          } catch {
            output = { text: signal.aborted ? 'TOOL_ABORTED' : 'TOOL_UNAVAILABLE', isError: true };
          }
        }
      }
      receipts.set(call.id, { fingerprint, output });
      input.onToolEvent?.({ type: 'result', callId: call.id, name: call.name, isError: output.isError === true });
      if (signal.aborted) throw transport.failure();
      context.messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: output.text.slice(0, 48_000) }], isError: output.isError === true, timestamp: Date.now() });
    }
  }
}

function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('TOOL_ABORTED'));
    if (signal.aborted) { work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function createPiModels(target: ModelRuntimeTarget): {
  models: ReturnType<typeof createModels>;
  model: Model<Api>;
} {
  // Anthropic uses `x-api-key` (or its OAuth variant) inside the adapter,
  // so `authHeader=false` only disables the OpenAI-compatible Bearer header.
  // It must never turn a missing Anthropic credential into a keyless request.
  const credentialRequired = target.api === 'anthropic-messages' || target.api === 'google-gemini' || target.authHeader !== false;
  if (credentialRequired && !target.credential?.trim()) {
    throw new ModelRuntimeError('MODEL_CREDENTIAL_MISSING', '模型凭证不可用');
  }

  const model = toPiModel(target);
  const provider = createProvider({
    id: target.providerId,
    name: target.providerName,
    baseUrl: normalizeBaseUrl(target.baseUrl, target.api),
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
    baseUrl: normalizeBaseUrl(target.baseUrl, target.api),
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
    case 'google-gemini':
      return googleGeminiApi();
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

function requestTransport(input: ModelRuntimeRequest) {
  const timeoutMs = input.timeoutMs !== undefined && Number.isFinite(input.timeoutMs)
    ? Math.min(Math.max(Math.trunc(input.timeoutMs), 1), 120_000) : 90_000;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(input.signal ? [input.signal] : [])]);
  let transportError: ModelRuntimeError | undefined;
  const failure = (cause?: unknown): ModelRuntimeError => {
    if (input.signal?.aborted) return new ModelRuntimeError('MODEL_REQUEST_ABORTED', '模型调用已被调用方取消');
    if (signal.aborted) return new ModelRuntimeError('MODEL_REQUEST_TIMEOUT', '模型调用超时', { retryable: true });
    return transportError ?? (cause ? mapRuntimeError(cause) : new ModelRuntimeError('MODEL_STREAM_ERROR', '模型调用失败', { retryable: true }));
  };
  const options: StreamOptions = {
    ...toPiOptions(input), signal, timeoutMs, maxRetries: 0,
    // SDK adapters encode failures in assistant events. Preserve only safe
    // transport metadata before that conversion; never inspect provider bodies.
    fetch: async (resource, init) => {
      try {
        const response = await globalThis.fetch(resource, init);
        if (!response.ok) {
          transportError = new ModelRuntimeError('MODEL_UPSTREAM_HTTP_ERROR', '模型网关返回错误状态', {
            upstreamStatus: response.status,
            retryable: response.status === 429 || response.status >= 500,
          });
        } else if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
          transportError = new ModelRuntimeError('MODEL_RESPONSE_INVALID', '模型网关未返回原生事件流');
        }
        if (transportError) {
          await response.body?.cancel();
          throw transportError;
        }
        return response;
      } catch (error) {
        transportError ??= mapRuntimeError(error);
        throw failure(error);
      }
    },
  };
  return { options, signal, failure, error: () => transportError };
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

function normalizeBaseUrl(value: string, api: QituModelApi): string {
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
    // Anthropic adds /v1/messages itself; OpenAI adds only the resource.
    // Keep gateway prefixes without producing /v1/v1/messages.
    if (api === 'anthropic-messages') url.pathname = pathname.replace(/\/v1$/, '');
    else if (api !== 'google-gemini' && !pathname.endsWith('/v1')) url.pathname = `${pathname}/v1`;
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
