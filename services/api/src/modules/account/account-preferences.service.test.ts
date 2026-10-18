import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type {
  IdempotencyExecuteOptions,
  IdempotencyResult,
  IdempotentHandler,
} from '../../common/idempotency/idempotency.types';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { AccountPreferencesService } from './account-preferences.service';
import { parsePreferenceUpdate } from './account-preferences.values';
import { PreferenceStore, type PreferenceRecord } from './account-preferences.types';

/**
 * T4 基础偏好服务单测（ISSUE-T4 / #9）。
 *
 * 覆盖验收要求：允许值校验、self-only（忽略目标账号字段）、幂等（重放 / 冲突 /
 * 按账号隔离 scope）、fail-closed（无持久化 503）、局部合并与审计。
 *
 * 这些测试在 `pnpm --filter @qitu/api test` 下运行：`tsconfig` 编译到
 * `.tmp/test-dist` 后由 `node --test` 执行 `modules/account/**`。
 */

const ACTOR: CurrentUser = {
  id: 'stu-1',
  email: 'stu1@example.com',
  displayName: '学生一',
  role: 'student',
};

const OTHER: CurrentUser = {
  id: 'stu-2',
  email: 'stu2@example.com',
  displayName: '学生二',
  role: 'student',
};

class FakePreferenceStore extends PreferenceStore {
  readonly records = new Map<string, PreferenceRecord>();
  writes = 0;

  async get(userId: string): Promise<PreferenceRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async upsert(record: PreferenceRecord): Promise<PreferenceRecord> {
    this.writes += 1;
    this.records.set(record.userId, record);
    return record;
  }
}

/** 忠实实现 `(scope, key)` 重放/冲突语义的内存幂等替身。 */
class FakeIdempotencyStore extends IdempotencyStore {
  private readonly done = new Map<string, { hash: string; status: number; body: unknown }>();
  executions = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    _options?: IdempotencyExecuteOptions,
  ): Promise<IdempotencyResult<T>> {
    const id = `${scope}::${key}`;
    const existing = this.done.get(id);
    if (existing) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '同 key 不同载荷');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    const status = outcome.status ?? 200;
    this.done.set(id, { hash: requestHash, status, body: outcome.body });
    return { status, body: outcome.body, replayed: false };
  }
}

class RecordingAuditWriter extends AuditWriter {
  readonly entries: AuditEntry[] = [];

  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

function makeService(store: PreferenceStore | null) {
  const idempotency = new FakeIdempotencyStore();
  const audit = new RecordingAuditWriter();
  const service = new AccountPreferencesService(idempotency, audit, store);
  return { service, idempotency, audit };
}

async function expectHttpError(
  run: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof HttpException, `期望 HttpException，实际 ${String(error)}`);
    assert.equal(error.getStatus(), status);
    const body = error.getResponse();
    const actualCode = typeof body === 'object' && body !== null ? (body as { code?: string }).code : body;
    assert.equal(actualCode, code);
    return true;
  });
}

/* ==================== 允许值校验 ==================== */

test('parsePreferenceUpdate 只接受允许的字号与主题', () => {
  assert.deepEqual(parsePreferenceUpdate({ fontSize: 'lg', theme: 'calm' }), {
    fontSize: 'lg',
    theme: 'calm',
  });
  for (const bad of ['xl', 'LARGE', '', 12, null]) {
    assert.throws(() => parsePreferenceUpdate({ fontSize: bad }));
  }
  for (const bad of ['neon', 'default ', 1, null]) {
    assert.throws(() => parsePreferenceUpdate({ theme: bad }));
  }
});

test('parsePreferenceUpdate 拒绝非布尔的动效 / 通知，并忽略未知字段', () => {
  assert.throws(() => parsePreferenceUpdate({ reducedMotion: 'yes' }));
  assert.throws(() => parsePreferenceUpdate({ notifications: 1 }));
  assert.deepEqual(parsePreferenceUpdate({ userId: 'other', targetUserId: 'other' }), {});
});

test('update 非法值时返回 400 PREFERENCE_INVALID', async () => {
  const { service } = makeService(new FakePreferenceStore());
  await expectHttpError(() => service.update(ACTOR, { fontSize: 'xl' }, 'k1'), 400, 'PREFERENCE_INVALID');
  await expectHttpError(() => service.update(ACTOR, { theme: '#ff0000' }, 'k2'), 400, 'PREFERENCE_INVALID');
  await expectHttpError(
    () => service.update(ACTOR, { reducedMotion: 'true' }, 'k3'),
    400,
    'PREFERENCE_INVALID',
  );
  await expectHttpError(() => service.update(ACTOR, { updatedAt: '2020-01-01' }, 'k4'), 400, 'PREFERENCE_INVALID');
});

