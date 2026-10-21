import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@qitu/database';
import {
  buildTeamAgentPrompt,
  createTeamAgentExecutor,
  defaultSkillRoots,
  loadAgentSkills,
  loadProjectionSkills,
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
import { adminAssistants, agentConfigs, agentProjectionCandidates, agentRoutes, agentSkillBindings, agentTeamEvents, agentTeamRuns,
  modelModels, modelProviders, modelUsageBindings, tutorSessions, tutorTurns } from '@qitu/database';
import { expressionQuestion, expressionSummary, growthProjectionResultSchema, validateGrowthProjectionResult } from '@qitu/contracts';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

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
  const root = mkdtempSync(join(tmpdir(), 'qitu-skill-root-'));
  const originalDirectory = process.cwd();
  try {
    writeFileSync(join(root, 'AGENTS.md'), '# Synthetic project');
    const nested = join(root, 'services', 'workers');
    mkdirSync(nested, { recursive: true });
    for (const directory of [root, nested]) {
      process.chdir(directory);
      assert.deepEqual(defaultSkillRoots({}), [join(root, '.agents', 'skills')]);
      assert.equal(defaultSkillRoots({}).some(path => path.includes(join('.pi', 'skills'))), false);
    }
    assert.deepEqual(defaultSkillRoots({ QITU_PROJECT_ROOT: nested }), [join(nested, '.agents', 'skills')]);
    const configured = `/tmp/skills-a${delimiter}/tmp/skills-b`;
    assert.deepEqual(defaultSkillRoots({ QITU_AGENT_SKILL_ROOTS: configured }), configured.split(delimiter));
  } finally {
    process.chdir(originalDirectory);
    rmSync(root, { recursive: true, force: true });
  }
});

