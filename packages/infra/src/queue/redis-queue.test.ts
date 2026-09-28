import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisQueue } from './redis-queue';
import { RedisQueuePayloadError } from '../errors';
import { InMemoryRedisAdapter } from '../redis/in-memory.adapter';

test('enqueue → reserve → ack 的完整生命周期', async () => {
  const adapter = new InMemoryRedisAdapter();
  const queue = new RedisQueue(adapter);

  const id = await queue.enqueue({
    key: 'q:outbox',
    topic: 'feedback.submitted',
    payload: { id: 'ft-1' },
  });
  assert.ok(id);
  assert.equal(await queue.depth('q:outbox'), 1);

  const reserved = await queue.reserve<{ id: string }>('q:outbox');
  assert.ok(reserved);
  assert.equal(reserved?.job.topic, 'feedback.submitted');
  assert.deepEqual(reserved?.job.payload, { id: 'ft-1' });
  assert.equal(reserved?.job.attempts, 0);
  assert.equal(await queue.depth('q:outbox'), 0);
  assert.equal(await queue.processingDepth('q:outbox'), 1);

  assert.equal(await queue.ack('q:outbox', reserved!), true);
  assert.equal(await queue.processingDepth('q:outbox'), 0);
});

test('空队列 reserve 返回 null', async () => {
  const queue = new RedisQueue(new InMemoryRedisAdapter());
  assert.equal(await queue.reserve('q:empty'), null);
});

test('失败未达上限回到 pending 重试，达到上限进入死信', async () => {
  const queue = new RedisQueue(new InMemoryRedisAdapter());
  await queue.enqueue({
    key: 'q:outbox',
    topic: 't',
    payload: { n: 1 },
    maxAttempts: 2,
  });

  const first = await queue.reserve('q:outbox');
  assert.equal(await queue.fail('q:outbox', first!, new Error('smtp timeout')), 'retried');
  assert.equal(await queue.depth('q:outbox'), 1);

  const second = await queue.reserve('q:outbox');
  assert.equal(second?.job.attempts, 1);
  assert.equal(second?.job.lastError, 'smtp timeout');
  assert.equal(await queue.fail('q:outbox', second!, new Error('still failing')), 'dead-lettered');
  assert.equal(await queue.depth('q:outbox'), 0);
  assert.equal(await queue.deadLetterDepth('q:outbox'), 1);
});

test('损坏的任务信封抛 RedisQueuePayloadError', async () => {
  const adapter = new InMemoryRedisAdapter();
  const queue = new RedisQueue(adapter);
  await adapter.push('q:bad:pending', '{not-json');
  await assert.rejects(() => queue.reserve('q:bad'), RedisQueuePayloadError);
});
