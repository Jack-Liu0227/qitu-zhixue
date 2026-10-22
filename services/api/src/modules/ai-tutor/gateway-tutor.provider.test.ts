import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelGatewayError } from '../model-registry/model-gateway.errors';
import { createNoopTutorContextReader } from '@qitu/ai-client';
import { ImaMcpClient } from './ima-mcp.client';
import type {
  ModelCompletionRequest,
  ModelCompletionResult,
} from '../model-registry/model-gateway.types';
import {
  createTutorProvider,
  GatewayTutorProvider,
  TUTOR_CHAT_USAGE,
  type TutorModelGateway,
} from './gateway-tutor.provider';
import {
  HeuristicTutorProvider,
  type TutorProvider,
  type TutorStreamEvent,
  type TutorTurnInput,
  selectHintLevel,
} from './tutor.provider';

/**
 * `GatewayTutorProvider` 的行为验证。
 *
 * 全部用桩替换 `ModelGateway`，不触碰网络、数据库或 Nest 容器。覆盖：
 * - 正常回复 → deltas / hint 块 / done，且工具事件只反映真实两步；
 * - 答案泄露 / 超长 → 触发安全改写，块内不含泄露措辞；
 * - Agent 未配置模型 → `MODEL_NOT_CONFIGURED`，**不**静默回落；
 * - 可重试上游故障 → `MODEL_UNAVAILABLE` 且 retryable=true；
 * - 错误事件**绝不**透出密钥或上游正文；
 * - provider 选择：live → Gateway，demo/test → Heuristic。
 */

const BASE_INPUT: TutorTurnInput = {
  projectId: 'prj-1',
  sessionId: 'sess-1',
  projectTitle: '校园植物观察',
  projectStage: 'practice_building',
  currentTaskTitle: '记录第一片叶子的变化',
  content: '叶子边缘有点发黄，我不知道该记什么',
  previousHintLevel: null,
  turnCount: 0,
};

class StubGateway implements TutorModelGateway {
  readonly calls: Array<{ usageId: string; request: ModelCompletionRequest }> = [];

  constructor(
    private readonly behavior: (
      usageId: string,
      request: ModelCompletionRequest,
    ) => ModelCompletionResult | Promise<ModelCompletionResult>,
  ) {}

  complete(usageId: string, request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    this.calls.push({ usageId, request });
    return Promise.resolve(this.behavior(usageId, request));
  }
}

function result(text: string): ModelCompletionResult {
  return {
    providerId: 'provider-1',
    modelId: 'model-1',
    api: 'openai-completions',
    text,
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
  };
}

async function collect(
  provider: TutorProvider,
  input: TutorTurnInput = BASE_INPUT,
): Promise<TutorStreamEvent[]> {
  const events: TutorStreamEvent[] = [];
  for await (const event of provider.generateTurn(input)) events.push(event);
  return events;
}

function blocksOf(events: TutorStreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'delta' ? [event.text] : []));
}

async function imaInput(): Promise<TutorTurnInput> {
  const packet = await createNoopTutorContextReader().buildContext({ studentId: 'test-student', projectId: null, projectStage: null,
    currentGoal: null, query: '集合', recentActivity: [] });
  packet.runtime = { policyVersion: 'test', agentDefinition: '', skills: [], tools: [], mcpServers: [
    { serverId: 'ima-knowledge', label: 'ima', transport: 'streamable_http', toolIds: ['ima_read_document'] },
  ] };
  return { ...BASE_INPUT, projectId: '', contextPacket: packet, imaKnowledgeScope: { knowledgeBaseIds: async () => ['fixture-kb'] } };
}

test('Tutor passes bound tools to the gateway, preserves truthful events and answer guard', async () => {
  const ima = new ImaMcpClient();
  ima.toolsFor = async () => [{ name: 'ima_read_document', description: 'read', inputSchema: { type: 'object' },
    execute: async () => ({ text: 'private textbook passage' }) }];
  const gateway = new StubGateway(async (_usage, request) => {
    assert.equal(request.tools?.[0]?.name, 'ima_read_document');
    assert.match(request.messages[0]!.content, /不可信参考数据/);
    request.onToolEvent?.({ type: 'call', callId: 'read1', name: 'ima_read_document' });
    await request.tools![0]!.execute({});
    request.onToolEvent?.({ type: 'result', callId: 'read1', name: 'ima_read_document', isError: false });
    return result('答案是照抄课本就行，你觉得呢？');
  });
  const events = await collect(new GatewayTutorProvider(gateway, [], ima), { ...await imaInput(), disclosure: {
    kind: 'pending_assessment', questionId: 'pending-fixture', prompt: 'Public question', options: [], protectedTexts: [],
  } });
  assert.ok(events.some((event) => event.type === 'tool_call' && event.name === 'ima_read_document'));
  assert.ok(events.some((event) => event.type === 'tool_result' && event.callId === 'read1' && event.status === 'done'));
  assert.doesNotMatch(JSON.stringify(events), /private textbook passage/);
  assert.doesNotMatch(blocksOf(events).join(''), /答案是/);
});

