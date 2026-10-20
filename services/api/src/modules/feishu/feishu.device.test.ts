import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { feishuBots, feishuQrSessions } from '@qitu/database';
import { encryptModelSecret } from '../../common/secrets/model-secret';
import { decryptDeviceAuthorization, encryptDeviceAuthorization } from './device-authorization';
import { FeishuService } from './feishu.service';

const admin: CurrentUser = { id: 'admin-fixture', role: 'admin', email: 'admin@example.test', displayName: 'Fixture' };
const key = Buffer.alloc(32, 7);
const url = 'https://accounts.feishu.cn/fixture?user_code=fixture';
type Session = typeof feishuQrSessions.$inferSelect;

function fixture(t: TestContext, session?: Partial<Session>) {
  const previousKey = process.env.QITU_MODEL_SECRET_KEY;
  process.env.QITU_MODEL_SECRET_KEY = key.toString('hex');
  t.after(() => {
    if (previousKey === undefined) delete process.env.QITU_MODEL_SECRET_KEY;
    else process.env.QITU_MODEL_SECRET_KEY = previousKey;
  });
  const bot = { id: 'bot-fixture', assistantId: 'assistant-fixture', appId: null, domain: 'feishu' };
  const sessions: Session[] = session ? [{ id: 'qr-fixture', botId: bot.id, createdBy: admin.id, status: 'pending',
    expiresAt: new Date(Date.now() + 300_000), pollIntervalSeconds: 5, ...session } as Session] : [];
  const audits: Record<string, unknown>[] = [];
  const writes = { allowRetirement: true };
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: async () => table === feishuBots ? [bot] : sessions }) }),
    insert: () => ({ values: async (value: Session) => { sessions.push(value); } }),
    update: () => ({ set: (patch: Partial<Session>) => ({ where: () => {
      if (patch.status !== 'cancelled' || writes.allowRetirement) Object.assign(sessions[0]!, patch);
      return Object.assign(Promise.resolve(), { returning: async () => writes.allowRetirement ? [{ id: sessions[0]!.id }] : [] });
    } }) }),
  };
  Object.assign(db, { transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) });
  const service = new FeishuService(db as never, { write: async (entry: Record<string, unknown>) => { audits.push(entry); } } as never);
  return { service, sessions, audits, bot, writes };
}

function provider(t: TestContext, options: { poll?: string; expire_in?: unknown; includeExpiry?: boolean; interval?: unknown } = {}) {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    requests.push(body);
    const data = body === 'action=init' ? { supported_auth_methods: ['client_secret'] }
      : body.startsWith('action=begin') ? { device_code: 'device-fixture', verification_uri_complete: url, ...(options.includeExpiry === false ? {} : { expire_in: options.expire_in ?? 600 }), interval: options.interval ?? 5 }
        : { error: options.poll ?? 'authorization_pending' };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  return requests;
}

test('device QR survives repeated pending polls and same-admin resume without extending its lifetime', async (t) => {
  const { service, sessions, audits } = fixture(t);
  const requests = provider(t);
  const started = await service.beginDeviceAuthorization(admin, 'assistant-fixture');
  assert.equal(started.verificationUriComplete, url);
  const ciphertext = sessions[0]!.deviceCodeEncrypted!;
  assert.equal(ciphertext.includes('device-fixture'), false);
  assert.equal(ciphertext.includes(url), false);
  assert.deepEqual(decryptDeviceAuthorization(ciphertext, key), { deviceCode: 'device-fixture', verificationUriComplete: url });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const polled = await service.pollDeviceAuthorization(started.id, admin);
    assert.equal(polled.authorizationUrl, url);
    assert.equal(polled.expiresAt, started.expiresAt);
  }
  assert.equal(requests[2], 'action=poll&device_code=device-fixture&tp=ob_app');
  const beforeResume = requests.length;
  assert.deepEqual(await service.beginDeviceAuthorization(admin, 'assistant-fixture'), started);
  assert.equal(requests.length, beforeResume);
  assert.equal(audits.length, 1, 'resume must not create another authorization');
});

test('pre-fix device sessions remain pollable and are safely replaced when the QR cannot be recovered', async (t) => {
  const { service, sessions, audits } = fixture(t, { deviceCodeEncrypted: encryptModelSecret('legacy-device-fixture', key) });
  const requests = provider(t);
  const pending = await service.pollDeviceAuthorization('qr-fixture', admin);
  assert.equal(pending.authorizationUrl, '', 'never substitute a legacy OAuth URL for a device session');
  assert.match(requests[0]!, /device_code=legacy-device-fixture/);
  const replacement = await service.beginDeviceAuthorization(admin, 'assistant-fixture');
  assert.notEqual(replacement.id, 'qr-fixture');
  assert.equal(replacement.verificationUriComplete, url);
  assert.equal(sessions[0]!.status, 'cancelled');
  assert.equal(sessions[0]!.deviceCodeEncrypted, null);
  assert.equal(audits[0]!.action, 'admin.feishu.device.cancel');
});

