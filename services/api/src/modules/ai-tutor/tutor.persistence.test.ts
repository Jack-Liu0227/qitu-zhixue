import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { ModelGatewayError } from '../model-registry/model-gateway.errors';
import type {
  ModelCompletionRequest,
  ModelCompletionResult,
} from '../model-registry/model-gateway.types';
import type {
  AuditEntry as CommonAuditEntry,
} from '../../common/audit';
import { AuditWriter } from '../../common/audit';
import {
  IdempotencyStore,
  type IdempotencyExecuteOptions,
  type IdempotencyResult,
  type IdempotentHandler,
} from '../../common/idempotency';
import type { TutorModelGateway } from './gateway-tutor.provider';
import { InMemoryTutorSessionStore } from './tutor-session.store';
import { TutorService, type StreamedTutorEvent } from './tutor.service';

/**
 * PostgreSQL 会话/回合持久化的聚焦验证。
 *
 * 用**同一个存储实例**重建 `TutorService` 来模拟进程重启：不依赖真库、
 * 不依赖网络，但走完全相同的 `resolveSession` / `runTurn` / `loadSession`
 * 读写路径，因此能验证「重启后读回权威状态」。
 *
 * 真库实现 `PostgresTutorSessionStore` 与内存替身共享同一抽象，差异只在
 * SQL；语义（序号、幂等、归属、服务端派生状态）由这组测试钉死。
 */

const OWNER = 'stu-owner';
const OTHER = 'stu-other';

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

/** 复用内存实现，但宣称自己是 durable，从而走真实持久化读写路径。 */
class DurableMemoryStore extends InMemoryTutorSessionStore {
  override readonly durable: boolean = true;
}

/** 跨服务实例共享的幂等存储替身，语义对齐 `IdempotencyService`。 */
class SharedIdempotencyStore extends IdempotencyStore {
  private readonly results = new Map<string, { hash: string; body: unknown }>();
  readonly executed: string[] = [];

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    _options?: IdempotencyExecuteOptions,
  ): Promise<IdempotencyResult<T>> {
    const id = `${scope}::${key}`;
    const existing = this.results.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT');
      return { status: 200, body: existing.body as T, replayed: true };
    }
    this.executed.push(id);
    const result = await handler();
    this.results.set(id, { hash: requestHash, body: result.body });
    return { status: result.status ?? 200, body: result.body, replayed: false };
  }
}

class RecordingAuditWriter extends AuditWriter {
  readonly entries: CommonAuditEntry[] = [];

