import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readPiImportManifest, sanitisePiImportBaseUrl } from './pi-import';

async function withPiConfig(
  files: Record<string, unknown>,
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'qitu-pi-import-'));
  try {
    for (const [name, value] of Object.entries(files)) {
      await writeFile(join(directory, name), JSON.stringify(value), 'utf8');
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('readPiImportManifest imports canonical api_key credentials', async () => {
  await withPiConfig(
    {
      'models.json': {
        providers: {
          qwen: {
            name: 'Qwen',
            baseUrl: 'https://dashscope.example/v1',
            api: 'openai-completions',
            models: [{ id: 'qwen-plus', name: 'Qwen Plus' }],
          },
        },
      },
      'models-store.json': {},
      'auth.json': {
        qwen: { type: 'api_key', key: 'sk-qwen-test' },
      },
    },
    async (directory) => {
      const manifest = await readPiImportManifest(directory);
      assert.equal(manifest.providers[0]?.apiKey, 'sk-qwen-test');
      assert.equal(manifest.providers[0]?.id, 'qwen');
      assert.equal(manifest.providers[0]?.models[0]?.modelId, 'qwen-plus');
    },
  );
});

test('readPiImportManifest excludes OAuth access and refresh tokens', async () => {
  await withPiConfig(
    {
      'models.json': {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.example/v1',
            models: [{ id: 'gpt-test' }],
          },
        },
      },
      'models-store.json': {},
      'auth.json': {
        openai: {
          type: 'oauth',
          access: 'access-secret',
          refresh: 'refresh-secret',
          expires: 123,
        },
      },
    },
    async (directory) => {
      const manifest = await readPiImportManifest(directory);
      const provider = manifest.providers[0];
      assert.equal(provider?.apiKey, undefined);
      assert.equal(JSON.stringify(manifest).includes('access-secret'), false);
      assert.equal(JSON.stringify(manifest).includes('refresh-secret'), false);
    },
  );
});

test('readPiImportManifest accepts legacy key auth and ignores a missing optional catalog', async () => {
  await withPiConfig(
    {
      'models.json': {
        providers: {
          legacy: {
            baseUrl: 'https://legacy.example',
            models: [{ id: 'legacy-model' }],
          },
        },
      },
      'auth.json': {
        legacy: { type: 'key', key: 'legacy-key' },
      },
    },
    async (directory) => {
      const manifest = await readPiImportManifest(directory);
      assert.equal(manifest.providers[0]?.apiKey, 'legacy-key');
      assert.equal(JSON.stringify(manifest).includes('auth.json'), false);
    },
  );
});

test('sanitisePiImportBaseUrl removes URL credential material', () => {
  assert.equal(
    sanitisePiImportBaseUrl('https://user:password@gateway.example//v1/?token=secret#fragment'),
    'https://gateway.example/v1',
  );
  assert.equal(sanitisePiImportBaseUrl('file:///tmp/provider'), null);
});

test('readPiImportManifest rejects an empty copied catalog', async () => {
  await withPiConfig(
    {
      'models.json': { providers: {} },
      'models-store.json': {},
      'auth.json': {},
    },
    async (directory) => {
      await assert.rejects(() => readPiImportManifest(directory), /PI_CONFIG_EMPTY/);
    },
  );
});
