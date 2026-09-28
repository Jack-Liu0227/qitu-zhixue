import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JsonCache } from './json-cache';
import { RedisTtlError } from '../errors';
import { InMemoryRedisAdapter } from '../redis/in-memory.adapter';

test('显式 TTL 透传给 Redis（PX）', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);

  await cache.set('k', { a: 1 }, { ttlMs: 1500 });

  const call = adapter.setCalls.at(-1);
  assert.equal(call?.options?.ttlMs, 1500);
  assert.equal(await adapter.get('k'), '{"a":1}');
});

test('未显式指定时使用默认 TTL', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter, { defaultTtlMs: 60_000 });

  await cache.set('k', 'v');

  assert.equal(adapter.setCalls.at(-1)?.options?.ttlMs, 60_000);
});

test('既无显式也无默认 TTL 时不设置过期', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);

  await cache.set('k', 'v');

  assert.equal(adapter.setCalls.at(-1)?.options, undefined);
});

test('非法 TTL 立即抛 RedisTtlError，且不写 Redis', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);

  await assert.rejects(() => cache.set('k', 'v', { ttlMs: 0 }), RedisTtlError);
  await assert.rejects(() => cache.set('k', 'v', { ttlMs: -5 }), RedisTtlError);
  await assert.rejects(() => cache.set('k', 'v', { ttlMs: Number.NaN }), RedisTtlError);
  assert.equal(adapter.setCalls.length, 0);
});

test('TTL 到期后缓存未命中', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);
  await cache.set('k', { a: 1 }, { ttlMs: 1000 });

  assert.deepEqual(await cache.get('k'), { a: 1 });
  adapter.advanceClock(1001);
  assert.equal(await cache.get('k'), null);
});

test('get 解析 JSON；损坏数据按未命中处理并删除', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);
  await cache.set('good', [1, 2, 3]);
  assert.deepEqual(await cache.get('good'), [1, 2, 3]);

  await adapter.set('bad', '{not json');
  assert.equal(await cache.get('bad'), null);
  assert.equal(await adapter.get('bad'), null);
});

test('remember 未命中时回源并回填，命中时不再调用 factory', async () => {
  const adapter = new InMemoryRedisAdapter();
  const cache = new JsonCache(adapter);
  let calls = 0;
  const factory = () => {
    calls += 1;
    return { n: calls };
  };

  assert.deepEqual(await cache.remember('k', factory, { ttlMs: 1000 }), { n: 1 });
  assert.deepEqual(await cache.remember('k', factory, { ttlMs: 1000 }), { n: 1 });
  assert.equal(calls, 1);
});
