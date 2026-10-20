import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { FeishuController } from './feishu.controller';
import { FeishuBridgeController } from './feishu-bridge.controller';
import type { AuthService } from '../identity-auth/auth.service';

const admin: CurrentUser = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', role: 'admin' };
const teacher: CurrentUser = { id: 'teacher-1', email: 'teacher@example.test', displayName: 'Teacher', role: 'teacher' };

function authFor(user: CurrentUser): AuthService {
  return { getSession: () => ({ user, expiresAt: new Date(Date.now() + 60_000).toISOString() }) } as unknown as AuthService;
}

function controller(user: CurrentUser, overrides: Record<string, unknown> = {}): FeishuController {
  const feishu = {
    getSettings: async () => ({ id: 'admin-reporting', enabled: false, connected: false, appId: null, domain: 'feishu', reportAssistantId: null, reportRecipients: [], credentialConfigured: false, qrBinding: { supported: true, callbackPath: '/callback' }, updatedAt: null }),
    update: async () => ({}),
    createQrSession: async () => ({}),
    getQrSession: async () => ({}),
    ...overrides,
  };
  const idempotency = {
    execute: async (_scope: string, _key: string, _hash: string, handler: () => Promise<unknown>) => handler(),
  };
  return new FeishuController(authFor(user), feishu as never, idempotency as never);
}

test('all Feishu admin read/write endpoints enforce the server-side admin role', async () => {
  const instance = controller(teacher);
  await assert.rejects(() => instance.get('qitu_session=test'), ForbiddenException);
  await assert.rejects(() => instance.update('qitu_session=test', 'key-1', { enabled: true }), ForbiddenException);
  await assert.rejects(() => instance.createQr('qitu_session=test', 'key-1', {}), ForbiddenException);
  await assert.rejects(() => instance.getQr('qitu_session=test', 'qr-1'), ForbiddenException);
  await assert.rejects(() => instance.beginDevice('qitu_session=test', 'key-1', {}), ForbiddenException);
  await assert.rejects(() => instance.pollDevice('qitu_session=test', 'qr-1'), ForbiddenException);
});

test('write endpoints reject missing or overlong idempotency keys before invoking services', async () => {
  let called = 0;
  const instance = controller(admin, {
    update: async () => { called += 1; return {}; },
    createQrSession: async () => { called += 1; return {}; },
  });
  await assert.rejects(() => instance.update('qitu_session=test', undefined, { enabled: true }), BadRequestException);
  await assert.rejects(() => instance.createQr('qitu_session=test', '   ', {}), BadRequestException);
  await assert.rejects(() => instance.update('qitu_session=test', 'x'.repeat(161), { enabled: true }), BadRequestException);
  await assert.rejects(() => instance.beginDevice('qitu_session=test', undefined, {}), BadRequestException);
  await assert.rejects(() => instance.beginDevice('qitu_session=test', 'x'.repeat(161), {}), BadRequestException);
  assert.equal(called, 0);
});

test('QR reads and device polls forward the authenticated admin for object-level checks', async () => {
  const actors: CurrentUser[] = [];
  const instance = controller(admin, {
    getQrSession: async (_id: string, actor: CurrentUser) => { actors.push(actor); return {}; },
    pollDeviceAuthorization: async (_id: string, actor: CurrentUser) => { actors.push(actor); return {}; },
  });
  await instance.getQr('qitu_session=test', 'qr-1');
  await instance.pollDevice('qitu_session=test', 'qr-1');
  assert.deepEqual(actors, [admin, admin]);
});

test('admin GET delegates to the service and returns a data envelope', async () => {
  const value = { id: 'admin-reporting', enabled: true, connected: true };
  const instance = controller(admin, { getSettings: async () => value });
  assert.deepEqual(await instance.get('qitu_session=test'), { data: value });
});

test('assistantId is part of the server-side idempotency scope and is forwarded to Feishu writes', async () => {
  const calls: string[] = [];
  const instance = controller(admin, {
    update: async (_actor: unknown, _input: unknown, assistantId: string) => { calls.push(`update:${assistantId}`); return { id: assistantId }; },
    createQrSession: async (_actor: unknown, assistantId: string) => { calls.push(`qr:${assistantId}`); return { id: assistantId }; },
  });
  await instance.update('qitu_session=test', 'key-a', { enabled: true }, 'assistant-a');
  await instance.createQr('qitu_session=test', 'key-b', { assistantId: 'assistant-b' });
  assert.deepEqual(calls, ['update:assistant-a', 'qr:assistant-b']);
  await assert.rejects(() => instance.update('qitu_session=test', 'key-c', { enabled: true }, '../other'), BadRequestException);
});

test('bridge diagnostics require an administrator and validate the canonical assistant scope', async () => {
  const ids: string[] = [];
  const bridge = { status: async (id: string) => { ids.push(id); return { assistantId: id, state: 'stopped' }; } };
  await assert.rejects(() => new FeishuBridgeController(authFor(teacher), bridge as never).get('qitu_session=fixture'), ForbiddenException);
  const adminBridge = new FeishuBridgeController(authFor(admin), bridge as never);
  await adminBridge.get('qitu_session=fixture', 'assistant-other');
  await assert.rejects(() => adminBridge.get('qitu_session=fixture', '../other'), BadRequestException);
  assert.deepEqual(ids, ['assistant-other']);
});

test('a malformed explicit assistant ID never silently routes to the reporting assistant', async () => {
  const instance = controller(admin);
  await assert.rejects(() => instance.createQr('qitu_session=fixture', 'fixture-key', { assistantId: 7 }), BadRequestException);
  await assert.rejects(() => instance.createQr('qitu_session=fixture', 'fixture-key', { assistantId: '' }), BadRequestException);
});

