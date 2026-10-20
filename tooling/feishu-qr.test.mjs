import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFeishuQrStatus, pollFeishuQrSession, shouldRefreshFeishuQr } from '../apps/admin-console/lib/api/feishu-qr.ts';

const url = 'https://accounts.feishu.cn/fixture?user_code=fixture';
const current = { status: 'pending', qrSessionId: 'qr-1', qrCodeUrl: url, qrCodeDataUrl: 'data:image/gif;base64,fixture' };
const status = { id: 'qr-1', status: 'pending', authorizationUrl: '', expiresAt: '2026-10-19T12:00:00Z', credentialConfigured: false };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('QR refresh waits until the provider expiry and does not invent one when unknown', () => {
  assert.equal(shouldRefreshFeishuQr(null), false);
  assert.equal(shouldRefreshFeishuQr(30), false);
  assert.equal(shouldRefreshFeishuQr(1), false);
  assert.equal(shouldRefreshFeishuQr(0), true);
});

test('pending polls cannot erase or replace the original device QR with a legacy OAuth URL', () => {
  for (const authorizationUrl of ['', 'https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=old']) {
    const next = applyFeishuQrStatus(current, { ...status, authorizationUrl });
    assert.equal(next.qrCodeUrl, url);
    assert.equal(next.qrCodeDataUrl, current.qrCodeDataUrl);
    assert.equal(next.status, 'pending');
  }
});

test('terminal statuses remove the scannable QR and only bound reports success', () => {
  for (const state of ['bound', 'expired', 'cancelled']) {
    const next = applyFeishuQrStatus(current, { ...status, status: state });
    assert.equal(next.qrCodeUrl, undefined);
    assert.equal(next.qrCodeDataUrl, undefined);
    assert.equal(next.status, state === 'bound' ? 'connected' : 'error');
  }
});

test('polling respects provider intervals, never overlaps, and follows slow_down', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  let resolvePoll;
  const received = [];
  const stop = pollFeishuQrSession({ sessionId: 'qr-1', pollIntervalSeconds: 5,
    poll: async () => { requests += 1; return new Promise((resolve) => { resolvePoll = resolve; }); },
    onStatus: (value) => received.push(value), onError: () => true });
  t.after(stop);
  t.mock.timers.tick(3000);
  assert.equal(requests, 0);
  t.mock.timers.tick(2000);
  assert.equal(requests, 1);
  t.mock.timers.tick(30_000);
  assert.equal(requests, 1, 'a slow request must not trigger concurrent provider polls');
  resolvePoll({ ...status, pollIntervalSeconds: 10 });
  await flush();
  t.mock.timers.tick(9999);
  assert.equal(requests, 1);
  t.mock.timers.tick(1);
  assert.equal(requests, 2);
  stop();
  resolvePoll(status);
  await flush();
  assert.equal(received.length, 1, 'late responses after stopping must be ignored');
});

test('offline failures retry, permission failures stop, and terminal statuses stop polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const terminal of ['bound', 'expired', 'cancelled', 'permission']) {
    let requests = 0;
    const errors = [];
    const received = [];
    const stop = pollFeishuQrSession({ sessionId: 'qr-1', pollIntervalSeconds: 1,
      poll: async () => {
        requests += 1;
        if (requests === 1) throw new Error('offline');
        if (terminal === 'permission') throw new Error('permission');
        return { ...status, status: terminal };
      }, onStatus: (value) => received.push(value), onError: (error) => { errors.push(error.message); return error.message === 'offline'; } });
    t.mock.timers.tick(1000);
    await flush();
    t.mock.timers.tick(1000);
    await flush();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(requests, 2);
    assert.equal(errors[0], 'offline');
    assert.equal(received.length, terminal === 'permission' ? 0 : 1);
    stop();
  }
});
