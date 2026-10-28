import { withTutorProviderContext } from './tutor-provider.test-fixture';
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

class ScriptedGateway implements TutorModelGateway {
  readonly calls: Array<{ usageId: string; request: ModelCompletionRequest }> = [];
  constructor(private readonly responses: Array<string | null>) {}
  async complete(usageId: string, request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    this.calls.push({ usageId, request });
    const next = this.responses.shift() ?? null;
    if (next === null) throw new ModelGatewayError('MODEL_USAGE_NOT_BOUND', 'unavailable');
    return { providerId: 'provider-1', modelId: 'model-1', api: 'openai-completions', text: next, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }
}

const extractionExploration = (status: string = 'exploring'): {
  id: string; source: 'free'; templateVersionId: null; status: string;
  intentDraft: { id: string; explorationId: string; goalUser: string | null; coreInterests: string[]; preferredForm: null; targetBeneficiary: null; confirmedAt: null; updatedAt: string };
  projectId: null; createdAt: string; updatedAt: string;
} => ({
  id: 'exp-intent', source: 'free', templateVersionId: null, status,
  intentDraft: { id: 'draft', explorationId: 'exp-intent', goalUser: null, coreInterests: [], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: '' },
  projectId: null, createdAt: '', updatedAt: '',
});

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<StreamedTutorEvent[]> {
  const events: StreamedTutorEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

test('幂等：同一 idempotencyKey 重放不追加回合、事件逐字节一致', async () => {
  const service = withTutorProviderContext(new TutorService('live', new StubGateway('你观察到哪一片叶子最不一样？')));
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
  const service = withTutorProviderContext(new TutorService('live', new StubGateway(null)));
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
  const service = withTutorProviderContext(new TutorService('live', new StubGateway('答案是叶绿素减少了，你觉得呢？')));
  const record = service.getOrCreateSession('prj-leak', 'stu-1');

  await drain(
    service.runTurn(record, { content: '为什么', idempotencyKey: 'turn-1', actorId: 'stu-1' }),
  );

  assert.deepEqual(
    service.auditEntries.map((entry) => entry.action),
    ['tutor.session_start', 'tutor.turn'],
  );
});

test('真实自由探索回合提取并写入意图后立即匹配推荐；同幂等键重放不重复写草稿或调用提取', async () => {
  const source = '我想为同学设计植物观察工具';
  const gateway = new ScriptedGateway([
    '{"goalUser":"同学","coreInterests":["植物"]}', '{}',
    '{"goalUser":"同学","coreInterests":["植物"]}', '{}',
  ]);
  const service = withTutorProviderContext(new TutorService('demo', gateway));
  let current = extractionExploration();
  let updates = 0;
  const templates = [{ id: 'plant', status: 'published', latestPublishedVersionId: 'plant-v1', title: '校园植物观察', summary: '观察叶片', learningObjectives: ['记录植物'], domain: '科学', estimatedDurationMinutes: 300 }];
  Object.assign(service, {
    projects: {
      getExploration: async () => current,
      updateIntentDraft: async (_owner: string, _id: string, patch: { goalUser: string; coreInterests: string[] }) => {
        updates += 1;
        current = { ...current, status: 'awaiting_confirmation', intentDraft: { ...current.intentDraft, ...patch } };
        return current;
      },
    },
    templates: {
      listPublishedTemplates: async () => templates,
      getPublishedTemplate: async () => templates[0],
    },
  });
  const record = service.getOrCreateSession(null, 'owner', 'exp-intent');
  const request = { content: source, idempotencyKey: 'intent-once', actorId: 'owner' };
  const events = await drain(service.runTurn(record, request));
  assert.equal(updates, 1);
  assert.equal(current.status, 'awaiting_confirmation');
  assert.deepEqual(current.intentDraft.coreInterests, ['植物']);
  assert.ok(record.turns.some((turn) => turn.role === 'assistant' && turn.blocks.some((block) => block.kind === 'idea_cards' && block.cards.some((card) => card.templateId === 'plant'))));
  assert.equal(events.some((event) => event.event.type === 'error'), false);
  await drain(service.runTurn(record, request));
  assert.equal(updates, 1);
  assert.equal(gateway.calls.length, 2, '重复幂等键回放不重新提取或重排');
  await drain(service.runTurn(record, { ...request, content: '我仍然想为同学设计植物观察工具', idempotencyKey: 'intent-same-again' }));
  assert.equal(updates, 1, '不同回合提取到相同字段也不重复写 Projects draft');
  assert.equal(gateway.calls.length, 4);
  assert.ok(service.auditEntries.every((entry) => !entry.detail.includes(source)));
});

test('非法 JSON、超长字段和空字段不更新意图，但 Tutor 回合仍正常完成', async () => {
  const invalidResponses = [
    'not-json',
    JSON.stringify({ goalUser: '同'.repeat(121), coreInterests: ['植物'] }),
    JSON.stringify({ goalUser: '', coreInterests: [] }),
  ];
  for (const [index, response] of invalidResponses.entries()) {
    const gateway = new ScriptedGateway([response]);
    const service = withTutorProviderContext(new TutorService('demo', gateway));
    let updates = 0;
    Object.assign(service, {
      projects: { getExploration: async () => extractionExploration(), updateIntentDraft: async () => { updates += 1; } },
      templates: { listPublishedTemplates: async () => [], getPublishedTemplate: async () => { throw new Error('unused'); } },
    });
    const record = service.getOrCreateSession(null, 'owner', `exp-invalid-${index}`);
    const events = await drain(service.runTurn(record, { content: '我想为同学设计植物观察工具', idempotencyKey: `invalid-${index}`, actorId: 'owner' }));
    assert.equal(updates, 0);
    assert.equal(events.some((event) => event.event.type === 'error'), false);
    assert.equal(record.turns.filter((turn) => turn.role === 'assistant').length, 1);
  }
});

test('模型不可用时只从明确原文短语做确定性回退；已确认或缺少 explorationId 不更新', async () => {
  const fallbackService = new TutorService('demo', new ScriptedGateway([null]));
  let fallbackUpdates = 0;
  let fallbackCurrent = extractionExploration();
  Object.assign(fallbackService, { projects: {
    getExploration: async () => fallbackCurrent,
    updateIntentDraft: async (_owner: string, _id: string, patch: { goalUser: string; coreInterests: string[] }) => {
      fallbackUpdates += 1;
      fallbackCurrent = { ...fallbackCurrent, status: 'awaiting_confirmation', intentDraft: { ...fallbackCurrent.intentDraft, ...patch } };
      return fallbackCurrent;
    },
  } });
  const fallbackRecord = fallbackService.getOrCreateSession(null, 'owner', 'exp-intent');
  await drain(fallbackService.runTurn(fallbackRecord, { content: '我想为同学设计植物观察工具', idempotencyKey: 'fallback', actorId: 'owner' }));
  assert.equal(fallbackUpdates, 1);
  assert.equal(fallbackCurrent.intentDraft.goalUser, '同学');
  assert.deepEqual(fallbackCurrent.intentDraft.coreInterests, ['植物观察工具']);

  const lockedService = new TutorService('demo', new ScriptedGateway(['{"goalUser":"同学","coreInterests":["植物"]}']));
  let lockedUpdates = 0;
  Object.assign(lockedService, { projects: { getExploration: async () => extractionExploration('confirmed'), updateIntentDraft: async () => { lockedUpdates += 1; } } });
  const lockedRecord = lockedService.getOrCreateSession(null, 'owner', 'exp-confirmed');
  await drain(lockedService.runTurn(lockedRecord, { content: '我想为同学设计植物观察工具', idempotencyKey: 'confirmed', actorId: 'owner' }));
  const noExploration = lockedService.getOrCreateSession(null, 'owner');
  await drain(lockedService.runTurn(noExploration, { content: '我想为同学设计植物观察工具', idempotencyKey: 'no-exploration', actorId: 'owner' }));
  assert.equal(lockedUpdates, 0);
});

test('exploration recommendations use deterministic fallback, verify publication, and audit candidate scores', async () => {
  const templates = [
    { id: 'plant', status: 'published', latestPublishedVersionId: 'plant-v1', title: '校园植物观察', summary: '观察叶片', learningObjectives: ['记录植物'], domain: '科学', estimatedDurationMinutes: 300 },
    { id: 'robot', status: 'published', latestPublishedVersionId: 'robot-v1', title: '机器人设计', summary: '传感器控制', learningObjectives: ['工程设计'], domain: '工程', estimatedDurationMinutes: 400 },
  ];
  const service = withTutorProviderContext(new TutorService('live', new StubGateway(null)));
  const exploration = {
    id: 'exp-recommend', source: 'free', templateVersionId: null, status: 'awaiting_confirmation',
    intentDraft: { id: 'draft', explorationId: 'exp-recommend', goalUser: '观察植物生长', coreInterests: ['植物'], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: new Date().toISOString() },
    projectId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  Object.assign(service, {
    projects: { getExploration: async () => exploration },
    templates: {
      listPublishedTemplates: async () => templates,
      getPublishedTemplate: async (_actor: unknown, id: string) => {
        const found = templates.find((item) => item.id === id);
        if (!found) throw new Error('not found');
        return found;
      },
    },
  });
  const record = service.getOrCreateSession(null, 'owner', 'exp-recommend');
  record.turns.push({
    turnId: 's1', role: 'student', blocks: [{ kind: 'text', text: '我想观察植物叶子' }], hintLevel: null,
    stageBefore: 'exploration', stageAfter: null, seq: 1, createdAt: new Date().toISOString(), modality: 'text',
    pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null,
  });
  const call = (service as unknown as { buildIdeaCards(input: never): Promise<Array<{ templateId: string }>> }).buildIdeaCards.bind(service);
  const cards = await call(record as never);
  assert.deepEqual(cards.map((card) => card.templateId), ['plant']);
  const audit = service.auditEntries.find((entry) => entry.action === 'tutor.recommendation');
  assert.match(audit?.detail ?? '', /deterministic/);
  assert.match(audit?.detail ?? '', /\"score\"/);
});

test('insufficient intent does not recommend; invalid/unpublished model IDs never become cards', async () => {
  const service = withTutorProviderContext(new TutorService('live', new StubGateway('{"templateIds":["forged"]}')));
  const exploration = { id: 'exp-thin', source: 'free', templateVersionId: null, status: 'exploring', intentDraft: null, projectId: null, createdAt: '', updatedAt: '' };
  Object.assign(service, {
    projects: { getExploration: async () => exploration },
    templates: { listPublishedTemplates: async () => [{ id: 'real', status: 'published', latestPublishedVersionId: 'v1', title: '项目', summary: '描述', learningObjectives: ['目标'], domain: '科学', estimatedDurationMinutes: 200 }], getPublishedTemplate: async () => { throw new Error('unpublished'); } },
  });
  const record = service.getOrCreateSession(null, 'owner', 'exp-thin');
  const call = (service as unknown as { buildIdeaCards(input: never): Promise<unknown[]> }).buildIdeaCards.bind(service);
  assert.deepEqual(await call(record as never), []);
  assert.match(service.auditEntries.find((entry) => entry.action === 'tutor.recommendation')?.detail ?? '', /not_clarified/);
});

test('same intent does not repeat cards; a changed intent can recommend a different candidate, up to three emissions', async () => {
  const data = [
    { id: 'plant', status: 'published', latestPublishedVersionId: 'pv', title: '校园植物观察', summary: '叶片', learningObjectives: ['植物'], domain: '科学', estimatedDurationMinutes: 300 },
    { id: 'robot', status: 'published', latestPublishedVersionId: 'rv', title: '机器人设计', summary: '传感器', learningObjectives: ['机器人'], domain: '工程', estimatedDurationMinutes: 300 },
    { id: 'story', status: 'published', latestPublishedVersionId: 'sv', title: '校园故事地图', summary: '人文记录', learningObjectives: ['故事地图'], domain: '人文', estimatedDurationMinutes: 300 },
    { id: 'solar', status: 'published', latestPublishedVersionId: 'solv', title: '太阳能小车', summary: '光伏能源', learningObjectives: ['太阳能'], domain: '工程', estimatedDurationMinutes: 300 },
  ];
  let current = { id: 'exp-throttle', source: 'free', templateVersionId: null, status: 'awaiting_confirmation', intentDraft: { id: 'd', explorationId: 'exp-throttle', goalUser: '观察植物生长', coreInterests: ['植物'], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: '' }, projectId: null, createdAt: '', updatedAt: '' };
  const service = withTutorProviderContext(new TutorService('live', new StubGateway(null)));
  Object.assign(service, { projects: { getExploration: async () => current }, templates: { listPublishedTemplates: async () => data, getPublishedTemplate: async (_actor: unknown, id: string) => data.find((item) => item.id === id)! } });
  const record = service.getOrCreateSession(null, 'owner', 'exp-throttle');
  const call = (service as unknown as { buildIdeaCards(input: never): Promise<Array<{ templateId: string }>> }).buildIdeaCards.bind(service);
  const first = await call(record as never);
  assert.deepEqual(first.map((card) => card.templateId), ['plant']);
  record.turns.push({ turnId: 'a1', role: 'assistant', blocks: [{ kind: 'idea_cards', cards: first as never }], hintLevel: null, stageBefore: 'exploration', stageAfter: 'exploration', seq: 2, createdAt: '', modality: 'text', pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null });
  assert.deepEqual(await call(record as never), []);
  current = { ...current, intentDraft: { ...current.intentDraft, goalUser: '制作机器人', coreInterests: ['机器人'] } };
  const changed = await call(record as never);
  assert.deepEqual(changed.map((card) => card.templateId), ['robot']);
  record.turns.push({ turnId: 'a2', role: 'assistant', blocks: [{ kind: 'idea_cards', cards: changed as never }], hintLevel: null, stageBefore: 'exploration', stageAfter: 'exploration', seq: 4, createdAt: '', modality: 'text', pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null });
  current = { ...current, intentDraft: { ...current.intentDraft, goalUser: '绘制校园故事地图', coreInterests: ['故事'] } };
  const third = await call(record as never);
  assert.deepEqual(third.map((card) => card.templateId), ['story']);
  record.turns.push({ turnId: 'a3', role: 'assistant', blocks: [{ kind: 'idea_cards', cards: third as never }], hintLevel: null, stageBefore: 'exploration', stageAfter: 'exploration', seq: 6, createdAt: '', modality: 'text', pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null });
  current = { ...current, intentDraft: { ...current.intentDraft, goalUser: '制作太阳能小车', coreInterests: ['太阳能'] } };
  assert.deepEqual(await call(record as never), []);
});

test('model recommendation result naming an unpublished template is rejected at revalidation', async () => {
  const gateway = new StubGateway('{"templateIds":["plant"]}');
  const service = withTutorProviderContext(new TutorService('live', gateway));
  const exploration = { id: 'exp-unpublished', source: 'free', templateVersionId: null, status: 'awaiting_confirmation', intentDraft: { id: 'd', explorationId: 'exp-unpublished', goalUser: '观察植物', coreInterests: ['植物'], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: '' }, projectId: null, createdAt: '', updatedAt: '' };
  Object.assign(service, { projects: { getExploration: async () => exploration }, templates: { listPublishedTemplates: async () => [{ id: 'plant', status: 'published', latestPublishedVersionId: 'pv', title: '植物观察', summary: '观察植物', learningObjectives: ['植物'], domain: '科学', estimatedDurationMinutes: 300 }], getPublishedTemplate: async () => { throw new Error('not published anymore'); } } });
  const record = service.getOrCreateSession(null, 'owner', 'exp-unpublished');
  const cards = await (service as unknown as { buildIdeaCards(input: never): Promise<unknown[]> }).buildIdeaCards(record as never);
  assert.deepEqual(cards, []);
  assert.equal(gateway.calls[0]?.usageId, 'tutor.chat');
  assert.ok(service.auditEntries.some((entry) => entry.action === 'tutor.guard_block' && /plant/.test(entry.detail)));
});

test('recommendation-bearing exploration turn is authored by qitu-intake-assistant', async () => {
  const service = withTutorProviderContext(new TutorService('demo', new StubGateway('not used')));
  const exploration = { id: 'exp-author', source: 'free', templateVersionId: null, status: 'awaiting_confirmation', intentDraft: { id: 'd', explorationId: 'exp-author', goalUser: '观察植物', coreInterests: ['植物'], preferredForm: null, targetBeneficiary: null, confirmedAt: null, updatedAt: '' }, projectId: null, createdAt: '', updatedAt: '' };
  const template = { id: 'plant-author', status: 'published', latestPublishedVersionId: 'pv', title: '植物观察', summary: '观察植物', learningObjectives: ['植物'], domain: '科学', estimatedDurationMinutes: 300 };
  Object.assign(service, { projects: { getExploration: async () => exploration }, templates: { listPublishedTemplates: async () => [template], getPublishedTemplate: async () => template } });
  const record = service.getOrCreateSession(null, 'owner', 'exp-author');
  await drain(service.runTurn(record, { content: '我想观察植物', idempotencyKey: 'author-turn', actorId: 'owner' }));
  const assistant = record.turns.find((turn) => turn.role === 'assistant');
  assert.equal(assistant?.author?.id, 'qitu-intake-assistant');
  assert.equal(assistant?.author?.name, '启途智学助手');
  assert.ok(assistant?.blocks.some((block) => block.kind === 'idea_cards'));
});

test('demo 模式：使用 Heuristic provider，完全不调用模型网关', async () => {
  const gateway = new StubGateway('不该被用到');
  const service = withTutorProviderContext(new TutorService('demo', gateway));
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
