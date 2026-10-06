import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@qitu/database';
import {
  buildTeamAgentPrompt,
  createTeamAgentExecutor,
  parseStructuredAgentOutput,
  TeamAgentExecutionError,
} from './team-runtime-executor';
import type { TeamMailboxJob } from './team-runtime-mailbox-source';

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