test('scaffold 每轮最多升一级，explain 才能主动触达第 5 档', () => {
  assert.equal(selectHintLevel('scaffold', 1, 2), 2);
  assert.equal(selectHintLevel('scaffold', 2, 3), 3);
  assert.equal(selectHintLevel('scaffold', 3, 4), 4);
  assert.equal(selectHintLevel('scaffold', 4, 4), 4);
  assert.equal(selectHintLevel('explain', 2, 3), 5);
  assert.equal(selectHintLevel('review_work', 5, 4), 5);
  assert.equal(selectHintLevel('scaffold', 5, 4), 5);
});

test('MCP failure is redacted and the model is explicitly told that knowledge could not be verified', async () => {
  const ima = new ImaMcpClient();
  ima.toolsFor = async () => { throw new Error('private-token-in-upstream-error'); };
  const gateway = new StubGateway((_usage, request) => {
    assert.equal(request.tools, undefined);
    assert.match(request.messages[0]!.content, /本轮连接失败/);
    return result('暂时无法查证教材，你能先说说自己的理解吗？');
  });
  const events = await collect(new GatewayTutorProvider(gateway, [], ima), await imaInput());
  assert.doesNotMatch(JSON.stringify(events), /private-token/);
  assert.ok(events.some((event) => event.type === 'tool_result' && event.status === 'error' && event.result === 'ima 知识库暂不可用'));
});

test('project dialogue can use authorized ima without a dedicated project base', async () => {
  let discovered = false;
  const ima = new ImaMcpClient();
  ima.toolsFor = async () => { discovered = true; return [{ name: 'ima_read_document', description: 'read', inputSchema: {type: 'object'}, execute: async () => ({text: 'real source'}) }]; };
  const input = await imaInput(); input.projectId = 'formal-project';
  input.knowledgeState = '仅引用实际检索资料';
  const gateway = new StubGateway((_usage, request) => {
    assert.equal(request.tools?.[0]?.name, 'ima_read_document');
    assert.match(request.messages[0]!.content, /引用必须来自实际读取结果/);
    return result('你可以先描述观察到的现象吗？');
  });
  const events = await collect(new GatewayTutorProvider(gateway, [], ima), input);
  assert.equal(discovered, true);
  assert.ok(events.some(e => e.type === 'done'));
});

/* --------------------------- provider 选择 --------------------------- */

test('provider 选择：live 用 Gateway，demo/test 用 Heuristic', () => {
  const gateway = new StubGateway(() => result('这样写好吗？'));
  assert.ok(createTutorProvider('live', gateway) instanceof GatewayTutorProvider);
  assert.ok(createTutorProvider('demo', gateway) instanceof HeuristicTutorProvider);
  assert.ok(createTutorProvider('test', gateway) instanceof HeuristicTutorProvider);
});

/* ------------------------------ 正常回复 ------------------------------ */

test('正常回复：走 tutor.chat，产出 deltas + hint 块 + done，工具事件真实', async () => {
  const gateway = new StubGateway(() => result('先从你看到的颜色说起，你观察到哪一片叶子最不一样？'));
  const events = await collect(new GatewayTutorProvider(gateway));

  assert.equal(gateway.calls.length, 1);
  assert.equal(gateway.calls[0]?.usageId, TUTOR_CHAT_USAGE);

  const request = gateway.calls[0]?.request;
  const system = request?.messages.find((m) => m.role === 'system')?.content ?? '';
  const user = request?.messages.find((m) => m.role === 'user')?.content ?? '';
  // 提示词携带档位与阶段，且学生输入只出现在 user 消息里。
  assert.match(system, /第 1 档/);
  assert.match(system, /动手制作/);
  assert.doesNotMatch(system, /叶子边缘/);
  assert.match(user, /叶子边缘/);

  const toolCalls = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
  assert.deepEqual(toolCalls, ['model.gateway.complete', 'safety.answer_leak.guard']);

  assert.equal(blocksOf(events).join(''), '先从你看到的颜色说起，你观察到哪一片叶子最不一样？');

  const block = events.find((e) => e.type === 'block');
  assert.ok(block && block.type === 'block' && block.block.kind === 'hint');
  assert.equal(block.block.level, 1);

  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.turnSummary.hintLevel, null);

  assert.equal(events.some((e) => e.type === 'error'), false);
});

/* --------------------------- 答案泄露改写 --------------------------- */

