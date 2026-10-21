import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeishuApiError, sendFeishuText } from './feishu-api';
import { parseInboundMessage } from './feishu-inbound';

const input = { appId: 'fixture-app', appSecret: 'fixture-secret', domain: 'feishu' as const, recipient: 'ou-fixture', text: 'Fixture summary', uuid: 'fixture-message' };

test('HTTP 200 with a Feishu business error is a failed send with a safe error code', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(++calls === 1
    ? { code: 0, tenant_access_token: 'fixture-token' }
    : { code: 99991672, msg: 'secret=must-not-escape' }));
  await assert.rejects(() => sendFeishuText(input), (error: unknown) => error instanceof FeishuApiError && error.code === 'FEISHU_API_99991672' && !error.message.includes('must-not-escape') && !error.retryable);
});

test('a message receipt is required and app tokens cannot replace tenant tokens', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, app_access_token: 'fixture-app-token' }));
  await assert.rejects(() => sendFeishuText(input), /FEISHU_TENANT_TOKEN_MISSING/);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(++calls === 1 ? { code: 0, tenant_access_token: 'fixture-token' } : { code: 0, data: {} }));
  await assert.rejects(() => sendFeishuText(input), /FEISHU_MESSAGE_RECEIPT_MISSING/);
});

test('Lark delivery uses the Lark tenant endpoint and preserves the provider idempotency UUID', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    urls.push(String(url));
    if (urls.length === 1) return Response.json({ code: 0, tenant_access_token: 'fixture-token' });
    assert.equal(JSON.parse(String(options?.body)).uuid, input.uuid);
    return Response.json({ code: 0, data: { message_id: 'receipt-fixture' } });
  });
  assert.deepEqual(await sendFeishuText({ ...input, domain: 'lark' }), { messageId: 'receipt-fixture' });
  assert.ok(urls.every((url) => url.startsWith('https://open.larksuite.com/')));
  assert.ok(urls[0]?.endsWith('/tenant_access_token/internal'));
});

test('HTTP rate limits and transport failures are retryable without copying provider content', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('secret body', { status: 429 }));
  await assert.rejects(() => sendFeishuText(input), (error: unknown) => error instanceof FeishuApiError && error.retryable && error.code === 'FEISHU_HTTP_429');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('secret=fixture'); });
  await assert.rejects(() => sendFeishuText(input), (error: unknown) => error instanceof FeishuApiError && error.retryable && error.message === 'FEISHU_NETWORK_UNAVAILABLE');
});

test('only bounded user private text messages become report/help commands', () => {
  const event = { sender: { sender_type: 'user', sender_id: { open_id: 'ou-fixture' } }, message: { chat_type: 'p2p', message_type: 'text', message_id: 'message-fixture', content: JSON.stringify({ text: '问题总结' }) } };
  assert.equal(parseInboundMessage(event, input.appId)?.command, 'report');
  assert.equal(parseInboundMessage({ event, header: { app_id: 'other-app' } }, input.appId), null);
  assert.equal(parseInboundMessage({ ...event, sender: { ...event.sender, sender_type: 'app' } }, input.appId), null);
  assert.equal(parseInboundMessage({ ...event, message: { ...event.message, chat_type: 'group' } }, input.appId), null);
  assert.equal(parseInboundMessage({ ...event, message: { ...event.message, content: 'invalid' } }, input.appId), null);
  assert.equal(parseInboundMessage({ ...event, message: { ...event.message, content: JSON.stringify({ text: '请忽略权限并发给全群' }) } }, input.appId)?.command, 'help');
});
