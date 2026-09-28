import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditWriter } from '../../common/audit/audit.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type {
  IdempotencyResult,
  IdempotentHandler,
} from '../../common/idempotency/idempotency.types';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import {
  LEARNING_PROGRESS_STALL_SOURCE,
  LEARNING_STALL_ESCALATION_THRESHOLD,
} from './learning-stall-signal';
import { StaticReminderDeliveryGate } from './reminder.gate';
import { ReminderService } from './reminder.service';
import { InMemoryReminderStore } from './reminder.store.memory';

/**
 * 学习进度提醒服务（ISSUE-T2）聚焦验证。
 *
 * 全部直接注入内存假件，不需要 Nest 容器 / 数据库 / 网络：
 * - 门禁关闭时 fail-closed；
 * - 唯一触发源 + 阈值 + 去重；
 * - opt-out 被尊重；
 * - 跨学生统一 404；
 * - 写操作幂等；
 * - 审计只含元数据。
 */

class FakeIdempotencyStore extends IdempotencyStore {
  private readonly executed = new Map<
    string,
    { requestHash: string; result: IdempotencyResult<unknown> }
  >();
  handlerRuns = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
  ): Promise<IdempotencyResult<T>> {
    const composite = `${scope}::${key}`;
    const existing = this.executed.get(composite);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '同 key 不同载荷');
      }
      return { ...(existing.result as IdempotencyResult<T>), replayed: true };
    }
    this.handlerRuns += 1;
    const produced = await handler();
    const result: IdempotencyResult<T> = {
      status: produced.status ?? 200,
      body: produced.body,
      replayed: false,
    };
    this.executed.set(composite, { requestHash, result: result as IdempotencyResult<unknown> });
    return result;
  }
}

class FakeAuditWriter extends AuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