/* ==================== 读取与默认值 ==================== */

test('无记录时读取返回契约默认值且不写库', async () => {
  const store = new FakePreferenceStore();
  const { service } = makeService(store);
  const prefs = await service.get(ACTOR);
  assert.deepEqual(prefs, {
    fontSize: 'md',
    theme: 'default',
    reducedMotion: false,
    notifications: true,
    updatedAt: null,
  });
  assert.equal(store.writes, 0);
});

test('已落库记录按账号返回', async () => {
  const store = new FakePreferenceStore();
  store.records.set(ACTOR.id, {
    userId: ACTOR.id,
    fontSize: 'lg',
    theme: 'focus',
    reducedMotion: true,
    notifications: false,
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  });
  const { service } = makeService(store);
  const prefs = await service.get(ACTOR);
  assert.equal(prefs.fontSize, 'lg');
  assert.equal(prefs.theme, 'focus');
  assert.equal(prefs.reducedMotion, true);
  assert.equal(prefs.notifications, false);
  assert.equal(prefs.updatedAt, '2025-01-01T00:00:00.000Z');
});

/* ==================== self-only ==================== */

test('self-only：请求体里的目标账号字段被忽略，只写会话身份', async () => {
  const store = new FakePreferenceStore();
  const { service } = makeService(store);

  await service.update(
    ACTOR,
    { fontSize: 'lg', userId: OTHER.id, targetUserId: OTHER.id, updatedAt: '1999-01-01' },
    'key-self',
  );

  assert.equal(store.records.get(ACTOR.id)?.fontSize, 'lg');
  assert.equal(store.records.get(OTHER.id), undefined);
  assert.equal((await service.get(OTHER)).fontSize, 'md');
});

/* ==================== 幂等 ==================== */

test('同 key 同载荷重放：只写一次库、只写一次审计', async () => {
  const store = new FakePreferenceStore();
  const { service, idempotency, audit } = makeService(store);

  const first = await service.update(ACTOR, { fontSize: 'lg' }, 'key-1');
  const second = await service.update(ACTOR, { fontSize: 'lg' }, 'key-1');

  assert.equal(idempotency.executions, 1);
  assert.equal(store.writes, 1);
  assert.equal(audit.entries.length, 1);
  assert.deepEqual(second, first);
});

test('同 key 不同载荷返回 409 IDEMPOTENCY_CONFLICT', async () => {
  const { service } = makeService(new FakePreferenceStore());
  await service.update(ACTOR, { fontSize: 'lg' }, 'key-x');
  await expectHttpError(
    () => service.update(ACTOR, { fontSize: 'sm' }, 'key-x'),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
});

test('幂等 scope 按账号隔离：不同账号同 key 各自执行且不串数据', async () => {
  const store = new FakePreferenceStore();
  const { service, idempotency } = makeService(store);

  await service.update(ACTOR, { theme: 'calm' }, 'shared-key');
  await service.update(OTHER, { theme: 'focus' }, 'shared-key');

  assert.equal(idempotency.executions, 2);
  assert.equal((await service.get(ACTOR)).theme, 'calm');
  assert.equal((await service.get(OTHER)).theme, 'focus');
});

/* ==================== 局部合并与审计 ==================== */

test('局部更新与既有值合并且审计只记变更字段名', async () => {
  const store = new FakePreferenceStore();
  const { service, audit } = makeService(store);

  await service.update(ACTOR, { fontSize: 'lg', reducedMotion: true }, 'seed');
  const changed = await service.update(ACTOR, { theme: 'focus' }, 'later');

  assert.equal(changed.fontSize, 'lg');
  assert.equal(changed.reducedMotion, true);
  assert.equal(changed.theme, 'focus');

  const last = audit.entries.at(-1);
  assert.equal(last?.action, 'account.preferences.updated');
  assert.equal(last?.targetType, 'user_preferences');
  assert.equal(last?.targetId, ACTOR.id);
  assert.deepEqual(last?.detail, { changed: ['theme'] });
});

/* ==================== fail-closed ==================== */

test('未配置持久化时读 / 写都返回 503 PREFERENCE_UNAVAILABLE', async () => {
  const { service } = makeService(null);
  await expectHttpError(() => service.get(ACTOR), 503, 'PREFERENCE_UNAVAILABLE');
  await expectHttpError(
    () => service.update(ACTOR, { fontSize: 'lg' }, 'key-503'),
    503,
    'PREFERENCE_UNAVAILABLE',
  );
});