test('another administrator cannot read, poll, replace, or resume an active QR', async (t) => {
  const { service, sessions } = fixture(t, { deviceCodeEncrypted: encryptDeviceAuthorization({ deviceCode: 'fixture', verificationUriComplete: url }, key) });
  const requests = provider(t);
  const other = { ...admin, id: 'other-admin' };
  await assert.rejects(() => service.getQrSession('qr-fixture', other), ForbiddenException);
  await assert.rejects(() => service.pollDeviceAuthorization('qr-fixture', other), ForbiddenException);
  await assert.rejects(() => service.beginDeviceAuthorization(other, 'assistant-fixture'), BadRequestException);
  assert.equal(requests.length, 0);
  assert.equal(sessions[0]!.status, 'pending');
});

test('replacing a pre-fix session cannot overwrite a concurrent completion or create another session', async (t) => {
  const { service, sessions, writes, audits } = fixture(t, { deviceCodeEncrypted: encryptModelSecret('legacy-fixture', key) });
  writes.allowRetirement = false;
  const requests = provider(t);
  await assert.rejects(() => service.beginDeviceAuthorization(admin, 'assistant-fixture'), ConflictException);
  assert.equal(requests.length, 0);
  assert.equal(sessions.length, 1);
  assert.equal(audits.length, 0);
});

test('slow_down retains the QR and increases the advertised interval', async (t) => {
  const { service } = fixture(t, { deviceCodeEncrypted: encryptDeviceAuthorization({ deviceCode: 'fixture', verificationUriComplete: url }, key) });
  provider(t, { poll: 'slow_down' });
  const status = await service.pollDeviceAuthorization('qr-fixture', admin);
  assert.equal(status.authorizationUrl, url);
  assert.equal(status.pollIntervalSeconds, 10);
});

test('device authorization honors the actual provider expiry and interval instead of shortening or extending them', async (t) => {
  const { service } = fixture(t);
  provider(t, { expire_in: 1200, interval: 45 });
  const before = Date.now();
  const session = await service.beginDeviceAuthorization(admin, 'assistant-fixture');
  assert.ok(Date.parse(session.expiresAt) >= before + 1_200_000);
  assert.ok(Date.parse(session.expiresAt) <= Date.now() + 1_200_000);
  assert.equal(session.pollIntervalSeconds, 45);
});

test('short provider expiry is not extended to a fabricated minimum', async (t) => {
  const { service } = fixture(t);
  provider(t, { expire_in: 20 });
  const before = Date.now();
  const session = await service.beginDeviceAuthorization(admin, 'assistant-fixture');
  assert.ok(Date.parse(session.expiresAt) >= before + 20_000);
  assert.ok(Date.parse(session.expiresAt) <= Date.now() + 20_000);
});

test('missing provider expiry fails closed instead of advertising a fabricated countdown', async (t) => {
  const { service, sessions } = fixture(t);
  provider(t, { includeExpiry: false });
  await assert.rejects(() => service.beginDeviceAuthorization(admin, 'assistant-fixture'), ServiceUnavailableException);
  assert.equal(sessions.length, 0);
});

test('invalid provider timing fails closed without creating a session', async (t) => {
  const { service, sessions } = fixture(t);
  provider(t, { expire_in: 'invalid' });
  await assert.rejects(() => service.beginDeviceAuthorization(admin, 'assistant-fixture'), ServiceUnavailableException);
  assert.equal(sessions.length, 0);
});

test('terminal device status never requires a legacy OAuth callback or exposes a scannable URL', async (t) => {
  const { service, sessions } = fixture(t, { deviceCodeEncrypted: encryptDeviceAuthorization({ deviceCode: 'fixture', verificationUriComplete: url }, key), expiresAt: new Date(Date.now() - 1000) });
  const requests = provider(t);
  const status = await service.pollDeviceAuthorization('qr-fixture', admin);
  assert.equal(status.status, 'expired');
  assert.equal(status.authorizationUrl, '');
  assert.equal(sessions[0]!.status, 'expired');
  assert.equal(requests.length, 0);
});

test('a completed device session remains readable after its encrypted device code has been erased', async (t) => {
  const { service, bot } = fixture(t, { status: 'bound', deviceCodeEncrypted: null });
  Object.assign(bot, { appId: 'cli-fixture', appSecretEncrypted: 'fixture-ciphertext' });
  const requests = provider(t);
  const status = await service.pollDeviceAuthorization('qr-fixture', admin);
  assert.equal(status.status, 'bound');
  assert.equal(status.authorizationUrl, '');
  assert.equal(requests.length, 0);
});
