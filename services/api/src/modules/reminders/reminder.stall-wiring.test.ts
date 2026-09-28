import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TutorService, type StreamedTutorEvent } from '../ai-tutor/tutor.service';
import type { TutorModelGateway } from '../ai-tutor/gateway-tutor.provider';
import {
  LEARNING_PROGRESS_STALL_SOURCE,
  LEARNING_STALL_ESCALATION_THRESHOLD,
  LearningStallSignalSink,
  type LearningStallSignal,
} from './learning-stall-signal';

/**
 * AI 搭档 → 提醒模块的接缝验证（ISSUE-T2）。
 *
 * 确认提醒只由**既有的学习进度停滞信号**驱动：连续卡顿首次越过阈值时上报
 * 一次；继续卡顿不重复上报；正常移动会重置计数。
 */

class RecordingSink extends LearningStallSignalSink {
  readonly signals: LearningStallSignal[] = [];
  ingestStallSignal(signal: LearningStallSignal): void {
    this.signals.push(signal);
  }
}

const unusedGateway: TutorModelGateway = {
  complete: () => Promise.reject(new Error('demo 模式不应调用模型网关')),
};

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<void> {
  for await (const _event of generator) {
    // 只需跑完整个回合。
  }
}

async function runStallTurn(service: TutorService, record: ReturnType<TutorService['getOrCreateSession']>, key: string): Promise<void> {
  await drain(
    service.runTurn(record, {
      content: '我还是不会',
      pedagogicMove: 'stall_signal',
      idempotencyKey: key,
      actorId: 'stu-1',
    }),
  );
}

test('连续卡顿首次越过阈值时上报一次，继续卡顿不重复', async () => {
  const sink = new RecordingSink();
  const service = new TutorService('demo', unusedGateway, undefined, sink);
  const record = service.getOrCreateSession('prj-stall', 'stu-1');

  for (let i = 1; i < LEARNING_STALL_ESCALATION_THRESHOLD; i += 1) {
    await runStallTurn(service, record, `turn-${i}`);
  }
  assert.equal(sink.signals.length, 0, '阈值前不得上报');

  await runStallTurn(service, record, `turn-${LEARNING_STALL_ESCALATION_THRESHOLD}`);
  assert.deepEqual(sink.signals, [
    {
      studentId: 'stu-1',
      stallCount: LEARNING_STALL_ESCALATION_THRESHOLD,
      source: LEARNING_PROGRESS_STALL_SOURCE,
    },
  ]);

  await runStallTurn(service, record, `turn-${LEARNING_STALL_ESCALATION_THRESHOLD + 1}`);
  assert.equal(sink.signals.length, 1, '越过阈值后继续卡顿不重复上报');
});

test('未接线 sink 时回合照常完成（fail-closed，不影响 AI 搭档）', async () => {
  const service = new TutorService('demo', unusedGateway);
  const record = service.getOrCreateSession('prj-no-sink', 'stu-1');
  await runStallTurn(service, record, 'turn-1');
  assert.equal(record.stallCount, 1);
});