test('dev-only skills are excluded and published skills have frontmatter removed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-skills-'));
  try {
    mkdirSync(join(root, 'dev-only'));
    writeFileSync(join(root, 'dev-only', 'SKILL.md'), '---\nruntime: dev-only\nname: 开发工具\n---\n不应进入 prompt');
    mkdirSync(join(root, 'legacy'));
    writeFileSync(join(root, 'legacy', 'SKILL.md'), '---\nname: 教学技能\nruntime: teaching\nstatus: published\ndescription: fixture\n---\n保留的教学正文');

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

test('projection skills fail closed on any unavailable or non-teaching configured ID', () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-projection-skills-'));
  try {
    for (const [id, runtime, status] of [
      ['valid', 'teaching', 'published'], ['admin', 'admin', 'published'],
      ['development', 'dev-only', 'published'], ['revoked', 'teaching', 'revoked'],
    ]) {
      mkdirSync(join(root, id!));
      writeFileSync(join(root, id!, 'SKILL.md'), `---\nname: ${id}\nruntime: ${runtime}\nstatus: ${status}\n---\nSynthetic teaching policy`);
    }
    assert.deepEqual(loadProjectionSkills(['valid'], [root], {}).map((skill) => skill.id), ['valid']);
    for (const id of ['missing', '../valid', 'admin', 'development', 'revoked']) {
      assert.throws(() => loadProjectionSkills(['valid', id], [root], {}), /PROJECTION_SKILL_UNAVAILABLE/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('global Admin configurator skills never enter teaching or projection worker prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-admin-skills-'));
  try {
    mkdirSync(join(root, 'qitu-project-configurator'));
    writeFileSync(join(root, 'qitu-project-configurator', 'SKILL.md'), '---\nname: qitu-project-configurator\nruntime: admin\nstatus: published\n---\nAdmin operations');
    assert.deepEqual(await loadAgentSkills(skillDb(['qitu-project-configurator']), 'profile', [root], {}), []);
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
      `---\nname: big\nruntime: teaching\nstatus: published\ndescription: ${'d'.repeat(3_000)}\n---\n${'正'.repeat(5_000)}`,
    );
    const skills = await loadAgentSkills(skillDb(['big']), 'agent', [root], {});
    assert.equal(skills[0]?.content.length, 5_000, '完整正文与 API 相同，不再按 4000 字符截断');
    assert.equal(skills[0]?.content.startsWith('正'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real Team executor sends scenario-selected model and rereads binding on next job', async () => {
  const requestedModels: string[] = [];
  const requestedBodies: string[] = [];
  let modelOutput = '{"confirmed":true}';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    requestedModels.push(JSON.parse(body).model);
    requestedBodies.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: modelOutput }, finish_reason: null }] })+'\n\ndata: '+JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n');
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
  let projectionModel: string | null = 'admin-model-a';
  let projectionPrompt = 'Canonical Admin instructions revision one';
  let projectionSkills: string[] = [];
  let projectionEnabled = true;
  let routeTrigger = 'delegate';
  let routeTaskType = 'interest.confirm';
  let boundAssistant = 'worker';
  let boundGrowthAssistant: string | null = null;
  let routeOutputSchema: Record<string, unknown> = { type: 'object', required: ['confirmed'] };
  let turnReads = 0;
  let runStudentId = 'student';
  const studentText = '我喜欢光学。缝宽变化有什么影响？';
  const db = {
    execute: async () => ({ rows: [{ revision: 3, config: { growthProjection: { profileAssistantId: boundAssistant, growthAssistantId: boundGrowthAssistant } } }] }),
    select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
    const modelId = new PgDialect().sqlToQuery(condition).params[1];
    const rows = table === agentConfigs ? [{ id: 'worker', enabled: true, modelProviderId: null, modelId: null, modelUsage: 'curriculum.plan', capabilities: [] }]
      : table === adminAssistants ? [{ id: 'worker', enabled: projectionEnabled, name: 'Canonical Admin assistant', role: 'analysis',
        instructions: projectionPrompt, modelProviderId: 'provider', modelId: projectionModel, enabledSkills: projectionSkills }]
      : table === modelUsageBindings ? [{ providerId: 'provider', modelId: selectedModel }]
      : table === modelModels ? [{ enabled: true, modelId: typeof modelId === 'string' ? modelId : selectedModel, inputModalities: ['text'], outputModalities: ['text'] }]
      : table === modelProviders ? [{ id: 'provider', name: 'Synthetic', enabled: true, baseUrl: `http://127.0.0.1:${address.port}`, api: 'openai-completions', encryptedApiKey: secret }]
      : table === agentRoutes ? [{ id: 'route', fromAgentId: 'tutor', toAgentId: 'worker', trigger: routeTrigger, taskType: routeTaskType, enabled: true, outputSchema: routeOutputSchema }]
      : table === agentTeamRuns ? [{ id: 'synthetic', leaderAgentId: 'tutor', studentUserId: runStudentId, projectId: null }]
      : table === agentTeamEvents ? [{ id: 'event', runId: 'synthetic', topic: 'tutor.turn.completed', payload: { sourceAgentId: 'tutor', studentUserId: 'student', projectId: null,
        sessionId: 'session', studentTurnId: 'student-turn', assistantTurnId: 'assistant-turn', studentSeq: 1, assistantSeq: 2, evidenceRef: 'learning_interaction:student-turn' } }]
      : table === tutorSessions ? [{ id: 'session', studentId: 'student', projectId: null, archivedAt: null }]
      : table === tutorTurns ? [turnReads++ % 2 === 0
        ? { id: 'student-turn', role: 'student', seq: 1, blocks: [{ kind: 'text', text: studentText }], createdAt: new Date('2026-10-21T00:00:00Z') }
        : { id: 'assistant-turn', role: 'assistant', seq: 2 }]
      : table === agentProjectionCandidates ? []
      : table === agentSkillBindings ? [] : [];
    return { limit: async () => rows, orderBy: () => ({ limit: async () => rows }), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }) } as unknown as Database;
  try {
    const execute = createTeamAgentExecutor(db, { env: { QITU_MODEL_SECRET_KEY: key.toString('hex') }, policyPath: 'unused' });
    const job = { message: { senderAgentId: 'tutor', recipientAgentId: 'worker', mailboxAgentId: 'worker', taskId: 'synthetic', messageType: 'task.request', payload: {}, runId: 'synthetic', attempts: 1 }, task: { id: 'synthetic', runId: 'synthetic', agentId: 'worker', taskType: 'interest.confirm', input: {} } } as unknown as TeamMailboxJob;
    assert.deepEqual(await execute(job), { confirmed: true });
    selectedModel = 'model-b';
    assert.deepEqual(await execute(job), { confirmed: true });
    assert.deepEqual(requestedModels, ['model-a', 'model-b']);
    routeTrigger = 'event';
    routeTaskType = 'profile.project';
    job.message.messageType = 'projection.request';
    job.task!.taskType = routeTaskType;
    job.task!.input = {
      projectionType: 'learner_profile',
      authorization: { routeId: 'route', trigger: 'event', fromAgentId: 'tutor', toAgentId: 'worker', taskType: routeTaskType },
    };
    assert.deepEqual(await execute(job), { confirmed: true });
    assert.equal(requestedModels.length, 3);
    assert.equal(requestedModels.at(-1), 'admin-model-a', 'projection uses Admin direct selection instead of runtime usage');
    assert.ok(requestedBodies.at(-1)!.includes(projectionPrompt));
    projectionModel = 'admin-model-b';
    projectionPrompt = 'Canonical Admin instructions revision two';
    assert.deepEqual(await execute(job), { confirmed: true });
    assert.equal(requestedModels.at(-1), 'admin-model-b');
    assert.ok(requestedBodies.at(-1)!.includes(projectionPrompt), 'Admin prompt changes apply to the next task');
    const configuredCalls = requestedModels.length;
    projectionModel = null;
    await assert.rejects(execute(job), /TEAM_AGENT_MODEL_NOT_CONFIGURED/);
    projectionModel = 'admin-model-b';
    projectionSkills = ['missing-canonical-skill'];
    await assert.rejects(execute(job), /PROJECTION_SKILL_UNAVAILABLE/);
    projectionSkills = [];
    projectionEnabled = false;
    await assert.rejects(execute(job), /PROJECTION_ASSISTANT_UNAVAILABLE/);
    projectionEnabled = true;
    assert.equal(requestedModels.length, configuredCalls, 'invalid Admin configuration cannot call the model');
    boundAssistant = 'replacement';
    await assert.rejects(execute(job), /PROJECTION_PURPOSE_CHANGED/);
    assert.equal(requestedModels.length, configuredCalls, 'revoked binding must not invoke the model');
    boundAssistant = 'worker';
    routeOutputSchema = { type: 'object', required: ['version'] };
    job.task!.input = { ...job.task!.input, sourceTopic: 'tutor.turn.completed', sourceEventId: 'event', studentUserId: 'student', projectId: null };
    const profileOutput = { version: 1, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null,
      interests: ['光学'], preferences: [], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')] };
    modelOutput = JSON.stringify(profileOutput);
    const valid = await execute(job);
    assert.deepEqual(valid.result, profileOutput);
    assert.equal((valid.analysisManifest as Record<string, unknown>).sourceEventId, 'event');
    assert.ok(requestedBodies.at(-1)!.includes(studentText), 'authorized model request consumes real private student content');
    const profilePrompt = JSON.parse(requestedBodies.at(-1)!).messages[0].content as string;
    assert.ok(profilePrompt.includes(JSON.stringify({ ...growthProjectionResultSchema('learner_profile'), allOf: [routeOutputSchema] })),
      'actual Tutor profile request includes the complete closed contract and route restrictions');
    assert.equal(JSON.stringify(valid).includes(studentText), false);
    assert.equal(JSON.stringify(job.task!.input).includes(studentText), false);
    modelOutput = JSON.stringify({ ...profileOutput, rawConversation: studentText });
    const invalid = await execute(job);
    assert.equal(invalid.result, null);
    assert.equal(invalid.analysisErrorCode, 'PROJECTION_UNKNOWN_FIELD');
    assert.equal(JSON.stringify(invalid).includes(studentText), false, 'arbitrary model echoes are not persisted even as proposed results');
    modelOutput = JSON.stringify(profileOutput);
    routeOutputSchema = { type: 'object', required: ['version'], properties: { version: { type: 'string' } } };
    await assert.rejects(execute(job), /TEAM_AGENT_OUTPUT_SCHEMA_MISMATCH/, 'route schema still restricts projection output');
    routeOutputSchema = { type: 'object', required: ['version'] };
    boundGrowthAssistant = 'worker';
    routeTaskType = 'growth.project';
    job.task!.taskType = routeTaskType;
    job.task!.input = { ...job.task!.input, projectionType: 'growth_trajectory',
      authorization: { routeId: 'route', trigger: 'event', fromAgentId: 'tutor', toAgentId: 'worker', taskType: routeTaskType } };
    const growthOutput = { version: 1, milestones: [], strengths: [], nextQuestions: [],
      studentSummary: expressionSummary(profileOutput.interests[0]!), evidenceRefs: ['learning_interaction:student-turn'], confidence: 'low' };
    modelOutput = JSON.stringify(growthOutput);
    assert.deepEqual((await execute(job)).result, growthOutput);
    const growthPrompt = JSON.parse(requestedBodies.at(-1)!).messages[0].content as string;
    assert.ok(growthPrompt.includes(JSON.stringify({ ...growthProjectionResultSchema('growth_trajectory'), allOf: [routeOutputSchema] })),
      'actual Tutor growth request includes every allowed/required result field');
    const callCount = requestedModels.length;
    const readCount = turnReads;
    runStudentId = 'foreign-student';
    await assert.rejects(execute(job), /PROJECTION_OWNER_INVALID/);
    assert.equal(requestedModels.length, callCount, 'foreign run cannot cause private content to be sent to the model');
    assert.equal(turnReads, readCount, 'run ownership is checked before reading raw turn content');
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

test('projection prompts declare every allowed field as required and forbid additional fields', () => {
  const profile = growthProjectionResultSchema('learner_profile');
  const growth = growthProjectionResultSchema('growth_trajectory');
  const contracts = [
    { schema: profile, keys: ['version', 'priorKnowledge', 'targetLevel', 'timeBudgetMinutesPerWeek', 'preferences', 'interests', 'strengths', 'nextQuestions'],
      sample: { version: 1, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null, preferences: [], interests: [], strengths: [], nextQuestions: [] } },
    { schema: growth, keys: ['version', 'milestones', 'strengths', 'nextQuestions', 'studentSummary', 'evidenceRefs', 'confidence'],
      sample: { version: 1, milestones: [], strengths: [], nextQuestions: [], studentSummary: null, evidenceRefs: ['learning_interaction:turn'], confidence: 'low' } },
  ];
  for (const [index, contract] of contracts.entries()) {
    assert.deepEqual(contract.schema.required, contract.keys);
    assert.equal(contract.schema.additionalProperties, false);
    assert.ok(contract.schema.properties && typeof contract.schema.properties === 'object');
    assert.deepEqual(Object.keys(contract.schema.properties), contract.keys);
    assert.equal(validateGrowthProjectionResult(index === 0 ? 'learner_profile' : 'growth_trajectory', contract.sample).ok, true);
    const prompt = buildTeamAgentPrompt({ agent: { id: 'projection', displayName: 'Projection', role: 'analysis',
      roleDefinition: '', agentDefinition: '', capabilities: ['reflect'] }, taskType: 'projection', taskInput: {},
      globalPolicy: '', skills: [], outputSchema: contract.schema });
    assert.ok(prompt.system.includes(JSON.stringify(contract.schema)));
    for (const key of contract.keys) assert.ok(prompt.system.includes(`"${key}"`));
    assert.throws(() => parseStructuredAgentOutput(JSON.stringify({ ...contract.sample, commentary: 'not allowed' }), contract.schema),
      /TEAM_AGENT_OUTPUT_SCHEMA_MISMATCH/);
    for (const key of contract.keys) {
      const incomplete: Record<string, unknown> = { ...contract.sample };
      delete incomplete[key];
      assert.throws(() => parseStructuredAgentOutput(JSON.stringify(incomplete), contract.schema), /TEAM_AGENT_OUTPUT_SCHEMA_MISMATCH/);
    }
  }
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
      mailboxAgentId: 'interest-confirmation',
      taskId: 'task-1',
      messageType: 'task.request',
      payload: {},
      runId: 'run-1',
      attempts: 1,
    },
    task: { id: 'task-1', runId: 'run-1', agentId: 'interest-confirmation', taskType: 'interest.confirm', input: {} },
  } as unknown as TeamMailboxJob;

  await assert.rejects(
    execute(job),
    (error: unknown) => error instanceof TeamAgentExecutionError && error.code === 'TEAM_AGENT_ROUTE_NOT_FOUND',
  );
});