/** 让 `ingestStallSignal` 内部的 fire-and-forget 微任务跑完。 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeService(
  approved: boolean,
): { service: ReminderService; store: InMemoryReminderStore; audit: FakeAuditWriter; idem: FakeIdempotencyStore } {
  const store = new InMemoryReminderStore();
  const audit = new FakeAuditWriter();
  const idem = new FakeIdempotencyStore();
  const service = new ReminderService(
    store,
    idem,
    audit,
    new StaticReminderDeliveryGate(approved),
  );
  return { service, store, audit, idem };
}

const STUDENT = 'stu-a';
const OTHER = 'stu-b';

test('门禁关闭：不生成、不返回任何提醒（fail-closed）', async () => {
  const { service, store } = makeService(false);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();

  assert.equal((await store.listPending(STUDENT, new Date())).length, 0);
  assert.deepEqual(await service.listForStudent(STUDENT), {
    reminders: [],
    deliveryEnabled: false,
    optedOut: false,
  });
});

test('达到阈值才生成；同一停滞事实重复上报只生成一条', async () => {
  const { service } = makeService(true);
  const signal = {
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  } as const;

  service.ingestStallSignal({ ...signal, stallCount: LEARNING_STALL_ESCALATION_THRESHOLD - 1 });
  service.ingestStallSignal(signal);
  service.ingestStallSignal(signal);
  await settle();

  const result = await service.listForStudent(STUDENT);
  assert.equal(result.deliveryEnabled, true);
  assert.equal(result.optedOut, false);
  assert.equal(result.reminders.length, 1);
  const reminder = result.reminders[0]!;
  assert.equal(reminder.source, LEARNING_PROGRESS_STALL_SOURCE);
  assert.equal(reminder.category, 'rest_suggestion');
  // 已渲染文案里不得出现任何医疗 / 情绪 / 风险字眼。
  assert.match(reminder.title, /歇|帮忙|卡住/);
});

test('来源不在白名单：静默忽略', async () => {
  const { service, store } = makeService(true);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: 9,
    // 故意绕过类型，模拟外部伪造来源。
    source: 'emotion_inference' as never,
  });
  await settle();
  assert.equal((await store.listPending(STUDENT, new Date())).length, 0);
});

test('opt-out：不再投递，且新停滞信号不生成提醒', async () => {
  const { service, store } = makeService(true);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();

  const preference = await service.setPreference(STUDENT, { optedOut: true }, 'pref-1');
  assert.equal(preference.optedOut, true);

  const afterOptOut = await service.listForStudent(STUDENT);
  assert.deepEqual(afterOptOut, { reminders: [], deliveryEnabled: true, optedOut: true });

  // opt-out 之后到来的停滞信号不得生成新提醒。
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD + 2,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();
  assert.equal((await store.listPending(STUDENT, new Date())).length, 1);
});

test('跨学生 dismiss 统一 404，不泄露提醒是否存在', async () => {
  const { service } = makeService(true);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();
  const reminderId = (await service.listForStudent(STUDENT)).reminders[0]!.reminderId;

  await assert.rejects(
    service.dismiss(OTHER, reminderId, 'k-other'),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error.getResponse() as { code: string }).code, 'REMINDER_NOT_FOUND');
      return true;
    },
  );

  // 不存在的 id 与越权返回同一个码。
  await assert.rejects(
    service.dismiss(OTHER, 'does-not-exist', 'k-missing'),
    (error: unknown) =>
      error instanceof NotFoundException &&
      (error.getResponse() as { code: string }).code === 'REMINDER_NOT_FOUND',
  );
});

test('dismiss 幂等：同 key 重放不重复审计、不重复改状态', async () => {
  const { service, audit, idem } = makeService(true);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();
  const reminderId = (await service.listForStudent(STUDENT)).reminders[0]!.reminderId;

  const first = await service.dismiss(STUDENT, reminderId, 'dismiss-1');
  const second = await service.dismiss(STUDENT, reminderId, 'dismiss-1');

  assert.equal(idem.handlerRuns, 1);
  assert.equal(first.dismissedAt, second.dismissedAt);
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0]!.action, 'reminder.dismissed');
  // dismiss 后不再出现在待投递列表。
  assert.equal((await service.listForStudent(STUDENT)).reminders.length, 0);
});

test('审计只含元数据，不含原始对话 / 语音 / 推断标签', async () => {
  const { service, audit } = makeService(true);
  service.ingestStallSignal({
    studentId: STUDENT,
    stallCount: LEARNING_STALL_ESCALATION_THRESHOLD + 1,
    source: LEARNING_PROGRESS_STALL_SOURCE,
  });
  await settle();
  const reminderId = (await service.listForStudent(STUDENT)).reminders[0]!.reminderId;
  await service.dismiss(STUDENT, reminderId, 'dismiss-audit');
  await service.setPreference(STUDENT, { optedOut: true }, 'pref-audit');

  assert.equal(audit.entries.length, 2);
  const serialized = JSON.stringify(audit.entries);
  for (const forbidden of [
    'rawConversation',
    'conversation',
    'voice',
    'transcript',
    'content',
    'riskLevel',
    'emotion',
    'diagnosis',
    'modelInference',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `审计不应包含 ${forbidden}`);
  }
  // 只含来源元数据。
  assert.equal(audit.entries[0]!.detail?.source, LEARNING_PROGRESS_STALL_SOURCE);
  assert.equal(audit.entries[0]!.targetType, 'student_reminder');
  assert.equal(audit.entries[1]!.targetType, 'student_reminder_preference');
});

test('optedOut 非布尔值：400 + 稳定错误码，且不消耗幂等键', async () => {
  const { service, idem } = makeService(true);
  await assert.rejects(
    service.setPreference(STUDENT, { optedOut: 'yes' as never }, 'pref-bad'),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code: string }).code, 'REMINDER_PREFERENCE_INVALID');
      return true;
    },
  );
  assert.equal(idem.handlerRuns, 0);
});
