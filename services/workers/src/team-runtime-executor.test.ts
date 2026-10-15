import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@qitu/database';
import {
  buildTeamAgentPrompt,
  createTeamAgentExecutor,
  parseStructuredAgentOutput,
  TeamAgentExecutionError,
  resolveTeamAgentModel,
} from './team-runtime-executor';
import type { TeamMailboxJob } from './team-runtime-mailbox-source';
import { createServer } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import { agentConfigs, agentRoutes, agentSkillBindings, modelModels, modelProviders, modelUsageBindings } from '@qitu/database';

function routingDb(rows: unknown[][]): Database {
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }) }) } as unknown as Database;
}

test('real Team executor sends scenario-selected model and rereads binding on next job', async () => {
  const requestedModels: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    requestedModels.push(JSON.parse(body).model);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '{"confirmed":true}' }, finish_reason: null }] })+'\n\ndata: '+JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update('synthetic-test-only'), cipher.final()]);
  const secret = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  let selectedModel = 'model-a';
  const db = { select: () => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === agentConfigs ? [{ id: 'worker', enabled: true, modelProviderId: null, modelId: null, modelUsage: 'curriculum.plan', capabilities: [] }]
      : table === modelUsageBindings ? [{ providerId: 'provider', modelId: selectedModel }]
      : table === modelModels ? [{ enabled: true, modelId: selectedModel, inputModalities: ['text'], outputModalities: ['text'] }]
      : table === modelProviders ? [{ id: 'provider', name: 'Synthetic', enabled: true, baseUrl: `http://127.0.0.1:${address.port}`, api: 'openai-completions', encryptedApiKey: secret }]
      : table === agentRoutes ? [{ outputSchema: { type: 'object', required: ['confirmed'] } }]
      : table === agentSkillBindings ? [] : [];
    return { limit: async () => rows, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }) } as unknown as Database;
  try {
    const execute = createTeamAgentExecutor(db, { env: { QITU_MODEL_SECRET_KEY: key.toString('hex') }, policyPath: 'unused' });
    const job = { message: { senderAgentId: 'tutor', recipientAgentId: 'worker', payload: {}, runId: 'synthetic', attempts: 1 }, task: { id: 'synthetic', taskType: 'interest.confirm', input: {} } } as unknown as TeamMailboxJob;
    assert.deepEqual(await execute(job), { confirmed: true });
    selectedModel = 'model-b';
    assert.deepEqual(await execute(job), { confirmed: true });
    assert.deepEqual(requestedModels, ['model-a', 'model-b']);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test('Team Agent scenario binding is resolved fresh and follows only declared fallback', async () => {
  const model = { enabled: true, inputModalities: ['text'], outputModalities: ['text'] };
  const db = routingDb([
    [], [{ providerId: 'one', modelId: 'a' }], [model],
    [{ providerId: 'two', modelId: 'b' }], [model],
  ]);
  const agent = { modelProviderId: null, modelId: null, modelUsage: 'curriculum.plan' };
  assert.deepEqual(await resolveTeamAgentModel(db, agent), { providerId: 'one', modelId: 'a' });
  assert.deepEqual(await resolveTeamAgentModel(db, agent), { providerId: 'two', modelId: 'b' });
});

test('Team Agent explicit and incomplete overrides never silently fallback', async () => {
  const db = { select: () => { throw new Error('unexpected fallback read'); } } as unknown as Database;
  assert.deepEqual(await resolveTeamAgentModel(db, { modelProviderId: 'chosen', modelId: 'explicit', modelUsage: 'tutor.chat' }), { providerId: 'chosen', modelId: 'explicit' });
  await assert.rejects(resolveTeamAgentModel(db, { modelProviderId: 'chosen', modelId: null, modelUsage: 'tutor.chat' }), (e: unknown) => e instanceof TeamAgentExecutionError && e.code === 'TEAM_AGENT_MODEL_NOT_CONFIGURED');
});

test('Team Agent rejects unsupported, unbound and incompatible scenario models', async () => {
  const agent = { modelProviderId: null, modelId: null, modelUsage: 'knowledge.embed' };
  await assert.rejects(resolveTeamAgentModel(routingDb([]), agent), /TEAM_AGENT_MODEL_USAGE_UNSUPPORTED/);
  await assert.rejects(resolveTeamAgentModel(routingDb([[]]), { ...agent, modelUsage: 'tutor.chat' }), /TEAM_AGENT_MODEL_NOT_CONFIGURED/);
  await assert.rejects(resolveTeamAgentModel(routingDb([[{ providerId: 'audio', modelId: 'audio' }], [{ enabled: true, inputModalities: ['audio'], outputModalities: ['audio'] }]]), { ...agent, modelUsage: 'tutor.chat' }), /TEAM_AGENT_MODEL_CAPABILITY_MISMATCH/);
});

test('Team Agent prompt is bounded and contains only server-owned runtime context', () => {
  const prompt = buildTeamAgentPrompt({
    agent: {
      id: 'interest-confirmation',
      displayName: '兴趣确认',
      role: 'explorer',
      roleDefinition: '识别学生兴趣',
      agentDefinition: '只返回候选结果',
      capabilities: ['interest'],
    },
    taskType: 'interest.confirm',
    taskInput: { studentId: 'student-1', conversationSummary: '喜欢生态项目' },
    globalPolicy: '必须保留审计，不得直接写入领域事实',
    skills: [{ id: 'pbl', content: '先确认意图再推荐项目' }],
    outputSchema: { type: 'object', required: ['confirmed'], properties: { confirmed: { type: 'boolean' } } },
  });
  assert.match(prompt.system, /兴趣确认/u);
  assert.match(prompt.system, /不得直接写入领域事实/u);
  assert.match(prompt.user, /student-1/u);
  assert.doesNotMatch(prompt.system, /api[_-]?key/iu);
});

test('structured output requires an object and enforces route schema', () => {
  const schema = { type: 'object', required: ['confirmed'], properties: { confirmed: { type: 'boolean' } } };
  assert.deepEqual(parseStructuredAgentOutput('{"confirmed":true}', schema), { confirmed: true });
  assert.throws(
    () => parseStructuredAgentOutput('{"confirmed":"yes"}', schema),
    (error: unknown) => error instanceof TeamAgentExecutionError && error.code === 'TEAM_AGENT_OUTPUT_SCHEMA_MISMATCH',
  );
  assert.throws(
    () => parseStructuredAgentOutput('not-json'),
    (error: unknown) => error instanceof TeamAgentExecutionError && error.code === 'TEAM_AGENT_OUTPUT_JSON_INVALID',
  );
});

test('Team Agent execution rejects tasks without an enabled route', async () => {
  const agent = {
    id: 'interest-confirmation',
    displayName: '兴趣确认',
    enabled: true,
    modelProviderId: 'provider',
    modelId: 'model',
    role: 'explorer',
    roleDefinition: '识别学生兴趣',
    agentDefinition: null,
    capabilities: ['interest'],
  };
  let queryIndex = 0;
  const db = {
    select: () => {
      const currentQuery = queryIndex++;
      return {
        from: () => ({
          where: () => ({
            limit: async () => currentQuery === 0 ? [agent] : [],
          }),
        }),
      };
    },
  } as unknown as Database;
  const execute = createTeamAgentExecutor(db, { env: {}, policyPath: 'unused' });
  const job = {
    message: {
      senderAgentId: 'ai-tutor',
      recipientAgentId: 'interest-confirmation',
      payload: {},
      runId: 'run-1',
      attempts: 1,
    },
    task: { id: 'task-1', taskType: 'interest.confirm', input: {} },
  } as unknown as TeamMailboxJob;

  await assert.rejects(
    execute(job),
    (error: unknown) => error instanceof TeamAgentExecutionError && error.code === 'TEAM_AGENT_ROUTE_NOT_FOUND',
  );
});
