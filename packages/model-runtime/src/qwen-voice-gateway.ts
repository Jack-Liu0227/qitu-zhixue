import type {
  VoiceAudioInput,
  VoiceGateway,
  VoiceGatewayCapabilities,
  VoiceGatewayOperation,
  VoiceModelDescriptor,
  VoiceModelSelection,
  VoiceSynthesisEvent,
  VoiceSynthesisRequest,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
} from '@qitu/contracts';
import { createVoiceGateway, type VoiceGatewayProvider } from './voice-gateway.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface QwenVoiceTarget extends VoiceModelSelection {
  providerName: string;
  baseUrl: string;
  credential: string;
  authHeader: boolean;
  operations: readonly VoiceGatewayOperation[];
  languages?: readonly string[];
  codecs?: readonly string[];
  keyFingerprint?: string | null;
}

export interface QwenVoiceProviderOptions {
  target: QwenVoiceTarget;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface QwenVoiceProbeResult {
  ok: boolean;
  reason: 'ok' | 'provider_unreachable' | 'model_not_found' | 'invalid_response';
}

export class QwenVoiceGatewayError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly upstreamStatus: number | null;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; upstreamStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'QwenVoiceGatewayError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

/**
 * Qwen subscriptions commonly expose an OpenAI-compatible gateway. The adapter
 * deliberately uses only the standard audio endpoints and never guesses voice
 * support from a model name.
 */
export function createQwenVoiceProvider(options: QwenVoiceProviderOptions): VoiceGatewayProvider {
  const target = options.target;
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async capabilities(): Promise<VoiceGatewayCapabilities> {
      const descriptor: VoiceModelDescriptor = {
        providerId: target.providerId,
        modelId: target.modelId,
        label: `${target.providerName} · ${target.modelId}`,
        operations: [...target.operations],
        languages: [...(target.languages ?? [])],
        codecs: [...(target.codecs ?? [])],
        available: target.credential.trim().length > 0,
        credential: {
          configured: target.credential.trim().length > 0,
          keyFingerprint: target.keyFingerprint ?? null,
        },
      };
      return {
        generatedAt: new Date().toISOString(),
        defaultModel: descriptor.available ? { providerId: target.providerId, modelId: target.modelId } : null,
        models: [descriptor],
      };
    },

    async transcribe(input: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult> {
      requireOperation(target, 'transcribe');
      const form = new FormData();
      form.append('model', target.modelId);
      if (input.language) form.append('language', input.language);
      form.append('file', audioBlob(input.audio), fileNameFor(input.audio));

      const response = await request(fetcher, endpoint(target.baseUrl, '/audio/transcriptions'), {
        method: 'POST',
        headers: authHeaders(target),
        body: form,
        timeoutMs,
      });
      const payload = await readJson(response);
      const transcript = firstString(payload, ['text', 'transcript', 'output.text', 'output.transcript']);
      if (!transcript) {
        throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音识别返回内容无效');
      }
      const duration = firstNumber(payload, ['duration', 'duration_ms', 'output.duration_ms']);
      return {
        requestId: input.requestId,
        transcript: transcript.trim(),
        language: input.language,
        durationMs: duration === null ? input.audio.durationMs : duration > 10_000 ? duration : duration * 1000,
        model: input.model,
      };
    },

    async *synthesize(input: VoiceSynthesisRequest): AsyncGenerator<VoiceSynthesisEvent> {
      requireOperation(target, 'synthesize');
      const response = await request(fetcher, endpoint(target.baseUrl, '/audio/speech'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(target) },
        body: JSON.stringify({
          model: target.modelId,
          input: input.text,
          ...(input.voice ? { voice: input.voice } : {}),
          response_format: input.format,
        }),
        timeoutMs,
      });
      const contentType = response.headers.get('content-type') ?? '';
      const dataBase64 = contentType.toLowerCase().includes('json')
        ? readAudioBase64(await readJson(response))
        : Buffer.from(await readBytes(response)).toString('base64');
      if (!dataBase64) {
        throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音合成返回内容无效');
      }
      yield {
        type: 'audio',
        chunk: {
          requestId: input.requestId,
          sequence: 0,
          dataBase64,
          codec: input.format,
          isFinal: true,
        },
      };
      yield { type: 'done', requestId: input.requestId, model: input.model };
    },
  };
}

export function createQwenVoiceGateway(options: QwenVoiceProviderOptions): VoiceGateway {
  return createVoiceGateway(createQwenVoiceProvider(options));
}

