import test from 'node:test';
import assert from 'node:assert/strict';
import { withTransaction } from '@qitu/database';
import type { Role, SessionResponse } from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { DirectoryService } from '../directory/directory.service';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { IdempotencyResult } from '../../common/idempotency/idempotency.types';
import { VisualAssetsController } from './visual-assets.controller';
import { VisualAssetsService } from './visual-assets.service';

class NoWriteAudit extends AuditWriter {
  override async write(): Promise<string> { throw new Error('Unexpected audit write'); }
}
class NoWriteIdempotency extends IdempotencyStore {
  calls = 0;
  override async execute<T>(): Promise<IdempotencyResult<T>> { this.calls++; throw new Error('Unexpected persistence'); }
}
class FixtureAuth extends AuthService {
  constructor(private readonly fixtureRole: Role) { super(new DirectoryService('test', null, withTransaction)); }
  override getSession(): SessionResponse {
    return { user: { id: 'isolated-fixture', email: 'fixture@example.test', displayName: 'Fixture', role: this.fixtureRole }, expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
}

test('all visual configuration endpoints reject non-admin roles before persistence', async () => {
  for (const role of ['student', 'parent', 'teacher', 'support'] satisfies Role[]) {
    const persistence = new NoWriteIdempotency();
    const controller = new VisualAssetsController(new FixtureAuth(role), new VisualAssetsService(null, new NoWriteAudit()), persistence);
    assert.throws(() => controller.catalog('qitu_session=fixture'), /素材库仅向管理员开放/);
    await assert.rejects(controller.binding('qitu_session=fixture', 'assistant', 'fixture', 'avatar'), /素材库仅向管理员开放/);
    await assert.rejects(controller.save('qitu_session=fixture', 'fixture-key', []), /素材选择仅向管理员开放/);
    assert.equal(persistence.calls, 0);
  }
});

test('admin catalog is available; unauthenticated reads and invalid writes are rejected', async () => {
  const persistence = new NoWriteIdempotency();
  const controller = new VisualAssetsController(new FixtureAuth('admin'), new VisualAssetsService(null, new NoWriteAudit()), persistence);
  assert.equal(controller.catalog('qitu_session=fixture', 'avatar').data.length, 10);
  assert.throws(() => controller.catalog(undefined), /请先登录/);
  await assert.rejects(controller.save('qitu_session=fixture', undefined, []), /Idempotency-Key/);
  await assert.rejects(controller.save('qitu_session=fixture', 'key', []), /1–100/);
  const item = { owner: { kind: 'assistant', id: 'fixture' }, usage: 'avatar', selection: { kind: 'inherit' }, expectedRevision: 0 };
  await assert.rejects(controller.save('qitu_session=fixture', 'key', [item, item]), /重复对象/);
  assert.equal(persistence.calls, 0);
});

test('unconfigured visual storage fails closed, while legacy custom avatars survive presentation fallback', async () => {
  const service = new VisualAssetsService(null, new NoWriteAudit());
  await assert.rejects(service.read({ kind: 'assistant', id: 'fixture' }, 'avatar'), /素材配置存储不可用/);
  await assert.rejects(service.save({ id: 'fixture', role: 'admin', email: 'fixture@example.test', displayName: 'Fixture' },
    { owner: { kind: 'assistant', id: 'fixture' }, usage: 'avatar', selection: { kind: 'inherit' }, expectedRevision: 0 }, 'key'), /素材配置存储不可用/);
  assert.equal(service.avatar('fixture', '🌱', []), '🌱');
  assert.equal(service.avatar('fixture', null, []), 'asset:avatar-general-v1');
  assert.equal(service.avatar('fixture', 'asset:avatar-data-v1', []), 'asset:avatar-data-v1');
});