test('worker rejects admin, revoked, unknown and unreviewed sources using shared admission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-scope-'));
  try {
    const sources = [
      ['admin', 'runtime: admin\nstatus: published'],
      ['revoked', 'runtime: teaching\nstatus: revoked'],
      ['unknown', 'runtime: typo\nstatus: published'],
      ['draft', 'runtime: teaching'],
      ['published', 'runtime: teaching\nstatus: published'],
    ];
    for (const [id, header] of sources) {
      mkdirSync(join(root, id!));
      writeFileSync(join(root, id!, 'SKILL.md'), `---\n${header}\n---\nBody`);
    }
    const loaded = await loadAgentSkills(skillDb(sources.map(item => item[0]!)), 'agent', [root], {});
    assert.deepEqual(loaded.map(skill => skill.id), ['published']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a published skill cannot invent a required worker executor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-team-required-'));
  try {
    mkdirSync(join(root, 'needs-tools'));
    writeFileSync(join(root, 'needs-tools', 'SKILL.md'), '---\nruntime: teaching\nstatus: published\nrequiredToolIds: knowledge_search\n---\nRead evidence');
    await assert.rejects(loadAgentSkills(skillDb(['needs-tools']), 'agent', [root], {}), /TEAM_AGENT_TOOL_NOT_CONFIGURED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
