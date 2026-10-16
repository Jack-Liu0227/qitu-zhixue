import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { FeishuService, parseFeishuPatch } from './feishu.service';

test('feishu patch accepts allowlisted fields and rejects credential leakage fields', () => {
  assert.deepEqual(parseFeishuPatch({ enabled: true, domain: 'lark', reportRecipients: ['ou_admin'] }), {
    enabled: true, domain: 'lark', reportRecipients: ['ou_admin'],
  });
  for (const invalid of [
    null, [], {}, { appSecret: 42 }, { domain: 'unknown' },
    { reportRecipients: ['ou_a', 'ou_a'] }, { token: 'secret' },
  ]) assert.throws(() => parseFeishuPatch(invalid));
});

test('feishu patch never permits nested or arbitrary recipient objects', () => {
  assert.throws(() => parseFeishuPatch({ reportRecipients: [{ id: 'ou_admin' }] }));
  // JSON payloads can contain an own `__proto__` key; it must not bypass the
  // allow-list via JavaScript's prototype setter semantics.
  assert.throws(() => parseFeishuPatch(JSON.parse('{"enabled":true,"__proto__":{"leaked":true}}')));
});

test('feishu patch enforces bounded strings, recipient count, and nullable secrets', () => {
  assert.deepEqual(parseFeishuPatch({ appId: null, appSecret: null, verificationToken: null, encryptKey: null, reportAssistantId: null }), {
    appId: null,
    appSecret: null,
    verificationToken: null,
    encryptKey: null,
    reportAssistantId: null,
  });
  assert.throws(() => parseFeishuPatch({ appId: 'x'.repeat(513) }));
  assert.throws(() => parseFeishuPatch({ reportRecipients: Array.from({ length: 501 }, (_, index) => `ou_${index}`) }));
  assert.throws(() => parseFeishuPatch({ reportRecipients: ['   '] }));
  assert.throws(() => parseFeishuPatch({ enabled: 'true' }));
});

test('feishu patch rejects inherited fields and preserves the explicit domain contract', () => {
  const inherited = Object.create({ appSecret: 'must-not-be-read' }) as Record<string, unknown>;
  inherited.enabled = true;
  assert.deepEqual(parseFeishuPatch(inherited), { enabled: true });
  assert.throws(() => parseFeishuPatch({ domain: 'FEISHU' }));
  assert.deepEqual(parseFeishuPatch({ domain: 'feishu' }), { domain: 'feishu' });
  assert.deepEqual(parseFeishuPatch({ domain: 'lark' }), { domain: 'lark' });
});

test('FeishuService fails closed when persistence is unavailable', async () => {
  const service = new FeishuService(null, {} as never);
  await assert.rejects(() => service.getSettings(), ServiceUnavailableException);
  await assert.rejects(() => service.createQrSession({ id: 'admin-1', role: 'admin' } as never), ServiceUnavailableException);
});