  async write(entry: CommonAuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

function newService(
  store: InMemoryTutorSessionStore,
  idempotency?: SharedIdempotencyStore,
  audit?: RecordingAuditWriter,
  gateway: TutorModelGateway = new StubGateway('你观察到哪一片叶子最不一样？'),
): TutorService {
  return new TutorService(
    'live',
    gateway,
    undefined,
    undefined,
    undefined,
    store,
    idempotency,
    audit,
  );
}

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<StreamedTutorEvent[]> {
  const events: StreamedTutorEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

test('持久化：重启等价重载能读回会话、回合与服务端字段', async () => {
  const store = new DurableMemoryStore();
  const idem = new SharedIdempotencyStore();
  const service1 = newService(store, idem);

  const session = await service1.resolveSession('prj-persist', OWNER);
  await drain(
    service1.runTurn(session, {
      content: '叶子发黄和光有关系吗',
      pedagogicMove: 'hint',
      idempotencyKey: 'turn-1',
      actorId: OWNER,
    }),
  );

  // 模拟重启：全新 service 实例，共享同一存储 / 幂等存储。
  const service2 = newService(store, idem);
  const reloaded = await service2.loadSession(session.sessionId, OWNER);

  assert.equal(reloaded.ownerId, OWNER);
  assert.equal(reloaded.projectId, 'prj-persist');
  assert.equal(reloaded.turns.length, 2);
  assert.equal(reloaded.lastSeq, session.lastSeq);

  const student = reloaded.turns.find((turn) => turn.role === 'student');
  const assistant = reloaded.turns.find((turn) => turn.role === 'assistant');
  assert.ok(student && assistant);
  // 每个回合都持久化了 9.4 要求的服务端字段。
  assert.equal(student.pedagogicMove, 'hint');
  assert.equal(assistant.pedagogicMove, null);
  assert.equal(assistant.stageBefore, 'theory_learning');
  assert.equal(assistant.stageAfter, 'theory_learning');
  assert.equal(student.stageBefore, 'theory_learning');
  assert.equal(assistant.expectedEvidence, '打开项目查看当前阶段任务和下一步行动。');
  assert.equal(assistant.promptVersion, 'qitu.partner.v1');
  assert.equal(assistant.evidenceRef, `tutor_turn:${session.sessionId}:${assistant.seq}`);
  assert.equal(typeof assistant.hintLevel, 'number');
  assert.equal(reloaded.lastHintLevel, assistant.hintLevel);
});

test('持久化：跨学生访问会话统一 403，且不返回任何字段', async () => {
  const store = new DurableMemoryStore();
  const service = newService(store, new SharedIdempotencyStore());
  const session = await service.resolveSession('prj-deny', OWNER);

  await assert.rejects(service.loadSession(session.sessionId, OTHER), ForbiddenException);
  // 同一 projectId 也不能被另一个学生取到。
  await assert.rejects(service.resolveSession('prj-deny', OTHER), ForbiddenException);
});

test('持久化：同一幂等键重试只落一条学生回合与一条助手回合', async () => {
  const store = new DurableMemoryStore();
  const idem = new SharedIdempotencyStore();
  const service = newService(store, idem);
  const session = await service.resolveSession('prj-idem', OWNER);
  const request = { content: '为什么叶子会黄', idempotencyKey: 'turn-dup', actorId: OWNER };

  const first = await drain(service.runTurn(session, request));
  const second = await drain(service.runTurn(session, request));

  const reloaded = await service.loadSession(session.sessionId, OWNER);
  assert.equal(reloaded.turns.filter((turn) => turn.role === 'student').length, 1);
  assert.equal(reloaded.turns.filter((turn) => turn.role === 'assistant').length, 1);
  assert.equal(reloaded.turns.length, 2);
  assert.deepEqual(second, first, '重放的事件序列必须与首次逐字段一致');
  assert.equal(idem.executed.length, 1, 'handler 只允许执行一次');
  assert.equal(
    service.auditEntries.filter((entry) => entry.action === 'tutor.idempotent_replay').length,
    1,
  );
});

test('持久化：多个回合的 seq 严格递增、唯一且与 last_seq 对齐', async () => {
  const store = new DurableMemoryStore();
  const service = newService(store, new SharedIdempotencyStore());
  const session = await service.resolveSession('prj-seq', OWNER);

  await drain(service.runTurn(session, { content: '第一问', idempotencyKey: 's1', actorId: OWNER }));
  await drain(service.runTurn(session, { content: '第二问', idempotencyKey: 's2', actorId: OWNER }));

  const reloaded = await service.loadSession(session.sessionId, OWNER);
  const seqs = reloaded.turns.map((turn) => turn.seq);
  assert.equal(seqs.length, 4, '两轮各产出学生回合 + 助手回合');
  assert.equal(seqs[0], 1, '首个学生回合从 1 开始');
  for (let i = 1; i < seqs.length; i += 1) {
    assert.ok(seqs[i]! > seqs[i - 1]!, 'seq 必须严格递增');
  }
  assert.equal(new Set(seqs).size, seqs.length, 'seq 必须唯一');
  assert.equal(reloaded.lastSeq, Math.max(...seqs), 'last_seq 必须等于最大回合序号');
  // 学生回合先占号，助手回合落在本轮最后一个事件序号上。
  assert.equal(reloaded.turns[0]!.role, 'student');
  assert.equal(reloaded.turns[1]!.role, 'assistant');
  assert.ok(reloaded.turns[1]!.seq > reloaded.turns[0]!.seq);
});

test('持久化：连续卡顿导致的升级状态在重启后依然成立', async () => {
  const store = new DurableMemoryStore();
  const service1 = newService(store, new SharedIdempotencyStore());
  const session = await service1.resolveSession('prj-stall', OWNER);

  for (let i = 1; i <= 4; i += 1) {
    await drain(
      service1.runTurn(session, {
        content: `还是不懂（第 ${i} 次）`,
        pedagogicMove: 'stall_signal',
        idempotencyKey: `stall-${i}`,
        actorId: OWNER,
      }),
    );
  }
  assert.equal(session.escalated, true);

  const service2 = newService(store, new SharedIdempotencyStore());
  const reloaded = await service2.loadSession(session.sessionId, OWNER);
  assert.equal(reloaded.stallCount, 4, '卡顿计数由持久化回合重放得出');
  assert.equal(reloaded.escalated, true, '升级状态由持久化回合重放得出');
});

test('持久化：审计只在真正创建会话时写一次，重放不重复写回合审计', async () => {
  const store = new DurableMemoryStore();
  const idem = new SharedIdempotencyStore();
  const audit = new RecordingAuditWriter();
  const service = newService(store, idem, audit);

  await service.resolveSession('prj-audit', OWNER);
  await service.resolveSession('prj-audit', OWNER);
  const session = await service.loadSession('session-prj-audit', OWNER);
  await drain(service.runTurn(session, { content: '为什么', idempotencyKey: 'a1', actorId: OWNER }));
  await drain(service.runTurn(session, { content: '为什么', idempotencyKey: 'a1', actorId: OWNER }));

  const count = (action: string) => audit.entries.filter((entry) => entry.action === action).length;
  assert.equal(count('tutor.session_start'), 1);
  assert.equal(count('tutor.turn'), 1);
  assert.equal(
    audit.entries.find((entry) => entry.action === 'tutor.session_start')?.targetId,
    'session-prj-audit',
  );
});

test('demo 回退：无持久化存储时仍用内存种子会话，且不触发模型网关', async () => {
  const gateway = new StubGateway('不该被用到');
  const service = new TutorService('demo', gateway);

  const session = await service.resolveSession('project-demo-001', OWNER);
  assert.equal(session.sessionId, 'session-demo-001');
  assert.equal(session.turns.length, 6, 'demo 会话保留演示历史');
  assert.equal(gateway.calls.length, 0, 'demo 使用 Heuristic provider');

  const before = session.turns.length;
  await drain(service.runTurn(session, { content: '帮我看看', idempotencyKey: 'd1', actorId: OWNER }));
  const afterFirst = session.turns.length;
  await drain(service.runTurn(session, { content: '帮我看看', idempotencyKey: 'd1', actorId: OWNER }));
  assert.equal(session.turns.length, afterFirst, '内存幂等键重放不追加回合');
  assert.equal(afterFirst, before + 2);
});
