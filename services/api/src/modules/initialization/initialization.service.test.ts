import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { InitializationService } from './initialization.service';

const ADMIN: CurrentUser = { id: 'admin-1', email: 'admin@example.com', displayName: 'Admin', role: 'admin' };

test('foundation execution requires the corresponding migrated tables first', async () => {
  let executions = 0;
  const db = {
    execute: async () => ({ rows: [] }),
    select: () => ({ from: () => ({ limit: async () => { throw new Error('private database error'); } }) }),
  } as unknown as Database;
  const idempotency = { execute: async () => { executions += 1; } } as unknown as IdempotencyStore;
  const service = new InitializationService(db, idempotency, {} as AuditWriter);
  await assert.rejects(() => service.execute('knowledge', ADMIN, 'key'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'INITIALIZATION_OPERATOR_REQUIRED');
    return true;
  });
  assert.equal(executions, 0);
});

test('tutor foundation inserts the partner, synthetic strategy memory, and pending index event', async () => {
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  };
  const db = {
    execute: async () => ({ rows: [] }),
    select: () => ({ from: () => ({ limit: async () => [] }) }),
    transaction: async (work: (transaction: typeof tx) => Promise<void>) => work(tx),
  } as unknown as Database;
  const idempotency = {
    execute: async (_scope: string, _key: string, _hash: string, handler: () => Promise<{ body: unknown }>) => ({
      status: 200,
      ...(await handler()),
      replayed: false,
    }),
  } as unknown as IdempotencyStore;
  const audit = { write: async () => 'audit-1' } as unknown as AuditWriter;
  const service = new InitializationService(db, idempotency, audit);

  const result = await service.execute('tutor', ADMIN, 'foundation-key');
  assert.equal(result.area, 'tutor');
  assert.equal(inserts.length, 3);
  const partner = inserts[0]!.values;
  const memory = inserts[1]!.values;
  const event = inserts[2]!.values;
  assert.equal(partner.id, 'qitu-learning-partner');
  assert.equal(partner.modelUsage, 'tutor.chat');
  assert.equal(memory.studentId, null);
  assert.equal(memory.scope, 'agent');
  assert.equal(memory.status, 'active');
  assert.equal(memory.expiresAt, null);
  assert.equal(memory.indexStatus, 'pending');
  assert.equal(event.topic, 'agent-memory.index');
  assert.deepEqual(event.payload, { memoryId: 'foundation-agent-memory-strategy' });
  assert.doesNotMatch(String(memory.content), /conversation|transcript|voice|对话|语音/iu);
});

test('initialization refuses in-memory execution', async () => {
  const service = new InitializationService(null, {} as IdempotencyStore, {} as AuditWriter);
  await assert.rejects(() => service.execute('tutor', ADMIN, 'key'), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal((error.getResponse() as { code: string }).code, 'INITIALIZATION_DATABASE_UNAVAILABLE');
    return true;
  });
});
