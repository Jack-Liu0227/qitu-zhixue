import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredChatModels, configuredModelKey, configuredModelLabel, configuredModelPatch } from '../apps/admin-console/lib/api/modelSelection.ts';

test('provider/model identity survives collisions and delimiter characters', () => {
  const catalog = [
    { providerId: 'provider:a', id: 'model:b', name: 'A' },
    { providerId: 'provider:b', id: 'model:b', name: 'B' },
  ];
  assert.deepEqual(configuredModelPatch(configuredModelKey(catalog[1]), catalog), { modelProviderId: 'provider:b', modelId: 'model:b' });
  assert.notEqual(configuredModelKey(catalog[0]), configuredModelKey(catalog[1]));
  assert.throws(() => configuredModelPatch('model:b', catalog));
  assert.throws(() => configuredModelPatch(configuredModelKey(catalog[0]), []));
  assert.deepEqual(configuredModelPatch('', catalog), { modelProviderId: null, modelId: null });
});

test('only current enabled credentialed text catalog entries are selectable', () => {
  const provider = { id: 'p', name: 'P', enabled: true, baseUrl: 'https://fixture.invalid/v1', api: 'openai-completions', authHeader: true,
    auth: { configured: true }, models: [{ id: 'chat', name: 'Chat', input: ['text'], output: ['text'] }, { id: 'embed', input: ['text'], output: ['embedding'] }] };
  assert.equal(configuredChatModels([provider]).length, 1);
  assert.equal(configuredChatModels([{ ...provider, enabled: false }]).length, 0);
  assert.equal(configuredChatModels([{ ...provider, auth: { configured: false } }]).length, 0);
  assert.equal(configuredChatModels([{ ...provider, authHeader: false, auth: { configured: false } }]).length, 1);
  assert.equal(configuredChatModels([{ ...provider, api: 'anthropic-messages', authHeader: false, auth: { configured: false } }]).length, 0);
});

test('model cards display provider/model labels without exposing the internal tuple', () => {
  const model = { providerId: 'provider:a', providerName: 'Provider A', id: 'model:b', name: 'Model B' };
  const key = configuredModelKey(model);
  assert.equal(configuredModelLabel(key, [model]), 'Provider A / Model B');
  assert.equal(configuredModelLabel(key, [{ ...model, name: 'Model B (Provider A)' }]), 'Provider A / Model B');
  assert.equal(configuredModelLabel(key, []), 'provider:a / model:b（当前绑定不可用）');
  assert.equal(configuredModelLabel(configuredModelKey({ providerId: '', id: 'model:b' }), []), '未指定供应商 / model:b（当前绑定不可用）');
  assert.equal(configuredModelLabel('', []), '未指定（跟随平台默认）');
  for (const invalid of ['bare-id', '{"provider":"a"}', '["p",3]', '["p","m","extra"]']) {
    assert.equal(configuredModelLabel(invalid, []), '当前绑定不可用');
    assert.throws(() => configuredModelPatch(invalid, [model]));
  }
});
