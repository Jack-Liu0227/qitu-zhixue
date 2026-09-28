import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { createDb, idempotencyKeys, type Database } from '@qitu/database';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyError } from './idempotency.errors';

/**
 * 针对真实 PostgreSQL（独立 `qitu_test` 库）的幂等行为验证。
 *
 * - **只有 `DATABASE_URL` 存在时才运行**；未设置则整组 skip，不会误连生产库。
 * - `DATABASE_URL` 只从进程环境读取，**不写入任何文件**。
 *
 * 运行示例（连接串仅 inline，不落盘）：
 *
 *   cd services/api
 *   npx tsc -p tsconfig.json
 *   DATABASE_URL='postgres://...' node --test dist/common/idempotency/idempotency.integration.test.js
 */

const connectionString = process.env.DATABASE_URL;
const skip = connectionString ? false : 'DATABASE_URL 未设置：跳过真实数据库幂等集成测试';

describe('IdempotencyService（真实 PostgreSQL）', { skip }, () => {
  let db: Database;
  let service: IdempotencyService;
  // 每次运行使用独立 scope 前缀，只清理自己写入的行，避免打扰共享 qitu_test 上的其他测试。
  const RUN = `itest-${randomUUID()}`;
  const scope = (name: string) => `${RUN}/${name}`;

  before(() => {
    db = createDb(connectionString!);
    service = new IdempotencyService(db);
  });

  after(async () => {
    // 释放连接池，避免 node --test 结束后挂起。
    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (typeof pool?.end === 'function') {
      await pool.end();
    }
  });

  async function clearKeys(): Promise<void> {
    await db.delete(idempotencyKeys).where(like(idempotencyKeys.scope, `${RUN}%`));
  }

  test('首次执行返回 handler 结果并持久化 response_status / response_body', async () => {
    await clearKeys();
    let calls = 0;
    const result = await service.execute(scope('a'), 'k-1', 'h-1', () => {
      calls += 1;
      return { status: 201, body: { id: 'x', ok: true } };
    });

    assert.equal(result.replayed, false);
    assert.deepEqual(result, { status: 201, body: { id: 'x', ok: true }, replayed: false });
    assert.equal(calls, 1);

    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('a')), eq(idempotencyKeys.key, 'k-1')));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'succeeded');
    assert.equal(rows[0]!.responseStatus, 201);
    assert.deepEqual(rows[0]!.responseBody, { id: 'x', ok: true });
  });

  test('同 key 同 hash 重放首个 response，且不重复执行 handler', async () => {
    await clearKeys();
    let calls = 0;
    const handler = () => {
      calls += 1;
      return { body: { id: 'once' } };
    };

    const first = await service.execute(scope('b'), 'k-2', 'h-1', handler);
    const second = await service.execute(scope('b'), 'k-2', 'h-1', handler);

    assert.equal(calls, 1, 'handler 只应执行一次');
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.body, { id: 'once' });
    assert.equal(second.status, 200);
  });

  test('同 key 不同 hash 抛 IDEMPOTENCY_CONFLICT，且不执行 handler', async () => {
    await clearKeys();
    await service.execute(scope('c'), 'k-3', 'h-1', () => ({ body: { id: 'first' } }));

    let calls = 0;
    await assert.rejects(
      () =>
        service.execute(scope('c'), 'k-3', 'h-2', () => {
          calls += 1;
          return { body: { id: 'second' } };
        }),
      (error: unknown) =>
        error instanceof IdempotencyError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(calls, 0);
  });

  test('并发同 key：只有一个执行者，另一个冲突（数据库唯一约束兜底）', async () => {
    await clearKeys();
    let calls = 0;
    const handler = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: 201, body: { id: 'concurrent' } };
    };

    const results = await Promise.allSettled([
      service.execute(scope('d'), 'k-4', 'h-1', handler),
      service.execute(scope('d'), 'k-4', 'h-1', handler),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(calls, 1, '并发下 handler 只能执行一次');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(reason instanceof IdempotencyError);
    assert.equal(reason.code, 'IDEMPOTENCY_CONFLICT');

    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('d')), eq(idempotencyKeys.key, 'k-4')));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'succeeded');
  });

  test('响应体中的 password / token 落库前被脱敏', async () => {
    await clearKeys();
    const result = await service.execute(scope('e'), 'k-5', 'h-1', () => ({
      body: {
        id: 'artifact-1',
        password: 'p@ssw0rd',
        nested: { token: 'secret-token', visible: 'ok' },
      },
    }));

    assert.equal((result.body as { password: unknown }).password, '[REDACTED]');
    assert.deepEqual((result.body as { nested: unknown }).nested, {
      token: '[REDACTED]',
      visible: 'ok',
    });

    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('e')), eq(idempotencyKeys.key, 'k-5')));
    assert.deepEqual(rows[0]!.responseBody, {
      id: 'artifact-1',
      password: '[REDACTED]',
      nested: { token: '[REDACTED]', visible: 'ok' },
    });
  });

  test('failed 记录允许同 hash 重试；成功后状态转为 succeeded', async () => {
    await clearKeys();
    let calls = 0;
    await assert.rejects(
      () =>
        service.execute(scope('f'), 'k-6', 'h-1', () => {
          calls += 1;
          throw new Error('boom');
        }),
      /boom/,
    );

    const failedRows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('f')), eq(idempotencyKeys.key, 'k-6')));
    assert.equal(failedRows[0]!.status, 'failed');

    const retried = await service.execute(scope('f'), 'k-6', 'h-1', () => {
      calls += 1;
      return { body: { ok: true } };
    });
    assert.equal(calls, 2);
    assert.equal(retried.replayed, false);

    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('f')), eq(idempotencyKeys.key, 'k-6')));
    assert.equal(rows[0]!.status, 'succeeded');
  });

  test('cleanupExpired 只清理过期的终态行', async () => {
    await clearKeys();
    await service.execute(scope('g1'), 'k-7', 'h-1', () => ({ body: {} }), {
      retentionMs: -1,
    });
    await service.execute(scope('g2'), 'k-8', 'h-1', () => ({ body: {} }), {
      retentionMs: 60_000,
    });

    const deleted = await service.cleanupExpired();
    // 共享测试库上可能还有别的过期行，只断言「至少清理了本次的过期行」。
    assert.ok(deleted >= 1);
    const gone = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('g1')), eq(idempotencyKeys.key, 'k-7')));
    assert.equal(gone.length, 0);
    const remaining = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope('g2')), eq(idempotencyKeys.key, 'k-8')));
    assert.equal(remaining.length, 1);
  });
});
