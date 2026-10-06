import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createQwenVoiceGateway,
  probeQwenVoiceModel,
  type QwenWebSocketConstructor,
  type QwenVoiceTarget,
} from './qwen-voice-gateway.js';

const target: QwenVoiceTarget = {
  providerId: 'qwen-token-plan-cn',
  providerName: 'Qwen',
  modelId: 'qwen-audio-test',
  baseUrl: 'https://qwen.example/v1',
  credential: 'server-secret',
  authHeader: true,
  operations: ['transcribe', 'synthesize'],
};

class FakeRealtimeSocket {
  static lastUrl = '';
  static lastAuthorization = '';
  static lastSession: Record<string, unknown> | null = null;
  static emitInputTranscript = true;
  readonly readyState = 1;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    FakeRealtimeSocket.lastUrl = url;
    FakeRealtimeSocket.lastAuthorization = options?.headers?.authorization ?? '';
    setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'session.created' }) }), 0);
  }

  addEventListener(type: 'open' | 'error' | 'close', listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'message', listener: (event: { data?: unknown }) => void): void;
  addEventListener(type: 'open' | 'error' | 'close' | 'message', listener: (event: { data?: unknown; code?: number; reason?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    const event = JSON.parse(data) as { type: string; session?: Record<string, unknown> };
    if (event.type === 'session.update') {
      FakeRealtimeSocket.lastSession = event.session ?? null;
      setTimeout(() => this.emit('message', { data: JSON.stringify({ type: 'session.updated' }) }), 0);
    } else if (event.type === 'input_audio_buffer.commit') {
      setTimeout(() => {
        this.emit('message', { data: JSON.stringify({ type: 'input_audio_buffer.committed' }) });
        if (FakeRealtimeSocket.emitInputTranscript) {
          this.emit('message', { data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '你好' }) });
        }
      }, 0);
    } else if (event.type === 'response.create' && !FakeRealtimeSocket.emitInputTranscript) {
      setTimeout(() => {
        this.emit('message', { data: JSON.stringify({ type: 'response.text.delta', delta: '你好' }) });
        this.emit('message', { data: JSON.stringify({ type: 'response.text.done', text: '你好' }) });
        this.emit('message', { data: JSON.stringify({ type: 'response.done' }) });
      }, 0);
    } else if (event.type === 'response.create') {
      setTimeout(() => {
        this.emit('message', { data: JSON.stringify({ type: 'response.audio.delta', delta: 'AAEC' }) });
        this.emit('message', { data: JSON.stringify({ type: 'response.audio_transcript.delta', delta: '你好' }) });
        this.emit('message', { data: JSON.stringify({ type: 'response.done' }) });
      }, 0);
    }
  }

  close(): void {}

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const fakeWebSocket = FakeRealtimeSocket as unknown as QwenWebSocketConstructor;

test('qwen voice gateway sends server-side credentials and normalises ASR', async () => {
  FakeRealtimeSocket.emitInputTranscript = true;
  const gateway = createQwenVoiceGateway({
    target,
    webSocketImpl: fakeWebSocket,
  });
  const result = await gateway.transcribe({
    requestId: 'r1',
    idempotencyKey: 'i1',
    model: { providerId: target.providerId, modelId: target.modelId },
    audio: {
      codec: 'pcm_s16le',
      mimeType: 'audio/pcm',
      sampleRateHz: 16_000,
      channels: 1,
      durationMs: 500,
      dataBase64: 'AA==',
    },
    language: 'zh-CN',
  });
  assert.equal(result.transcript, '你好');
  assert.equal(result.durationMs, 500);
  assert.equal(FakeRealtimeSocket.lastUrl, 'wss://qwen.example/api-ws/v1/realtime?model=qwen-audio-test');
  assert.equal(FakeRealtimeSocket.lastAuthorization, 'Bearer server-secret');
});

test('qwen audio realtime rejects assistant response text as an ASR transcript', async () => {
  FakeRealtimeSocket.emitInputTranscript = false;
  const gateway = createQwenVoiceGateway({ target, webSocketImpl: fakeWebSocket });
  try {
    await assert.rejects(
      gateway.transcribe({
        requestId: 'r1-fallback',
        idempotencyKey: 'i1-fallback',
        model: { providerId: target.providerId, modelId: target.modelId },
        audio: {
          codec: 'pcm_s16le',
          mimeType: 'audio/pcm',
          sampleRateHz: 16_000,
          channels: 1,
          durationMs: 500,
          dataBase64: 'AA==',
        },
        language: 'zh-CN',
      },
      (error: unknown) => error instanceof Error
        && 'code' in error
        && error.code === 'VOICE_TRANSCRIPTION_UNAVAILABLE',
    );
    assert.deepEqual(FakeRealtimeSocket.lastSession, {
      modalities: ['text', 'audio'],
      turn_detection: null,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      voice: 'longanqian',
      input_audio_transcription: { model: 'fun-asr', language: 'zh' },
    });
  } finally {
    FakeRealtimeSocket.emitInputTranscript = true;
  }
});

test('qwen voice gateway returns binary TTS as a final audio chunk', async () => {
  const gateway = createQwenVoiceGateway({
    target,
    webSocketImpl: fakeWebSocket,
  });
  const events = [];
  for await (const event of gateway.synthesize({
    requestId: 'r2',
    idempotencyKey: 'i2',
    model: { providerId: target.providerId, modelId: target.modelId },
    text: '你好',
    language: 'zh-CN',
    voice: null,
    format: 'pcm_s16le',
  })) events.push(event);
  assert.equal(events[0]?.type, 'audio');
  assert.equal(events[0]?.type === 'audio' ? events[0].chunk.dataBase64 : '', 'AAEC');
  assert.equal(events.at(-1)?.type, 'done');
});

test('qwen voice probe requires the explicit model to be in the upstream catalog', async () => {
  const ok = await probeQwenVoiceModel(target, async () => new Response(JSON.stringify({ data: [{ id: target.modelId }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }), 1_000, fakeWebSocket);
  assert.deepEqual(ok, { ok: true, reason: 'ok' });
  const missing = await probeQwenVoiceModel(target, async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }), 1_000, fakeWebSocket);
  assert.deepEqual(missing, { ok: false, reason: 'model_not_found' });
});
