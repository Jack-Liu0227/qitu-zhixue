import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { SettingsRegistryController } from './settings-registry.controller';
import {
  ADMIN_SETTINGS_ROUTE_MANIFEST,
  assertSettingsRegistryCoverage,
  SETTINGS_REGISTRY,
  SettingsRegistryService,
} from './settings-registry.service';

function authFor(role: CurrentUser['role']) {
  return { getSession: () => ({ user: { id: 'user-1', email: 'user@example.com', displayName: 'User', role } }) };
}

test('settings registry covers every settings route, including the overview route', () => {
  assertSettingsRegistryCoverage();
  assert.equal(ADMIN_SETTINGS_ROUTE_MANIFEST.length, 20);
  assert.equal(SETTINGS_REGISTRY.length, 20);
  assert.deepEqual(
    new Set(SETTINGS_REGISTRY.map((item) => item.id)),
    new Set(ADMIN_SETTINGS_ROUTE_MANIFEST),
  );
  assert.equal(new Set(SETTINGS_REGISTRY.map((item) => item.href)).size, 20);
});

test('settings registry endpoint requires an administrator', () => {
  const registry = new SettingsRegistryService();
  const controller = new SettingsRegistryController(authFor('admin') as never, registry);
  assert.equal(controller.getRegistry('qitu_session=admin').data.length, 20);

  for (const role of ['student', 'teacher', 'parent'] as const) {
    const denied = new SettingsRegistryController(authFor(role) as never, registry);
    assert.throws(() => denied.getRegistry('qitu_session=user'), ForbiddenException);
  }

  const unauthenticated = new SettingsRegistryController(
    { getSession: () => { throw new UnauthorizedException('请先登录'); } } as never,
    registry,
  );
  assert.throws(() => unauthenticated.getRegistry(undefined), UnauthorizedException);
});

test('registry coverage assertion rejects missing, unexpected and duplicate entries', () => {
  assert.throws(
    () => assertSettingsRegistryCoverage(SETTINGS_REGISTRY.filter((item) => item.id !== 'overview')),
    /缺少 \[overview\]/,
  );
  assert.throws(
    () => assertSettingsRegistryCoverage([...SETTINGS_REGISTRY, { ...SETTINGS_REGISTRY[0]!, id: 'future' }]),
    /多出 \[future\]/,
  );
  assert.throws(
    () => assertSettingsRegistryCoverage([...SETTINGS_REGISTRY, { ...SETTINGS_REGISTRY[SETTINGS_REGISTRY.length - 1]!, id: 'about' }]),
    /存在重复项=true/,
  );
});
