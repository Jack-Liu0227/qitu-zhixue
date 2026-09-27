import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelGatewayError } from '../model-registry/model-gateway.errors';
import type {
  ModelCompletionRequest,
  ModelCompletionResult,
} from '../model-registry/model-gateway.types';
import { TutorService, type StreamedTutorEvent } from './tutor.service';
import type { TutorModelGateway } from './gateway-tutor.provider';

/**
 * `TutorService` 接线验证：provider 选择、幂等、审计分类。
 *
 * 直接 `new TutorService(mode, stub)`，不需要 Nest 容器 / 数据库 / 网络。
 */

class StubGateway implements TutorModelGateway {
  readonly calls: Array<{ usageId: string; request: ModelCompletionRequest }> = [];

  constructor(private readonly text: string | null) {}

  complete(usageId: string, request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    this.calls.push({ usageId, request });
    if (this.text === null) {
      return Promise.reject(new ModelGatewayError('MODEL_USAGE_NOT_BOUND', 'usage not bound'));
    }
    return Promise.resolve({
      providerId: 'provider-1',
      modelId: 'model-1',
      api: 'openai-completions',
      text: this.text,
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
  }
}

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<StreamedTutorEvent[]> {
  const events: StreamedTutorEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

test('幂等：同一 idempotencyKey 重放不追加回合、事件逐字节一致', async () => {
  const service = new TutorService('live', new StubGateway('你观察到哪一片叶子最不一样？'));
  const record = service.getOrCreateSession('prj-idem', 'stu-1');
  const request = { content: '叶子发黄', idempotencyKey: 'turn-1', actorId: 'stu-1' };

  const first = await drain(service.runTurn(record, request));
  const turnsAfterFirst = record.turns.length;
  const second = await drain(service.runTurn(record, request));

  assert.equal(record.turns.length, turnsAfterFirst);
  assert.deepEqual(second, first);
  assert.equal(
    service.auditEntries.filter((entry) => entry.action === 'tutor.idempotent_replay').length,
    1,
  );
});

test('live + 未配置：显式 error 事件，审计记为普通回合而非拦截', async () => {
  const service = new TutorService('live', new StubGateway(null));
  const record = service.getOrCreateSession('prj-unconfigured', 'stu-1');

  const events = await drain(
    service.runTurn(record, { content: '你好', idempotencyKey: 'turn-1', actorId: 'stu-1' }),
  );

  const error = events.find((streamed) => streamed.event.type === 'error');
  assert.ok(error && error.event.type === 'error');
  assert.equal(error.event.code, 'MODEL_NOT_CONFIGURED');
  assert.deepEqual(
    service.auditEntries.map((entry) => entry.action),
    ['tutor.session_start', 'tutor.turn'],
  );
});

test('live + 答案泄露：审计记为 guard_block', async () => {
  const service = new TutorService('live', new StubGateway('答案是叶绿素减少了，你觉得呢？'));
  const record = service.getOrCreateSession('prj-leak', 'stu-1');

  await drain(
    service.runTurn(record, { content: '为什么', idempotencyKey: 'turn-1', actorId: 'stu-1' }),
  );

  assert.deepEqual(
    service.auditEntries.map((entry) => entry.action),
    ['tutor.session_start', 'tutor.guard_block'],
  );
});

test('demo 模式：使用 Heuristic provider，完全不调用模型网关', async () => {
  const gateway = new StubGateway('不该被用到');
  const service = new TutorService('demo', gateway);
  const record = service.getOrCreateSession('project-demo-001', 'stu-1');

  const events = await drain(
    service.runTurn(record, { content: '帮我看看', idempotencyKey: 'turn-1', actorId: 'stu-1' }),
  );

  assert.equal(gateway.calls.length, 0);
  assert.equal(events.some((streamed) => streamed.event.type === 'error'), false);
  assert.equal(
    service.auditEntries.some((entry) => entry.action === 'tutor.turn'),
    true,
  );
});
