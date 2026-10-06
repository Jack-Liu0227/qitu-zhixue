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
  webSocketImpl?: QwenWebSocketConstructor;
}

export interface QwenWebSocketLike {
  readonly readyState: number;
  addEventListener(type: 'open' | 'error' | 'close', listener: (event: QwenWebSocketEvent) => void): void;
  addEventListener(type: 'message', listener: (event: QwenWebSocketMessageEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export interface QwenWebSocketEvent {
  readonly code?: number;
  readonly reason?: string;
}

export interface QwenWebSocketMessageEvent {
  readonly data: unknown;
}

export type QwenWebSocketConstructor = new (
  url: string,
  options?: { headers?: Record<string, string> },
) => QwenWebSocketLike;

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
  const webSocket = options.webSocketImpl ?? defaultWebSocketConstructor();

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
      const result = await runRealtimeSession(target, webSocket, timeoutMs, {
        kind: 'transcribe',
        audio: input.audio,
        language: input.language,
      });
      return {
        requestId: input.requestId,
        transcript: result.transcript,
        language: input.language,
        durationMs: input.audio.durationMs,
        model: input.model,
      };
    },

    async *synthesize(input: VoiceSynthesisRequest): AsyncGenerator<VoiceSynthesisEvent> {
      requireOperation(target, 'synthesize');
      const result = await runRealtimeSession(target, webSocket, timeoutMs, {
        kind: 'synthesize',
        text: input.text,
        voice: input.voice,
        format: input.format,
      });
      yield {
        type: 'audio',
        chunk: {
          requestId: input.requestId,
          sequence: 0,
          dataBase64: result.audioBase64,
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
  webSocketImpl?: QwenWebSocketConstructor,
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
    if (!ids.includes(target.modelId)) return { ok: false, reason: 'model_not_found' };
    await probeRealtimeSession(target, webSocketImpl ?? defaultWebSocketConstructor(), timeoutMs);
    return { ok: true, reason: 'ok' };
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

type RealtimeRequest =
  | { kind: 'transcribe'; audio: VoiceAudioInput; language: string | null }
  | { kind: 'synthesize'; text: string; voice: string | null; format: string };

type RealtimeResult = { transcript: string; audioBase64: string };

async function runRealtimeSession(
  target: QwenVoiceTarget,
  webSocket: QwenWebSocketConstructor,
  timeoutMs: number,
  request: RealtimeRequest,
): Promise<RealtimeResult> {
  const socket = openRealtimeSocket(target, webSocket);
  const messages = receiveRealtimeMessages(socket, timeoutMs);
  await waitForRealtimeEvent(messages, 'session.created');

  const session = request.kind === 'transcribe'
    ? {
        modalities: ['text'],
        turn_detection: null,
        input_audio_transcription: { model: 'fun-asr', ...(request.language ? { language: request.language } : {}) },
        audio: { input: pcmInputFormat() },
      }
    : {
        modalities: ['text', 'audio'],
        turn_detection: null,
        voice: request.voice || 'longanqian',
        audio: { output: pcmOutputFormat() },
      };
  socket.send(JSON.stringify({ type: 'session.update', session }));
  await waitForRealtimeEvent(messages, 'session.updated');

  if (request.kind === 'transcribe') {
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmAudio(request.audio) }));
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    const transcript = await collectTranscript(messages, socket);
    closeQuietly(socket);
    return { transcript, audioBase64: '' };
  }

  socket.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: request.text }] },
  }));
  socket.send(JSON.stringify({ type: 'response.create' }));
  const audioChunks: string[] = [];
  let transcript = '';
  while (true) {
    const event = await nextRealtimeMessage(messages);
    if (event.type === 'response.audio.delta' && typeof event.delta === 'string') audioChunks.push(event.delta);
    if (event.type === 'response.audio_transcript.delta' && typeof event.delta === 'string') transcript += event.delta;
    if (event.type === 'response.done') break;
    if (event.type === 'error') throw realtimeError(event);
  }
  closeQuietly(socket);
  const pcm = Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk, 'base64')));
  if (pcm.length === 0) throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音合成返回内容无效');
  if (request.format !== 'pcm_s16le' && request.format !== 'wav') {
    throw new QwenVoiceGatewayError('VOICE_FORMAT_UNSUPPORTED', '当前语音服务仅支持 PCM 或 WAV 输出');
  }
  return { transcript, audioBase64: (request.format === 'wav' ? pcmToWav(pcm) : pcm).toString('base64') };
}

async function probeRealtimeSession(
  target: QwenVoiceTarget,
  webSocket: QwenWebSocketConstructor,
  timeoutMs: number,
): Promise<void> {
  const socket = openRealtimeSocket(target, webSocket);
  const messages = receiveRealtimeMessages(socket, timeoutMs);
  await waitForRealtimeEvent(messages, 'session.created');
  closeQuietly(socket);
}

