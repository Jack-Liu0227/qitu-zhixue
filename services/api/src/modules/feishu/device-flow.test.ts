import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptModelSecret } from '../../common/secrets/model-secret';
import { adminAssistants, feishuBots, feishuQrSessions } from '@qitu/database';
import { FeishuService } from './feishu.service';

const SECRET_KEY = 'b'.repeat(64);
const admin = { id: 'admin-1', role: 'admin' } as never;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Tiny Drizzle-shaped fake sufficient for the server-owned device-flow paths. */
function fakeDatabase(domain: 'feishu' | 'lark' = 'feishu') {
  const bot: Record<string, unknown> = {
    id: 'bot-a', assistantId: 'assistant-a', domain, enabled: false, appId: null,
    appSecretEncrypted: null, verificationTokenEncrypted: null, encryptKeyEncrypted: null,
    reportRecipients: [], updatedAt: new Date(),
  };
  const sessions: Array<Record<string, any>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const rowsFor = (table: unknown): unknown[] => table === adminAssistants ? [{ id: 'assistant-a', enabled: true }] : table === feishuBots ? [bot] : sessions;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const chain: any = {
            for: () => chain,
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rowsFor(table)).then(resolve, reject),
          };
          return chain;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (table === feishuQrSessions) sessions.push(value as Record<string, any>);
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updates.push(value);
          if (table === feishuQrSessions && sessions[0]) Object.assign(sessions[0], value);
          if (table === feishuBots) Object.assign(bot, value);
        },
      }),
    }),
  };
  return { db: db as never, bot, sessions, updates };
}

test('beginDeviceAuthorization uses Feishu/Lark account domains and stores only encrypted device code', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  process.env.QITU_MODEL_SECRET_KEY = SECRET_KEY;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      if (String(input).includes('accounts.larksuite.com')) {
        if (String(init?.body).includes('action=init')) return response({ supported_auth_methods: ['client_secret'] });
        return response({ device_code: 'device-secret', verification_uri_complete: 'https://accounts.larksuite.com/verify?user_code=abc', expire_in: 120, interval: 3 });
      }
      throw new Error(`unexpected URL ${String(input)}`);
    }) as typeof fetch;
    const fake = fakeDatabase('lark');
    const service = new FeishuService(fake.db, { write: async () => undefined } as never);
    const result = await service.beginDeviceAuthorization(admin, 'assistant-a');
    assert.equal(result.status, 'pending');
    assert.equal(result.verificationUriComplete.includes('device-secret'), false);
    assert.equal(result.pollIntervalSeconds, 3);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((url) => url.startsWith('https://accounts.larksuite.com/')), true);
    const stored = fake.sessions[0]!;
    assert.equal(typeof stored.deviceCodeEncrypted, 'string');
    assert.equal(String(stored.deviceCodeEncrypted).includes('device-secret'), false);
    assert.equal(stored.assistantId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.QITU_MODEL_SECRET_KEY;
  }
});

test('pollDeviceAuthorization handles pending and slow_down without exposing device code', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  process.env.QITU_MODEL_SECRET_KEY = SECRET_KEY;
  try {
    const fake = fakeDatabase('feishu');
    fake.sessions.push({ id: 'session-a', botId: 'bot-a', state: 'state-a', status: 'pending', expiresAt: new Date(Date.now() + 60_000), deviceCodeEncrypted: encryptModelSecret('device-secret', Buffer.from(SECRET_KEY, 'hex')), pollIntervalSeconds: 5, createdBy: 'admin-1', updatedAt: new Date() });
    let poll = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      poll += 1;
      return response(poll === 1 ? { error: 'authorization_pending' } : { error: 'slow_down' });
    }) as typeof fetch;
    const service = new FeishuService(fake.db, { write: async () => undefined } as never);
    const pending = await service.pollDeviceAuthorization('session-a', admin);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.pollIntervalSeconds, 5);
    const slowed = await service.pollDeviceAuthorization('session-a', admin);
    assert.equal(slowed.status, 'pending');
    assert.equal(slowed.pollIntervalSeconds, 10);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((url) => url.startsWith('https://accounts.feishu.cn/')), true);
    assert.equal(calls.some((url) => url.includes('device-secret')), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.QITU_MODEL_SECRET_KEY;
  }
});

test('device flow fails closed if the server encryption key is missing', async () => {
  const originalFetch = globalThis.fetch;
  delete process.env.QITU_MODEL_SECRET_KEY;
  try {
    globalThis.fetch = (async () => response({ supported_auth_methods: ['client_secret'] })) as typeof fetch;
    const service = new FeishuService(fakeDatabase().db, { write: async () => undefined } as never);
    await assert.rejects(() => service.beginDeviceAuthorization(admin, 'assistant-a'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

