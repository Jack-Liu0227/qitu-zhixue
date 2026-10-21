import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeIdempotencyStore, actor } from '../templates/templates.test-support';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { deletionConfirmation } from './copilot.confirmations';

test('expired confirmation cannot be accepted, even when the plan journal still exists', async () => {
  const admin = actor('admin', 'confirm-fixture');
  const store = new FakeIdempotencyStore();
  const audit = { write: async () => 'audit' };
  const originalNow = Date.now;
  try {
    const first = await deletionConfirmation(store, audit as never, admin, 'step', 'team.delete', { id: 'fixture' }, async () => 'digest');
    Date.now = () => originalNow() + 11 * 60_000;
    await assert.rejects(deletionConfirmation(store, audit as never, admin, 'step', 'team.delete', { id: 'fixture' }, async () => 'digest',
      { actionId: 'remove', confirmationId: first.challenge.id, decision: 'confirm' }), error => {
        assert.ok(error && typeof error === 'object' && 'getResponse' in error);
        return (error as { getResponse(): { code: string } }).getResponse().code === 'COPILOT_CONFIRMATION_EXPIRED';
      });
  } finally { Date.now = originalNow; }
});


test('durable decision lookup reads only completed unexpired outcomes and never claims a new operation', async () => {
  let row: Record<string, unknown> | null = null;
  let reads = 0;
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => { reads++; return row ? [row] : []; } }) }) }) };
  const service = new IdempotencyService(db as never);
  assert.equal(await service.lookup('scope', 'key', 'hash'), null);
  row = { requestHash: 'hash', status: 'succeeded', expiresAt: new Date(Date.now() + 60_000), responseBody: { decision: 'cancel' }, responseStatus: 200 };
  assert.deepEqual((await service.lookup<{ decision: string }>('scope', 'key', 'hash'))?.body, { decision: 'cancel' });
  await assert.rejects(service.lookup('scope', 'key', 'other'));
  row.status = 'in_progress';
  assert.equal(await service.lookup('scope', 'key', 'hash'), null);
  row.status = 'succeeded'; row.expiresAt = new Date(0);
  assert.equal(await service.lookup('scope', 'key', 'hash'), null);
  await assert.rejects(new IdempotencyService(null).lookup('scope', 'key', 'hash'));
  assert.equal(reads, 5);
});