function openRealtimeSocket(target: QwenVoiceTarget, webSocket: QwenWebSocketConstructor): QwenWebSocketLike {
  if (typeof webSocket !== 'function') throw new QwenVoiceGatewayError('VOICE_REALTIME_UNAVAILABLE', '服务器未配置 WebSocket 运行时');
  try {
    return new webSocket(realtimeEndpoint(target.baseUrl, target.modelId), { headers: authHeaders(target) });
  } catch {
    throw new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务暂时不可用', { retryable: true });
  }
}

async function* receiveRealtimeMessages(socket: QwenWebSocketLike, timeoutMs: number): AsyncGenerator<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  let wake: (() => void) | null = null;
  let failure: QwenVoiceGatewayError | null = null;
  let closed = false;
  socket.addEventListener('message', (event) => {
    const value = parseRealtimeMessage(event.data);
    if (value !== null) queue.push(value);
    wake?.();
    wake = null;
  });
  socket.addEventListener('error', () => {
    failure = new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务暂时不可用', { retryable: true });
    wake?.();
    wake = null;
  });
  socket.addEventListener('close', (event) => {
    if (!failure && !closed) failure = new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务连接已关闭', { retryable: true });
    wake?.();
    wake = null;
    void event;
  });
  try {
    while (true) {
      if (failure) throw failure;
      if (queue.length > 0) {
        yield queue.shift() as Record<string, unknown>;
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new QwenVoiceGatewayError('VOICE_TIMEOUT', '语音服务响应超时', { retryable: true })), timeoutMs);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  } finally {
    closed = true;
    closeQuietly(socket);
  }
}

async function waitForRealtimeEvent(
  messages: AsyncGenerator<Record<string, unknown>>,
  type: string,
): Promise<Record<string, unknown>> {
  while (true) {
    const next = await messages.next();
    if (next.done) throw new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务连接已关闭', { retryable: true });
    const event = next.value;
    if (event.type === 'error') throw realtimeError(event);
    if (event.type === type) return event;
  }
}

async function nextRealtimeMessage(messages: AsyncGenerator<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const next = await messages.next();
  if (next.done) throw new QwenVoiceGatewayError('VOICE_TRANSPORT_ERROR', '语音服务连接已关闭', { retryable: true });
  return next.value;
}

async function collectTranscript(messages: AsyncGenerator<Record<string, unknown>>, socket: QwenWebSocketLike): Promise<string> {
  let transcript = '';
  while (true) {
    const event = await nextRealtimeMessage(messages);
    if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') transcript += event.delta;
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const complete = typeof event.transcript === 'string' ? event.transcript : transcript;
      if (!complete.trim()) throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音识别返回内容为空');
      return complete.trim();
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed' || event.type === 'error') throw realtimeError(event);
    if (event.type === 'response.done') break;
  }
  closeQuietly(socket);
  throw new QwenVoiceGatewayError('VOICE_RESPONSE_INVALID', '语音识别返回内容无效');
}

function realtimeError(event: Record<string, unknown>): QwenVoiceGatewayError {
  const error = event.error;
  const message = error !== null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : '语音服务请求失败';
  return new QwenVoiceGatewayError('VOICE_UPSTREAM_ERROR', message);
}

function parseRealtimeMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function defaultWebSocketConstructor(): QwenWebSocketConstructor {
  const constructor = (globalThis as unknown as { WebSocket?: QwenWebSocketConstructor }).WebSocket;
  if (!constructor) throw new QwenVoiceGatewayError('VOICE_REALTIME_UNAVAILABLE', '服务器未配置 WebSocket 运行时');
  return constructor;
}

function realtimeEndpoint(baseUrl: string, modelId: string): string {
  const base = new URL(baseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/api-ws/v1/realtime';
  base.search = '';
  base.searchParams.set('model', modelId);
  return base.toString();
}

function pcmInputFormat() {
  return { format: { type: 'pcm', sample_rate: 16_000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } };
}

function pcmOutputFormat() {
  return { format: { type: 'pcm', sample_rate: 24_000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } };
}

function pcmAudio(audio: VoiceAudioInput): string {
  if (audio.codec !== 'pcm_s16le' || audio.sampleRateHz !== 16_000 || audio.channels !== 1) {
    throw new QwenVoiceGatewayError('VOICE_AUDIO_FORMAT_UNSUPPORTED', '语音识别仅支持 16 kHz 单声道 PCM');
  }
  return audio.dataBase64;
}

function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function closeQuietly(socket: QwenWebSocketLike): void {
  try { socket.close(); } catch { /* ignore close races */ }
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
