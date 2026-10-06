import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createQwenVoiceGateway,
  probeQwenVoiceModel,
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

test('qwen voice gateway sends server-side credentials and normalises ASR', async () => {
  let seenUrl = '';
  let seenAuth = '';
  const gateway = createQwenVoiceGateway({
    target,
    fetchImpl: async (url, init) => {
      seenUrl = String(url);
      seenAuth = String(new Headers(init?.headers).get('authorization'));
      return new Response(JSON.stringify({ text: '你好，项目' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const result = await gateway.transcribe({
    requestId: 'r1',
    idempotencyKey: 'i1',
    model: { providerId: target.providerId, modelId: target.modelId },
    audio: {
      codec: 'webm',
      mimeType: 'audio/webm',
      sampleRateHz: null,
      channels: null,
      durationMs: 500,
      dataBase64: 'AA==',
    },
    language: 'zh-CN',
  });
  assert.equal(result.transcript, '你好，项目');
  assert.equal(seenUrl, 'https://qwen.example/v1/audio/transcriptions');
  assert.equal(seenAuth, 'Bearer server-secret');
});

test('qwen voice gateway returns binary TTS as a final audio chunk', async () => {
  const gateway = createQwenVoiceGateway({
    target,
    fetchImpl: async () => new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    }),
  });
  const events = [];
  for await (const event of gateway.synthesize({
    requestId: 'r2',
    idempotencyKey: 'i2',
    model: { providerId: target.providerId, modelId: target.modelId },
    text: '你好',
    language: 'zh-CN',
    voice: null,
    format: 'wav',
  })) events.push(event);
  assert.equal(events[0]?.type, 'audio');
  assert.equal(events[0]?.type === 'audio' ? events[0].chunk.dataBase64 : '', 'AAEC');
  assert.equal(events.at(-1)?.type, 'done');
});

test('qwen voice probe requires the explicit model to be in the upstream catalog', async () => {
  const ok = await probeQwenVoiceModel(target, async () => new Response(JSON.stringify({ data: [{ id: target.modelId }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  assert.deepEqual(ok, { ok: true, reason: 'ok' });
  const missing = await probeQwenVoiceModel(target, async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  assert.deepEqual(missing, { ok: false, reason: 'model_not_found' });
});
