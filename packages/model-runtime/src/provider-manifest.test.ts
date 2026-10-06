import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertProviderImportManifestRedacted,
  createProviderImportManifest,
} from './provider-manifest.js';

test('provider import manifest drops credentials and sanitizes URLs', () => {
  const result = createProviderImportManifest([
    {
      id: 'qwen',
      label: 'Qwen',
      api: 'openai-completions',
      authHeader: false,
      baseUrl: 'https://user:password@gateway.example/v1?api_key=should-not-escape',
      auth: {
        kind: 'api_key',
        configured: true,
        apiKey: 'secret-value',
        keyFingerprint: 'ABCDEF123456',
      },
      models: [
        {
          id: 'qwen-plus',
          input: ['text'],
          output: ['text'],
          voice: { operations: ['tts'], languages: ['zh-CN'] },
        },
      ],
    },
  ]);
  const provider = result.manifest.providers[0];
  assert.equal(provider.baseUrl, 'https://gateway.example/v1');
  assert.equal(provider.authHeader, false);
  assert.equal(provider.auth.keyFingerprint, 'abcdef123456');
  assert.equal('apiKey' in provider.auth, false);
  assert.ok(result.droppedFields.some((field) => field.includes('apiKey')));
  assert.doesNotThrow(() => assertProviderImportManifestRedacted(result.manifest));
  assert.equal(JSON.stringify(result.manifest).includes('secret-value'), false);
});

test('provider import manifest fails closed for unsupported APIs', () => {
  const result = createProviderImportManifest([
    { id: 'unknown', api: 'grpc', models: [{ id: 'model', api: 'grpc' }] },
  ]);
  assert.equal(result.manifest.providers.length, 0);
  assert.ok(result.manifest.warnings.some((warning) => warning.includes('unsupported API')));
});
