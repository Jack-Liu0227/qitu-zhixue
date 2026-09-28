import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisUnavailableError } from '../errors';
import { selectRedisAdapter } from './select';

test('配置 REDIS_URL 时使用真实适配器（延迟连接，不触发网络）', async () => {
  const adapter = selectRedisAdapter({ url: 'redis://127.0.0.1:6379/0', mode: 'live' });
  assert.equal(adapter.kind, 'redis');
  // lazyConnect：仅构造不连接，quit 应安全返回且不挂住进程。
  await adapter.quit();
});

test('live 且未配置 REDIS_URL：启动不失败，请求能力时 fail-fast', async () => {
  const adapter = selectRedisAdapter({ url: undefined, mode: 'live' });
  assert.equal(adapter.kind, 'unavailable');

  // 生命周期钩子不抛错，保证应用仍能启动。
  await adapter.connect();
  await adapter.quit();

  // 真正的 Redis 能力请求才抛 RedisUnavailableError。
  await assert.rejects(() => adapter.get('k'), RedisUnavailableError);
  await assert.rejects(() => adapter.set('k', 'v'), RedisUnavailableError);
  await assert.rejects(() => adapter.ping(), RedisUnavailableError);
});

test('demo/test 且未配置 REDIS_URL：显式 no-op', () => {
  assert.equal(selectRedisAdapter({ url: undefined, mode: 'demo' }).kind, 'noop');
  assert.equal(selectRedisAdapter({ url: undefined, mode: 'test' }).kind, 'noop');
});

test('空白 REDIS_URL 视为未配置', () => {
  assert.equal(selectRedisAdapter({ url: '   ', mode: 'demo' }).kind, 'noop');
  assert.equal(selectRedisAdapter({ url: '   ', mode: 'live' }).kind, 'unavailable');
});

test('有 REDIS_URL 时即使 live 之外也使用真实适配器', async () => {
  const adapter = selectRedisAdapter({ url: 'redis://127.0.0.1:6379/0', mode: 'test' });
  assert.equal(adapter.kind, 'redis');
  await adapter.quit();
});
