import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RedisAdapter } from '@qitu/infra';
import {
  PROBE_TIMEOUT_MS,
  decideReadiness,
  probeDatabase,
  probeRedis,
  withTimeout,
  type DependencyProbe,
  type ReadinessInput,
} from './health.readiness';

/**
 * 就绪探针的判定规则必须钉住：它决定编排层摘不摘流量。
 * 把「数据库挂了」和「Redis 没配」判成同一个结果，是本次修复要避免的原始问题。
 */

const ok: DependencyProbe = { status: 'ok' };
const dbError: DependencyProbe = { status: 'error', detail: '数据库连接失败' };
const redisError: DependencyProbe = { status: 'error', detail: 'Redis 连接失败' };
const none: DependencyProbe = { status: 'not_configured' };

function decide(partial: Partial<ReadinessInput>): ReadinessInput {
  return { dataMode: 'live', database: ok, redis: ok, ...partial };
}

describe('decideReadiness', () => {
  it('live + 依赖全通 → ready / 200', () => {
    assert.deepEqual(decideReadiness(decide({})), { status: 'ready', httpStatus: 200 });
  });

  it('live + 数据库不可用 → not_ready / 503（Postgres 是唯一事实源）', () => {
    assert.deepEqual(decideReadiness(decide({ database: dbError })), {
      status: 'not_ready',
      httpStatus: 503,
    });
  });

  it('Redis 不可用只降级，不摘流量 → degraded / 200', () => {
    assert.deepEqual(decideReadiness(decide({ redis: redisError })), {
      status: 'degraded',
      httpStatus: 200,
    });
  });

  it('live 未配置 Redis → degraded / 200（与「Redis 失败不阻断启动」的既有决策一致）', () => {
    assert.deepEqual(decideReadiness(decide({ redis: none })), {
      status: 'degraded',
      httpStatus: 200,
    });
  });

  it('demo / test 不使用 Postgres 与 Redis，未配置不算故障 → ready / 200', () => {
    for (const dataMode of ['demo', 'test'] as const) {
      assert.deepEqual(decideReadiness(decide({ dataMode, database: none, redis: none })), {
        status: 'ready',
        httpStatus: 200,
      });
    }
  });

  it('非 live 模式下数据库报错也不摘流量（本地/CI 不应永远 not_ready）', () => {
    assert.deepEqual(decideReadiness(decide({ dataMode: 'test', database: dbError })), {
      status: 'degraded',
      httpStatus: 200,
    });
  });

  it('数据库优先于 Redis：两者都挂时只报 not_ready', () => {
    assert.deepEqual(decideReadiness(decide({ database: dbError, redis: redisError })), {
      status: 'not_ready',
      httpStatus: 503,
    });
  });
});

describe('withTimeout', () => {
  it('原 promise 先完成时正常返回', async () => {
    assert.equal(await withTimeout(Promise.resolve('value'), 1000), 'value');
  });

  it('原 promise 拒绝时原样抛出', async () => {
    await assert.rejects(() => withTimeout(Promise.reject(new Error('boom')), 1000), /boom/);
  });

  it('超时按失败处理，不把探针自己挂住', async () => {
    await assert.rejects(
      () => withTimeout(new Promise<never>(() => {}), 10),
      /探活超时/,
    );
  });

  it('默认超时是有限值（防止误改成无限等待）', () => {
    assert.equal(Number.isFinite(PROBE_TIMEOUT_MS), true);
    assert.equal(PROBE_TIMEOUT_MS > 0 && PROBE_TIMEOUT_MS <= 10_000, true);
  });
});

describe('probeDatabase', () => {
  it('未绑定数据库（demo/test）→ not_configured', async () => {
    assert.deepEqual(await probeDatabase(null), {
      status: 'not_configured',
      detail: '当前数据模式不使用 Postgres（demo/test）',
    });
  });

  it('绑定且 select 1 成功 → ok', async () => {
    const db = { execute: async () => [{ '?column?': 1 }] };
    assert.deepEqual(await probeDatabase(db as never), { status: 'ok' });
  });

  it('查询抛错时向外抛（由控制器记录原因并回稳定文案）', async () => {
    const db = {
      execute: async () => {
        throw new Error('connect ECONNREFUSED postgresql://qitu:secret@10.0.0.5:5432/qitu_dev');
      },
    };
    await assert.rejects(() => probeDatabase(db as never), /ECONNREFUSED/);
  });
});

describe('probeRedis', () => {
  const adapter = (value: Partial<RedisAdapter>): RedisAdapter => value as unknown as RedisAdapter;

  it('noop（demo/test 未配置）→ not_configured', async () => {
    assert.equal((await probeRedis(adapter({ kind: 'noop' }))).status, 'not_configured');
  });

  it('unavailable（live 未配置）→ error，但只是降级', async () => {
    const probe = await probeRedis(adapter({ kind: 'unavailable' }));
    assert.equal(probe.status, 'error');
    assert.equal(probe.detail?.includes('REDIS_URL'), true);
  });

  it('真实适配器 PING 成功 → ok', async () => {
    const probe = await probeRedis(adapter({ kind: 'redis', ping: async () => 'PONG' }));
    assert.deepEqual(probe, { status: 'ok' });
  });

  it('PING 抛错时向外抛（不吞掉异常）', async () => {
    const probe = adapter({
      kind: 'redis',
      ping: async () => {
        throw new Error('Redis connection is closed');
      },
    });
    await assert.rejects(() => probeRedis(probe), /closed/);
  });
});
