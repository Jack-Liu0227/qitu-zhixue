import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisUnavailableError } from '@qitu/infra';
import { RedisModule } from './redis.module';
import { createRedisRuntime, parsePositiveIntEnv } from './redis.runtime';

test('live 且未配置 REDIS_URL：构造运行时与生命周期钩子都不抛错（保启动）', async () => {
  const runtime = createRedisRuntime({ url: undefined, mode: 'live' });
  assert.equal(runtime.adapter.kind, 'unavailable');

  const module = new RedisModule(runtime);
  await module.onModuleInit();
  await module.onModuleDestroy();
});

test('live 且未配置 REDIS_URL：只有请求缓存 / 锁能力时才 fail-fast', async () => {
  const runtime = createRedisRuntime({ url: undefined, mode: 'live' });
  await assert.rejects(() => runtime.cache.get('k'), RedisUnavailableError);
  await assert.rejects(() => runtime.lock.acquire('lock:k'), RedisUnavailableError);
});

test('demo/test 且未配置 REDIS_URL：使用显式 no-op', async () => {
  const runtime = createRedisRuntime({ url: undefined, mode: 'demo' });
  assert.equal(runtime.adapter.kind, 'noop');
  assert.equal(await runtime.cache.get('k'), null);
  assert.equal(await runtime.lock.acquire('lock:k'), null);
});

test('命名空间前缀体现在所有作用域键上', () => {
  const runtime = createRedisRuntime({ url: undefined, mode: 'test', namespace: 'qitu-test' });
  assert.equal(runtime.keys.global('cache', 'a'), 'qitu-test:cache:a');
  assert.equal(
    runtime.keys.student('school-a', 'stu-1', 'cache', 'profile'),
    'qitu-test:school:school-a:student:stu-1:cache:profile',
  );
});

test('默认 TTL 环境变量解析为运行时默认值', async () => {
  const adapterKind = createRedisRuntime({
    url: undefined,
    mode: 'test',
    defaultCacheTtlMs: parsePositiveIntEnv('60000'),
    defaultLockTtlMs: parsePositiveIntEnv('5000'),
  });
  assert.equal(adapterKind.adapter.kind, 'noop');
});

test('parsePositiveIntEnv 拒绝 0 / 负数 / 非整数 / 缺失', () => {
  assert.equal(parsePositiveIntEnv('1500'), 1500);
  assert.equal(parsePositiveIntEnv(' 2000 '), 2000);
  assert.equal(parsePositiveIntEnv('0'), undefined);
  assert.equal(parsePositiveIntEnv('-1'), undefined);
  assert.equal(parsePositiveIntEnv('1.5'), undefined);
  assert.equal(parsePositiveIntEnv('abc'), undefined);
  assert.equal(parsePositiveIntEnv(undefined), undefined);
});
