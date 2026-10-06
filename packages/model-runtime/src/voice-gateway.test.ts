import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceGateway, type VoiceGatewayProvider } from './voice-gateway.js';

test('voice gateway validates requests before provider dispatch', async () => {
  const provider: VoiceGatewayProvider = {
    async capabilities() {
      return { generatedAt: new Date(0).toISOString(), defaultModel: null, models: [] };
    },
    async transcribe(input) {
      return {
        requestId: input.requestId,
        transcript: 'hello',
        language: null,
        durationMs: null,
        model: input.model,
      };
    },
    async *synthesize(input) {
      yield { type: 'done' as const, requestId: input.requestId, model: input.model };
    },
  };
  const gateway = createVoiceGateway(provider);
  const result = await gateway.transcribe({
    requestId: 'r1',
    idempotencyKey: 'i1',
    model: { providerId: 'qwen', modelId: 'asr' },
    audio: {
      codec: 'wav',
      mimeType: 'audio/wav',
      sampleRateHz: 16_000,
      channels: 1,
      durationMs: 100,
      dataBase64: 'AA==',
    },
    language: 'zh-CN',
  });
  assert.equal(result.transcript, 'hello');
  await assert.rejects(
    () =>
      gateway.transcribe({
        requestId: '',
        idempotencyKey: 'i2',
        model: { providerId: 'qwen', modelId: 'asr' },
        audio: {
          codec: 'wav',
          mimeType: 'audio/wav',
          sampleRateHz: null,
          channels: null,
          durationMs: null,
          dataBase64: 'AA==',
        },
        language: null,
      }),
    /VOICE_REQUEST_INVALID/,
  );
  await assert.rejects(
    () =>
      gateway.transcribe({
        requestId: 'r2',
        idempotencyKey: 'i2',
        model: { providerId: 'qwen', modelId: 'asr' },
        audio: {
          codec: 'wav',
          mimeType: 'audio/wav',
          sampleRateHz: null,
          channels: null,
          durationMs: null,
          dataBase64: 'not-base64',
        },
        language: null,
      }),
    /VOICE_AUDIO_INVALID/,
  );
});
