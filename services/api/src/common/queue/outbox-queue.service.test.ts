import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DistributedLock, JsonCache, RedisKeyBuilder, RedisKeyError } from '@qitu/infra';
import { InMemoryRedisAdapter } from '@qitu/infra/testing';
import { OutboxQueue } from './outbox-queue.service';
import type { RedisRuntime } from '../redis/redis.runtime';
import { createRedisRuntime } from '../redis/redis.runtime';

function inMemoryRuntime(namespace = 'qitu'): RedisRuntime {
  const adapter = new InMemoryRedisAdapter();
  return {
    adapter,
    keys: new RedisKeyBuilder(namespace),
    cache: new JsonCache(adapter),
    lock: new DistributedLock(adapter),
  };
}

test('keyFor 按全局 / 学校 / 学校+学生 三种作用域构造，互不相同', () => {
  const queue = new OutboxQueue(inMemoryRuntime());
  const globalKey = queue.keyFor('feedback.submitted');
  const schoolKey = queue.keyFor('feedback.submitted', { schoolId: 'school-a' });
  const studentKey = queue.keyFor('feedback.submitted', {
    schoolId: 'school-a',
    studentId: 'stu-1',
  });
  assert.equal(globalKey, 'qitu:queue:outbox:feedback.submitted');
  assert.equal(schoolKey, 'qitu:school:school-a:queue:outbox:feedback.submitted');
  assert.equal(studentKey, 'qitu:school:school-a:student:stu-1:queue:outbox:feedback.submitted');
  assert.equal(new Set([globalKey, schoolKey, studentKey]).size, 3);
});

test('只给 studentId 不给 schoolId：拒绝，避免跨校串队列', () => {
  const queue = new OutboxQueue(inMemoryRuntime());
  assert.throws(() => queue.keyFor('t', { studentId: 'stu-1' }), RedisKeyError);
});

test('enqueue → reserve → ack：任务可靠搬运', async () => {
  const queue = new OutboxQueue(inMemoryRuntime());
  await queue.enqueue({
    topic: 'feedback.submitted',
    payload: { ticketId: 'ft-1' },
    schoolId: 'school-a',
    studentId: 'stu-1',
  });

  const reserved = await queue.reserve<{ ticketId: string }>('feedback.submitted', {
    schoolId: 'school-a',
    studentId: 'stu-1',
  });
  assert.ok(reserved);
  assert.deepEqual(reserved?.job.payload, { ticketId: 'ft-1' });
  assert.equal(
    await queue.ack('feedback.submitted', { schoolId: 'school-a', studentId: 'stu-1' }, reserved!),
    true,
  );
  assert.equal(
    await queue.depth('feedback.submitted', { schoolId: 'school-a', studentId: 'stu-1' }),
    0,
  );
});

test('no-op 运行时：enqueue 不落盘、reserve 返回 null（诚实不可用）', async () => {
  const runtime = createRedisRuntime({ url: undefined, mode: 'test' });
  assert.equal(runtime.adapter.kind, 'noop');
  const queue = new OutboxQueue(runtime);

  const id = await queue.enqueue({ topic: 't', payload: { a: 1 } });
  assert.ok(id);
  assert.equal(await queue.depth('t'), 0);
  assert.equal(await queue.reserve('t'), null);
});
