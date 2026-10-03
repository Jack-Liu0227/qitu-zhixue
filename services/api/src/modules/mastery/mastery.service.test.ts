import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import type { AccessPolicy } from '../../common/access/access-policy';
import { LearningPlanStorageModule } from '../learning-plan/learning-plan-storage.module';
import { LearningPlanModule } from '../learning-plan/learning-plan.module';
import {
  InMemoryLearningPlanStore,
  LearningPlanStore,
  type MasteryEventRecord,
} from '../learning-plan/learning-plan.store';
import { MasteryModule } from './mastery.module';
import { MasteryReadService } from './mastery.service';

const actor: CurrentUser = {
  id: 'student-1',
  email: 'student@example.com',
  displayName: 'student',
  role: 'student',
};
const date = (day: string) => new Date(`2026-01-${day}T00:00:00.000Z`);

function event(
  id: string,
  day: string,
  overrides: Partial<MasteryEventRecord> = {},
): MasteryEventRecord {
  return {
    id,
    schoolId: null,
    studentId: actor.id,
    knowledgePointId: 'kp-1',
    courseVersion: 'v1',
    objectiveId: 'objective-1',
    planId: 'plan-1',
    projectId: null,
    eventType: 'assessed',
    knowledgeType: 'procedure',
    score: 0.95,
    confidence: null,
    qualitativeMastered: null,
    validFrom: date(day),
    recordedAt: date(day),
    sequence: Number(day),
    evidenceRefs: ['attempt:1'],
    sourceType: 'quiz',
    sourceEventId: `attempt-${id}`,
    causationId: null,
    correlationId: null,
    supersedesEventId: null,
    assessmentVersion: 'mastery.v1',
    idempotencyKey: id,
    ...overrides,
  };
}

async function harness(events: MasteryEventRecord[], allowed = true) {
  const store = new InMemoryLearningPlanStore();
  for (const item of events) await store.appendMasteryEvent(item);
  let reads = 0;
  const original = store.listMasteryEvents.bind(store);
  store.listMasteryEvents = async (input) => {
    reads += 1;
    return original(input);
  };
  const access = { canReadStudent: async () => allowed } as unknown as AccessPolicy;
  return { store, service: new MasteryReadService(store, access), reads: () => reads };
}

async function httpError(work: () => Promise<unknown>, status: number, code: string) {
  await assert.rejects(work, (error: unknown) => {
    const http = error as { getStatus(): number; getResponse(): { code: string } };
    assert.equal(http.getStatus(), status);
    assert.equal(http.getResponse().code, code);
    return true;
  });
}

