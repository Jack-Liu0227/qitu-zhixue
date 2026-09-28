import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JsonCache } from '../cache/json-cache';
import { DistributedLock } from '../lock/distributed-lock';
import { NoopRedisAdapter } from './noop.adapter';

test('no-op 读操作一律未命中', async () => {
  const adapter = new NoopRedisAdapter();
  assert.equal(await adapter.get('k'), null);
  assert.equal(await adapter.pop('k'), null);
  assert.equal(await adapter.move('a', 'b'), null);
  assert.equal(await adapter.listLength('k'), 0);
});

test('no-op 写操作被丢弃但不报错', async () => {
  const adapter = new NoopRedisAdapter();
  assert.equal(await adapter.set('k', 'v'), 'OK');
  assert.equal(await adapter.del('k'), 0);
  assert.equal(await adapter.push('k', 'v'), 0);
  assert.equal(await adapter.remove('k', 'v'), 0);
  assert.equal(await adapter.deleteIfValueMatches('k', 'v'), false);
});

test('no-op 下 SET NX 失败，锁不可获取', async () => {
  const adapter = new NoopRedisAdapter();
  assert.equal(await adapter.set('k', 'v', { onlyIfAbsent: true }), null);
  const lock = new DistributedLock(adapter);
  assert.equal(await lock.acquire('lock:k'), null);
});

test('no-op 下缓存写入不保存，读取总是 null', async () => {
  const adapter = new NoopRedisAdapter();
  const cache = new JsonCache(adapter);
  await cache.set('k', { a: 1 }, { ttlMs: 1000 });
  assert.equal(await cache.get('k'), null);
});

test('no-op 生命周期与探针不抛错', async () => {
  const adapter = new NoopRedisAdapter();
  await adapter.connect();
  assert.equal(await adapter.ping(), 'PONG');
  await adapter.quit();
});
