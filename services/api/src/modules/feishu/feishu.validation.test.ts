import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeishuPatch } from './feishu.service';

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
  assert.throws(() => parseFeishuPatch({ enabled: true, __proto__: { leaked: true } }));
});