describe('MasteryReadService', () => {
  it('全量 current/snapshot/regressions 不依赖当前 projection 或知识点列表', async () => {
    const { service } = await harness([
      event('a', '01'),
      event('b', '03', { score: 0.5 }),
      event('c', '02', { knowledgePointId: 'kp-2' }),
      event('foreign', '02', { studentId: 'other-student' }),
    ]);
    const current = await service.getCurrent(actor, { validAt: date('04').toISOString() });
    assert.equal(current.current.length, 2);
    assert.equal(current.current.find((p) => p.knowledgePointId === 'kp-1')?.score, 0.5);
    const snapshot = await service.getSnapshot(actor, { validAt: date('02').toISOString() });
    assert.equal(snapshot.points.length, 2);
    assert.equal(snapshot.points.find((p) => p.knowledgePointId === 'kp-1')?.score, 0.95);
    const regression = await service.getRegressionAlerts(actor, {
      since: date('02').toISOString(),
    });
    assert.equal(regression.items.length, 1, '窗口前的已知状态用于比较');
  });

  it('knownAt 与 validAt 分开，历史 current 和 threshold 不读取最新状态', async () => {
    const { service } = await harness([
      event('a', '01'),
      event('late', '02', { recordedAt: date('05'), score: 0.4 }),
    ]);
    const before = {
      knowledgePointId: 'kp-1',
      validAt: date('03').toISOString(),
      knownAt: date('04').toISOString(),
    };
    const after = { ...before, knownAt: date('06').toISOString() };
    assert.equal((await service.getCurrent(actor, before)).current[0]?.score, 0.95);
    assert.equal((await service.getCurrent(actor, after)).current[0]?.score, 0.4);
    assert.equal((await service.getThreshold(actor, before)).threshold.met, true);
    assert.equal((await service.getThreshold(actor, after)).threshold.met, false);
  });

  it('课程版本各自推导 validTo，不发生跨版本退步比较', async () => {
    const { service } = await harness([
      event('a', '01'),
      event('b', '02', { courseVersion: 'v2', score: 0.1 }),
      event('c', '03', { score: 0.8 }),
    ]);
    const timeline = await service.getTimeline(actor, { knowledgePointId: 'kp-1' });
    assert.equal(timeline.items.find((p) => p.eventId === 'a')?.validTo, date('03').toISOString());
    assert.equal(timeline.items.find((p) => p.eventId === 'b')?.validTo, null);
    assert.equal((await service.getRegressionAlerts(actor, {})).items.length, 1);
    await httpError(
      () => service.getThreshold(actor, { knowledgePointId: 'kp-1' }),
      409,
      'MASTERY_VERSION_MISMATCH',
    );
    assert.equal(
      (await service.getThreshold(actor, { knowledgePointId: 'kp-1', courseVersion: 'v2' }))
        .threshold.met,
      false,
    );
  });

  it('未知与撤销不填0，不解释为实测退步；撤销不能过门槛', async () => {
    const { service } = await harness([
      event('a', '01'),
      event('unknown', '02', { score: null }),
      event('recover', '03'),
      event('revoke', '04', { eventType: 'revoked' }),
    ]);
    const timeline = await service.getTimeline(actor, { knowledgePointId: 'kp-1' });
    assert.equal(timeline.items.find((p) => p.eventId === 'unknown')?.score, null);
    assert.equal(timeline.items.at(-1)?.score, null);
    assert.equal(timeline.items.at(-1)?.status, 'new');
    assert.equal((await service.getRegressionAlerts(actor, {})).items.length, 0);
    assert.equal(
      (await service.getThreshold(actor, { knowledgePointId: 'kp-1' })).threshold.met,
      false,
    );
  });

  it('concept/design 不凭量化分过关，质化失去掌握可以检测', async () => {
    const { service } = await harness([
      event('a', '01', { knowledgeType: 'concept', qualitativeMastered: true, score: 1 }),
      event('b', '02', { knowledgeType: 'concept', qualitativeMastered: false, score: 1 }),
    ]);
    const result = await service.getThreshold(actor, { knowledgePointId: 'kp-1' });
    assert.equal(result.threshold.current?.score, null);
    assert.equal(result.threshold.threshold.value, null);
    assert.equal(result.threshold.met, false);
    assert.equal((await service.getRegressionAlerts(actor, {})).items[0]?.kind, 'mastery_lost');
  });

  it('同一有效时刻的更正只取已知最新值，不更改事件账本', async () => {
    const { store, service } = await harness([
      event('a', '01'),
      event('correct', '01', {
        sequence: 2,
        recordedAt: date('03'),
        eventType: 'corrected',
        score: 0.2,
        supersedesEventId: 'a',
      }),
    ]);
    assert.equal(
      (await service.getCurrent(actor, { knownAt: date('02').toISOString() })).current[0]?.score,
      0.95,
    );
    assert.equal(
      (await service.getCurrent(actor, { knownAt: date('04').toISOString() })).current[0]?.score,
      0.2,
    );
    assert.equal((await store.listMasteryEvents({ studentUserId: actor.id })).length, 2);
  });

  it('游标可继续翻页，未来点关闭区间但不在 validAt 截止页出现', async () => {
    const { service } = await harness([event('a', '01'), event('b', '02'), event('c', '03')]);
    const first = await service.getTimeline(actor, { knowledgePointId: 'kp-1', limit: 1 });
    assert.equal(first.nextCursor, 'a');
    const next = await service.getTimeline(actor, {
      knowledgePointId: 'kp-1',
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(next.items[0]?.eventId, 'b');
    const cutoff = await service.getTimeline(actor, {
      knowledgePointId: 'kp-1',
      validAt: date('01').toISOString(),
    });
    assert.equal(cutoff.items.length, 1);
    assert.equal(cutoff.items[0]?.validTo, date('02').toISOString());
    await httpError(
      () => service.getTimeline(actor, { knowledgePointId: 'kp-1', cursor: 'other' }),
      400,
      'MASTERY_INPUT_INVALID',
    );
  });

  it('拒绝无时区/非法时间和无效 limit，缺失评估不虚构目标类型', async () => {
    const { service } = await harness([]);
    for (const validAt of ['bad', '2026-01-01', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z']) {
      await httpError(() => service.getCurrent(actor, { validAt }), 400, 'MASTERY_INPUT_INVALID');
    }
    await httpError(
      () => service.getTimeline(actor, { knowledgePointId: 'kp-1', limit: NaN }),
      400,
      'MASTERY_INPUT_INVALID',
    );
    await httpError(
      () => service.getThreshold(actor, { knowledgePointId: 'kp-1' }),
      404,
      'MASTERY_NOT_FOUND',
    );
  });

  it('授权失败先于数据读取，包含监护撤销、非当前教师、跨学生和管理员', async () => {
    const { service, reads } = await harness([event('a', '01')], false);
    for (const role of ['student', 'parent', 'teacher', 'admin'] as const) {
      await httpError(
        () => service.getCurrent({ ...actor, role }, { studentId: 'target' }),
        403,
        'MASTERY_FORBIDDEN',
      );
    }
    assert.equal(reads(), 0);
  });

  it('授权家长投影不返回证据引用，教师读取仍由 AccessPolicy 判定', async () => {
    const { service } = await harness([event('a', '01')]);
    const input = { studentId: actor.id, knowledgePointId: 'kp-1' };
    const parent = await service.getTimeline({ ...actor, id: 'guardian', role: 'parent' }, input);
    assert.deepEqual(parent.items[0]?.evidenceRefs, []);
    const teacher = await service.getTimeline({ ...actor, id: 'mentor', role: 'teacher' }, input);
    assert.deepEqual(teacher.items[0]?.evidenceRefs, ['attempt:1']);
  });

  it('MasteryModule 复用 LearningPlanModule 导出的同一 store，不另建实例', () => {
    assert.ok(Reflect.getMetadata('exports', LearningPlanStorageModule).includes(LearningPlanStore));
    assert.ok(Reflect.getMetadata('exports', LearningPlanModule).includes(LearningPlanStorageModule));
    assert.ok(Reflect.getMetadata('imports', MasteryModule).includes(LearningPlanStorageModule));
    assert.ok(!Reflect.getMetadata('providers', MasteryModule).includes(LearningPlanStore));
  });
});
