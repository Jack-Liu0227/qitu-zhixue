import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideIdempotencyAction } from './idempotency.decision';
import type { IdempotencyStatus } from './idempotency.types';

/**
 * 幂等状态机（重放 / 冲突 / 回收）的纯函数单测。
 *
 * 运行方式见 `idempotency.hash.test.ts`。
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2026-01-01T00:01:00.000Z');
const PAST = new Date('2025-12-31T23:59:00.000Z');

function decide(params: {
  storedStatus: IdempotencyStatus;
  storedRequestHash?: string;
  requestHash?: string;
  storedExpiresAt?: Date;
}) {
  return decideIdempotencyAction({
    storedRequestHash: params.storedRequestHash ?? 'hash-a',
    requestHash: params.requestHash ?? 'hash-a',
    storedStatus: params.storedStatus,
    storedExpiresAt: params.storedExpiresAt ?? FUTURE,
    now: NOW,
  });
}

test('succeeded + 同 hash → replay（不重复执行 handler）', () => {
  assert.equal(decide({ storedStatus: 'succeeded' }), 'replay');
});

test('succeeded + 不同 hash → conflict', () => {
  assert.equal(decide({ storedStatus: 'succeeded', requestHash: 'hash-b' }), 'conflict');
});

test('succeeded 即使已过保留期仍 replay（记录还在就不重复副作用）', () => {
  assert.equal(decide({ storedStatus: 'succeeded', storedExpiresAt: PAST }), 'replay');
});

test('failed + 同 hash → reclaim（失败无成功结果，允许重试）', () => {
  assert.equal(decide({ storedStatus: 'failed' }), 'reclaim');
});

test('failed + 不同 hash → conflict', () => {
  assert.equal(decide({ storedStatus: 'failed', requestHash: 'hash-b' }), 'conflict');
});

test('in_progress + 同 hash + 租约未到 → conflict（并发不双执行）', () => {
  assert.equal(decide({ storedStatus: 'in_progress', storedExpiresAt: FUTURE }), 'conflict');
});

test('in_progress + 同 hash + 租约已过期 → reclaim', () => {
  assert.equal(decide({ storedStatus: 'in_progress', storedExpiresAt: PAST }), 'reclaim');
});

test('in_progress + 不同 hash → conflict（即使租约已过期）', () => {
  assert.equal(
    decide({ storedStatus: 'in_progress', storedExpiresAt: PAST, requestHash: 'hash-b' }),
    'conflict',
  );
});

test('租约正好到点视为已过期（边界）', () => {
  assert.equal(decide({ storedStatus: 'in_progress', storedExpiresAt: NOW }), 'reclaim');
});
