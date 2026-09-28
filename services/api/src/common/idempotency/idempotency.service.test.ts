import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyError } from './idempotency.errors';

/**
 * 无数据库 / 非法入参的**行为契约**单测（不需要 Postgres）。
 *
 * 关键点：`DATABASE_TOKEN` 为 `null`（未配置 `DATABASE_URL`）时，`execute` 必须
 * 以 503 明确失败，**绝不**退回内存执行、绝不假装成功。
 */

test('无 DATABASE_URL 时 execute 抛 ServiceUnavailableException（503），且不执行 handler', async () => {
  const service = new IdempotencyService(null);
  let called = false;
  await assert.rejects(
    () =>
      service.execute('POST /x', 'key-1', 'hash-1', () => {
        called = true;
        return { body: { ok: true } };
      }),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
  assert.equal(called, false, 'handler 不得在无数据库时被调用');
});

test('无 DATABASE_URL 时 cleanupExpired 抛 ServiceUnavailableException', async () => {
  const service = new IdempotencyService(null);
  await assert.rejects(
    () => service.cleanupExpired(),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
});

test('scope 为空时抛 IDEMPOTENCY_KEY_REQUIRED（在触库之前）', async () => {
  const service = new IdempotencyService(null);
  await assert.rejects(
    () => service.execute('', 'key-1', 'hash-1', () => ({ body: {} })),
    (error: unknown) =>
      error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
});

test('Idempotency-Key 为空时抛 IDEMPOTENCY_KEY_REQUIRED', async () => {
  const service = new IdempotencyService(null);
  await assert.rejects(
    () => service.execute('POST /x', '   ', 'hash-1', () => ({ body: {} })),
    (error: unknown) =>
      error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
});

test('requestHash 为空时抛 IDEMPOTENCY_KEY_REQUIRED', async () => {
  const service = new IdempotencyService(null);
  await assert.rejects(
    () => service.execute('POST /x', 'key-1', '', () => ({ body: {} })),
    (error: unknown) =>
      error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
});