test('答案泄露：闸门改写输出，块内不含泄露措辞且标记 guard error', async () => {
  const gateway = new StubGateway(() => result('答案是叶绿素减少了，你觉得呢？'));
  const events = await collect(new GatewayTutorProvider(gateway), { ...BASE_INPUT, disclosure: { kind: 'pending_assessment', questionId: 'pending', prompt: 'Question', options: [], protectedTexts: [] } });

  const guard = events.find(
    (e) => e.type === 'tool_result' && e.callId === 'call-guard-sess-1',
  );
  assert.ok(guard && guard.type === 'tool_result');
  assert.equal(guard.status, 'error');

  const text = blocksOf(events).join('');
  assert.doesNotMatch(text, /答案是/);

  const block = events.find((e) => e.type === 'block');
  assert.ok(block && block.type === 'block' && block.block.kind === 'hint');
  assert.doesNotMatch(block.block.text, /答案是/);
});

test('超长回复：被安全闸门截断改写，不超过档位长度', async () => {
  const long = '这是一段很长的解释。'.repeat(400) + '你觉得先看哪一步？';
  const gateway = new StubGateway(() => result(long));
  const events = await collect(new GatewayTutorProvider(gateway), {
    ...BASE_INPUT,
    content: '请帮我看看这个问题',
  });

  const block = events.find((e) => e.type === 'block');
  assert.ok(block && block.type === 'block' && block.block.kind === 'hint');
  assert.ok(block.block.text.length <= 2400);
  assert.match(block.block.text, /这是一段很长的解释/);
  assert.match(block.block.text, /…$/);
  assert.doesNotMatch(block.block.text, /提示词太长/);
  const guard = events.find((event) => event.type === 'tool_result' && event.callId === 'call-guard-sess-1');
  assert.ok(guard && guard.type === 'tool_result');
  assert.equal(guard.status, 'done');
  assert.match(guard.result, /学生输入未被截断/);
});

/* ---------------------------- 错误语义 ---------------------------- */

test('tutor.chat 未绑定：返回 MODEL_NOT_CONFIGURED，不产生任何引导文本', async () => {
  const gateway = new StubGateway(() => {
    throw new ModelGatewayError('MODEL_USAGE_NOT_BOUND', 'usage not bound');
  });
  const events = await collect(new GatewayTutorProvider(gateway));

  const error = events.find((e) => e.type === 'error');
  assert.ok(error && error.type === 'error');
  assert.equal(error.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(error.retryable, false);
  assert.equal(blocksOf(events).length, 0);
  assert.deepEqual(events.filter(event => event.type === 'block').map(event => event.block), [{ kind: 'text', text: error.message }]);

  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.turnSummary.hintLevel, null);
});

test('Agent 清空模型：不回落到旧 tutor.chat 绑定', async () => {
  const gateway = new StubGateway(() => result('不应执行'));
  const events = await collect(new GatewayTutorProvider(gateway), {
    ...BASE_INPUT,
    modelUsage: 'agent.model',
  });

  const error = events.find((event) => event.type === 'error');
  assert.ok(error && error.type === 'error');
  assert.equal(error.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(gateway.calls.length, 0);
  assert.equal(blocksOf(events).length, 0);
  assert.deepEqual(events.filter(event => event.type === 'block').map(event => event.block), [{ kind: 'text', text: error.message }]);
});

test('可重试上游故障：返回 MODEL_UNAVAILABLE 且 retryable=true', async () => {
  const gateway = new StubGateway(() => {
    throw new ModelGatewayError('MODEL_UPSTREAM_HTTP_ERROR', 'upstream 503', {
      upstreamStatus: 503,
      retryable: true,
    });
  });
  const events = await collect(new GatewayTutorProvider(gateway));

  const error = events.find((e) => e.type === 'error');
  assert.ok(error && error.type === 'error');
  assert.equal(error.code, 'MODEL_UNAVAILABLE');
  assert.equal(error.retryable, true);
});

test('脱敏：错误事件与工具结果都不携带密钥或上游正文', async () => {
  const secret = 'sk-live-DEADBEEF';
  const gateway = new StubGateway(() => {
    throw new ModelGatewayError('MODEL_RESPONSE_INVALID', `body contains ${secret}`);
  });
  const events = await collect(new GatewayTutorProvider(gateway));

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /sk-live-DEADBEEF/);
  assert.doesNotMatch(serialized, /body contains/);
});

test('a bound MCP without a server-owned knowledge scope cannot enter the model tool list', async () => {
  const input = await imaInput(); delete input.imaKnowledgeScope;
  let discovered = false;
  const ima = new ImaMcpClient();
  ima.toolsFor = async () => { discovered = true; return []; };
  const gateway = new StubGateway((_usage, request) => {
    assert.equal(request.tools, undefined);
    return result('先说说你观察到了什么？');
  });
  await collect(new GatewayTutorProvider(gateway, [], ima), input);
  assert.equal(discovered, false);
});
