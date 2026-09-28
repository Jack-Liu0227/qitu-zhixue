import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DistributedLock } from './distributed-lock';
import { RedisTtlError } from '../errors';
import { InMemoryRedisAdapter } from '../redis/in-memory.adapter';
import { NoopRedisAdapter } from '../redis/noop.adapter';

test('同一把锁：第二次获取失败，释放后可以重新获取', async () => {
  const lock = new DistributedLock(new InMemoryRedisAdapter(), {
    tokenFactory: () => 'token-1',
  });

  const first = await lock.acquire('lock:project:p1', { ttlMs: 1000 });
  assert.ok(first);
  assert.equal(first?.token, 'token-1');

  const second = await lock.acquire('lock:project:p1', { ttlMs: 1000 });
  assert.equal(second, null, '锁被占用时不得再次获取');

  assert.equal(await first?.release(), true);
  const third = await lock.acquire('lock:project:p1', { ttlMs: 1000 });
  assert.ok(third);
  await third?.release();
});

test('释放只对自己持有的 token 生效，不会误删新持有者的锁', async () => {
  const adapter = new InMemoryRedisAdapter();
  const tokens = ['owner-1', 'owner-2'];
  const lock = new DistributedLock(adapter, { tokenFactory: () => tokens.shift() ?? 'x' });

  const owner1 = await lock.acquire('lock:k', { ttlMs: 1000 });
  assert.ok(owner1);
  // 锁过期，owner-2 拿到锁
  adapter.advanceClock(1001);
  const owner2 = await lock.acquire('lock:k', { ttlMs: 1000 });
  assert.ok(owner2);

  // 旧持有者再释放：token 不匹配，不得删除 owner-2 的锁
  assert.equal(await owner1?.release(), false);
  assert.equal(await adapter.get('lock:k'), 'owner-2');
  assert.equal(await owner2?.release(), true);
});

test('重复释放返回 false（幂等安全）', async () => {
  const lock = new DistributedLock(new InMemoryRedisAdapter());
  const handle = await lock.acquire('lock:k', { ttlMs: 1000 });
  assert.ok(handle);
  assert.equal(await handle?.release(), true);
  assert.equal(await handle?.release(), false);
});

test('锁 TTL 到期后自动可被重新获取', async () => {
  const adapter = new InMemoryRedisAdapter();
  const lock = new DistributedLock(adapter, { tokenFactory: () => 'a' });
  const first = await lock.acquire('lock:k', { ttlMs: 500 });
  assert.ok(first);
  adapter.advanceClock(501);
  const second = await lock.acquire('lock:k', { ttlMs: 500, token: 'b' });
  assert.ok(second);
  assert.equal(second?.token, 'b');
});

test('withLock 获取成功执行任务并释放；获取失败返回 null 且不执行', async () => {
  const adapter = new InMemoryRedisAdapter();
  const lock = new DistributedLock(adapter, { tokenFactory: () => 'held' });

  const held = await lock.acquire('lock:k', { ttlMs: 1000 });
  assert.ok(held);

  let ran = false;
  const result = await lock.withLock('lock:k', () => {
    ran = true;
    return 42;
  });
  assert.equal(result, null);
  assert.equal(ran, false);

  await held?.release();
  const value = await lock.withLock('lock:k', () => 42, { ttlMs: 1000 });
  assert.equal(value, 42);
  // 任务结束后锁已释放
  assert.equal(await adapter.get('lock:k'), null);
});

test('非法锁 TTL 抛 RedisTtlError', async () => {
  const lock = new DistributedLock(new InMemoryRedisAdapter());
  await assert.rejects(() => lock.acquire('lock:k', { ttlMs: 0 }), RedisTtlError);
  await assert.rejects(() => lock.acquire('lock:k', { ttlMs: -1 }), RedisTtlError);
});

test('no-op 适配器下永不获取锁（不产生假互斥）', async () => {
  const lock = new DistributedLock(new NoopRedisAdapter());
  assert.equal(await lock.acquire('lock:k', { ttlMs: 1000 }), null);
});