/** Derive operations only from explicit, persisted audio modalities. */
export function operationsFromModalities(
  input: readonly string[],
  output: readonly string[],
): VoiceGatewayOperation[] {
  const operations: VoiceGatewayOperation[] = [];
  if (input.includes('audio')) operations.push('transcribe');
  if (output.includes('audio')) operations.push('synthesize');
  return operations;
}

/** Confirm that the provider is reachable and, when it returns a catalog, that the model exists. */
export async function probeQwenVoiceModel(
  target: QwenVoiceTarget,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<QwenVoiceProbeResult> {
  try {
    const response = await request(fetchImpl, endpoint(target.baseUrl, '/models'), {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(target) },
      timeoutMs,
    });
    const payload = await readJson(response);
    const ids = modelIds(payload);
    if (ids.length === 0) return { ok: false, reason: 'invalid_response' };
    return ids.includes(target.modelId)
      ? { ok: true, reason: 'ok' }
      : { ok: false, reason: 'model_not_found' };
  } catch (error) {
    if (error instanceof QwenVoiceGatewayError && error.upstreamStatus === 404) {
      return { ok: false, reason: 'model_not_found' };
    }
    return { ok: false, reason: 'provider_unreachable' };
  }
}

function requireOperation(target: QwenVoiceTarget, operation: VoiceGatewayOperation): void {
  if (!target.operations.includes(operation)) {
    throw new QwenVoiceGatewayError('VOICE_OPERATION_UNAVAILABLE', `当前语音模型不支持 ${operation}`);
  }
  if (!target.credential.trim()) {
    throw new QwenVoiceGatewayError('VOICE_CREDENTIAL_MISSING', '语音模型凭证不可用');
  }
}

function endpoint(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  const versioned = /\/v\d+$/u.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${versioned}${path}`;
}

function authHeaders(target: QwenVoiceTarget): Record<string, string> {
  return target.authHeader && target.credential.trim().length > 0
    ? { authorization: `Bearer ${target.credential}` }
    : {};
}

function audioBlob(audio: VoiceAudioInput): Blob {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(audio.dataBase64, 'base64');
  } catch {
    throw new QwenVoiceGatewayError('VOICE_AUDIO_INVALID', '语音数据无效');
  }
  if (bytes.length === 0) throw new QwenVoiceGatewayError('VOICE_AUDIO_INVALID', '语音数据为空');
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: audio.mimeType });
}

function fileNameFor(audio: VoiceAudioInput): string {
  const codec = audio.codec.replace(/[^a-z0-9]+/giu, '').toLowerCase() || 'webm';
  return `voice.${codec}`;
}

async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const { timeoutMs, ...requestInit } = init;
  let response: Response;
  try {
    response = await fetcher(url, { ...requestInit, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务暂时不可用', { retryable: true });
  }
  if (!response.ok) {
    throw new QwenVoiceGatewayError(
      response.status === 401 || response.status === 403 ? 'VOICE_CREDENTIAL_REJECTED' : 'VOICE_UPSTREAM_HTTP_ERROR',
      '语音服务请求失败',
      { retryable: response.status >= 500, upstreamStatus: response.status },
    );
  }
  return response;
}

async function readBytes(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new QwenVoiceGatewayError('VOICE_RESPONSE_TOO_LARGE', '语音服务返回内容过大');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new QwenVoiceGatewayError('VOICE_RESPONSE_TOO_LARGE', '语音服务返回内容过大');
  }
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  const text = new TextDecoder().decode(await readBytes(response));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音服务返回内容无效');
  }
}

function readAudioBase64(value: unknown): string {
  const direct = firstString(value, ['audio', 'data', 'audio_base64', 'output.audio', 'output.data']);
  if (!direct) return '';
  return direct.replace(/^data:[^;]+;base64,/iu, '').trim();
}

function firstString(value: unknown, paths: readonly string[]): string | null {
  for (const path of paths) {
    const candidate = path.split('.').reduce<unknown>((current, key) => {
      return current !== null && typeof current === 'object' && key in current
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, value);
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return null;
}

function firstNumber(value: unknown, paths: readonly string[]): number | null {
  for (const path of paths) {
    const candidate = path.split('.').reduce<unknown>((current, key) => {
      return current !== null && typeof current === 'object' && key in current
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, value);
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return null;
}

function modelIds(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return list.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      return [(entry as { id: string }).id];
    }
    return [];
  });
}
