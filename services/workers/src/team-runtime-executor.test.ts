import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@qitu/database';
import {
  buildTeamAgentPrompt,
  createTeamAgentExecutor,
  defaultSkillRoots,
  loadAgentSkills,
  parseStructuredAgentOutput,
  TeamAgentExecutionError,
  resolveTeamAgentModel,
} from './team-runtime-executor';
import type { TeamMailboxJob } from './team-runtime-mailbox-source';
import { createServer } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { agentConfigs, agentRoutes, agentSkillBindings, modelModels, modelProviders, modelUsageBindings } from '@qitu/database';

function routingDb(rows: unknown[][]): Database {
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }) }) } as unknown as Database;
}

function skillDb(skillIds: string[]): Database {
  return { select: () => ({
    from: () => ({
      where: async () => skillIds.map((skillId) => ({ skillId })),
    }),
  }) } as unknown as Database;
}

test('default skill roots use only the runtime root unless explicitly configured', () => {
  assert.deepEqual(defaultSkillRoots({}), [join(process.cwd(), '.agents', 'skills')]);
  assert.equal(defaultSkillRoots({}).some((root) => root.includes(join('.pi', 'skills'))), false);
  const configured = `/tmp/skills-a${delimiter}/tmp/skills-b`;
  assert.deepEqual(defaultSkillRoots({ QITU_AGENT_SKILL_ROOTS: configured }), configured.split(delimiter));
});

test('dev-only skills are excluded and legacy skills have frontmatter removed before prompt injection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-'));
  try {
    mkdirSync(join(root, 'dev-only'));
    writeFileSync(join(root, 'dev-only', 'SKILL.md'), '---\nruntime: dev-only\nname: 开发工具\n---\n不应进入 prompt');
    mkdirSync(join(root, 'legacy'));
    writeFileSync(join(root, 'legacy', 'SKILL.md'), '---\nname: 教学技能\ndescription: legacy\n---\n保留的教学正文');

    const skills = await loadAgentSkills(skillDb(['dev-only', 'legacy']), 'agent', [root], {});
    assert.deepEqual(skills.map((skill) => skill.id), ['legacy']);
    const prompt = buildTeamAgentPrompt({
      agent: {
        id: 'agent',
        displayName: '测试 Agent',
        role: 'test',
        roleDefinition: '测试',
        agentDefinition: '测试',
        capabilities: [],
      },
      taskType: 'test',
      taskInput: {},
      globalPolicy: '',
      skills,
    });
    assert.match(prompt.system, /保留的教学正文/u);
    assert.doesNotMatch(prompt.system, /开发工具|不应进入 prompt/u);
    assert.doesNotMatch(prompt.system, /^---$/mu);
    assert.doesNotMatch(prompt.system, /^name:/mu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing skill files are ignored without throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-missing-'));
  try {
    assert.deepEqual(await loadAgentSkills(skillDb(['missing']), 'agent', [root], {}), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('超长 frontmatter 的 dev-only 技能仍被排除（截断顺序回归）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-long-'));
  try {
    mkdirSync(join(root, 'sneaky'));
    // frontmatter 单独就超过 MAX_SKILL_CHARS(4000)。旧实现先按预算截断再剔除，
    // 会把 runtime 标记截掉 → 过滤失效，并把 frontmatter 原文当教学规则注入 prompt。
    writeFileSync(
      join(root, 'sneaky', 'SKILL.md'),
      `---\nname: 开发工具\ndescription: ${'x'.repeat(5_000)}\nruntime: dev-only\n---\n不应进入 prompt`,
    );
    assert.deepEqual(await loadAgentSkills(skillDb(['sneaky']), 'agent', [root], {}), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontmatter 损坏时 fail-closed，不把未知文本注入 prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-broken-'));
  try {
    mkdirSync(join(root, 'broken'));
    // 有开头 --- 但无闭合：无法判定是否 dev-only，宁可不注入。
    writeFileSync(join(root, 'broken', 'SKILL.md'), '---\nname: 教学技能\nruntime: teaching\n');
    assert.deepEqual(await loadAgentSkills(skillDb(['broken']), 'agent', [root], {}), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('正文预算不被 frontmatter 占用', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-budget-'));
  try {
    mkdirSync(join(root, 'big'));
    writeFileSync(
      join(root, 'big', 'SKILL.md'),
      `---\nname: big\ndescription: ${'d'.repeat(3_000)}\n---\n${'正'.repeat(5_000)}`,
    );
    const skills = await loadAgentSkills(skillDb(['big']), 'agent', [root], {});
    assert.equal(skills[0]?.content.length, 4_000, '正文应恰好拿到 MAX_SKILL_CHARS 预算');
    assert.equal(skills[0]?.content.startsWith('正'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
