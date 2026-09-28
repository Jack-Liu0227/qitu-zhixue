import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import type { ConfirmIntentResponse, CreateExplorationRequest } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { InMemoryExplorationStore } from './exploration.store';
import { ProjectsService } from './projects.service';

/* ------------------------------------------------------------------ *
 * 测试替身
 * ------------------------------------------------------------------ */

/**
 * `IdempotencyStore` 的内存替身：与真实实现保持相同的可观察语义——
 * 首次执行并记住 `(scope,key)`，同键同载荷重放，同键异载荷冲突。
 */
class FakeIdempotencyStore {
  private readonly records = new Map<string, { hash: string; body: unknown; status: number }>();
  executions = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const id = `${scope}::${key}`;
    const existing = this.records.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body, status: outcome.status ?? 200 });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

interface Harness {
  service: ProjectsService;
  store: InMemoryExplorationStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
}

function makeHarness(): Harness {
  const store = new InMemoryExplorationStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const service = new ProjectsService(
    store,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  return { service, store, idempotency, audit };
}

const RECOMMENDED: CreateExplorationRequest = {
  source: 'recommended',
  templateVersionId: 'tplv-001',
};

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    const response = httpError.getResponse?.() as { code?: string } | undefined;
    assert.equal(response?.code, code);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('ProjectsService（T6 意图确认）', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('确认前只产生探索 / 草稿，绝不创建正式项目', async () => {
    const { service, store } = harness;

    const created = await service.createExploration('student-1', RECOMMENDED, 'key-create-1');
    assert.equal(created.status, 'exploring');
    assert.equal(created.projectId, null);
    assert.equal(created.source, 'recommended');
    assert.equal(created.templateVersionId, 'tplv-001');
    assert.equal(created.intentDraft?.confirmedAt, null);

    // 写入候选意图后进入「等待确认」，仍然没有项目。
    const awaiting = await service.updateIntentDraft('student-1', created.id, {
      goalUser: '为社区老人做陪伴工具',
      coreInterests: ['适老化', '声音交互'],
      preferredForm: '小程序',
    });
    assert.equal(awaiting.status, 'awaiting_confirmation');
    assert.equal(awaiting.projectId, null);
    assert.equal(
      await store.findProjectByExploration(created.id),
      null,
      '未确认时数据库里不能出现项目实例',
    );
    assert.equal(
      harness.audit.entries.some((entry) => entry.action === 'exploration.confirm_intent'),
      false,
      '未确认时不得出现创建项目的审计',
    );
  });

  it('确认意图后恰好创建一个正式项目，且来源与模板版本被冻结', async () => {
    const { service, store } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    await service.updateIntentDraft('student-1', created.id, {
      goalUser: '为社区老人做陪伴工具',
      coreInterests: ['适老化', '声音交互'],
      preferredForm: '小程序',
    });

    const result = await service.confirmIntent('student-1', created.id, 'confirm-1');
    assert.equal(result.replayed, false);
    assert.equal(result.project.stage, 'intent_confirmed');
    assert.equal(result.project.progress, 11);
    assert.equal(result.exploration.status, 'confirmed');
    assert.equal(result.exploration.projectId, result.project.id);
    assert.ok(result.exploration.intentDraft?.confirmedAt !== null);

    const stored = await store.findProjectByExploration(created.id);
    assert.equal(stored?.id, result.project.id);
    assert.equal(stored?.templateVersionId, 'tplv-001');
    assert.equal(stored?.status, 'intent_confirmed');

    const confirmAudit = harness.audit.entries.find(
      (entry) => entry.action === 'exploration.confirm_intent',
    );
    assert.ok(confirmAudit, '确认创建项目必须写审计');
    assert.equal(confirmAudit?.targetId, result.project.id);
  });

  it('同幂等键重复确认只创建一个项目', async () => {
    const { service, store } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    await service.updateIntentDraft('student-1', created.id, { coreInterests: ['机器人'] });

    const first = await service.confirmIntent('student-1', created.id, 'same-key');
    const second = await service.confirmIntent('student-1', created.id, 'same-key');

    assert.equal(first.project.id, second.project.id);
    assert.equal(second.replayed, true);
    assert.equal(harness.idempotency.executions, 2, '仅创建探索 + 首次确认执行了 handler');
    assert.equal((await store.findProjectByExploration(created.id))?.id, first.project.id);
  });

  it('换幂等键重试同一探索：识别为已创建，不产生第二个项目', async () => {
    const { service } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    await service.updateIntentDraft('student-1', created.id, { coreInterests: ['机器人'] });

    const first = await service.confirmIntent('student-1', created.id, 'key-a');
    const retry = await service.confirmIntent('student-1', created.id, 'key-b');

    assert.equal(retry.replayed, true);
    assert.equal(retry.project.id, first.project.id);
  });

  it('候选意图未确认（仍在 exploring）时确认被拒绝', async () => {
    const { service, store } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    // 直接通过存储写入可确认的草稿，但保持 exploring 状态，模拟绕过草稿阶段。
    await store.updateIntentDraft(
      created.id,
      { coreInterests: ['机器人'] },
      'exploring',
      new Date(),
    );

    await assertHttpError(
      () => service.confirmIntent('student-1', created.id, 'k'),
      409,
      'EXPLORATION_TRANSITION_INVALID',
    );
    assert.equal(await store.findProjectByExploration(created.id), null);
  });

  it('不同学生复用同一幂等键不会串号', async () => {
    const { service } = harness;
    const first = await service.createExploration('student-1', RECOMMENDED, 'shared-key');
    const second = await service.createExploration('student-2', RECOMMENDED, 'shared-key');
    assert.notEqual(first.id, second.id, '幂等 scope 必须绑定学生');
    assert.equal((await service.getExploration('student-1', first.id)).id, first.id);
  });

  it('对象级授权：他人探索一律 404，不泄露存在性', async () => {
    const { service } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');

    await assertHttpError(
      () => service.getExploration('student-2', created.id),
      404,
      'EXPLORATION_NOT_FOUND',
    );
    await assertHttpError(
      () => service.confirmIntent('student-2', created.id, 'k'),
      404,
      'EXPLORATION_NOT_FOUND',
    );
  });

  it('推荐探索必须带模板版本；自由探索不得带模板版本', async () => {
    const { service } = harness;
    await assertHttpError(
      () => service.createExploration('student-1', { source: 'recommended' }, 'k1'),
      400,
      'EXPLORATION_TRANSITION_INVALID',
    );
    await assertHttpError(
      () =>
        service.createExploration(
          'student-1',
          { source: 'free', templateVersionId: 'tplv-x' },
          'k2',
        ),
      400,
      'EXPLORATION_TRANSITION_INVALID',
    );

    const free = await service.createExploration('student-1', { source: 'free' }, 'k3');
    assert.equal(free.source, 'free');
    assert.equal(free.templateVersionId, null);

    await service.updateIntentDraft('student-1', free.id, { coreInterests: ['随手拍'] });
    const confirmed: ConfirmIntentResponse = await service.confirmIntent(
      'student-1',
      free.id,
      'k4',
    );
    assert.equal(confirmed.exploration.source, 'free', '自由探索来源必须保留');
    assert.equal(confirmed.project.stage, 'intent_confirmed');
  });

  it('已确认的探索不能修改草稿，也不能关闭', async () => {
    const { service } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    await service.updateIntentDraft('student-1', created.id, { coreInterests: ['机器人'] });
    await service.confirmIntent('student-1', created.id, 'k');

    await assertHttpError(
      () => service.updateIntentDraft('student-1', created.id, { coreInterests: ['别的'] }),
      409,
      'EXPLORATION_TRANSITION_INVALID',
    );
    await assertHttpError(
      () => service.closeExploration('student-1', created.id),
      409,
      'EXPLORATION_TRANSITION_INVALID',
    );
  });

  it('未确认的探索可以关闭，且关闭后不能再确认', async () => {
    const { service, store } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');
    const closed = await service.closeExploration('student-1', created.id);
    assert.equal(closed.status, 'closed');

    await assertHttpError(
      () => service.confirmIntent('student-1', created.id, 'k'),
      409,
      'EXPLORATION_TRANSITION_INVALID',
    );
    assert.equal(await store.findProjectByExploration(created.id), null);
  });

  it('核心兴趣被规范化：去空、去重、可回退确认状态', async () => {
    const { service } = harness;
    const created = await service.createExploration('student-1', RECOMMENDED, 'c1');

    const awaiting = await service.updateIntentDraft('student-1', created.id, {
      coreInterests: ['  机器人  ', '机器人', '', '  '],
    });
    assert.deepEqual(awaiting.intentDraft?.coreInterests, ['机器人']);
    assert.equal(awaiting.status, 'awaiting_confirmation');

    // 清空兴趣 → 回到 exploring，避免留下可点击的确认入口。
    const back = await service.updateIntentDraft('student-1', created.id, { coreInterests: [] });
    assert.equal(back.status, 'exploring');
  });
});
