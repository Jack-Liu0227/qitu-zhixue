const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`SDK assertion failed: ${String(actual)}`); },
  throws(work: () => unknown, pattern: RegExp) {
    try { work(); } catch (error) { if (error instanceof Error && pattern.test(error.message)) return; throw error; }
    throw new Error('Expected SDK rejection');
  },
};
import { BUILTIN_ASSISTANTS } from './assistant-registry.js';
import { createQituSDK, type QituSDK, type QituSDKPorts } from './qitu-sdk.js';
import type { MasteryTimelinePort } from '@qitu/contracts';

export async function runQituSDKAssertions() {
  const calls: unknown[] = [];
  const mastery = Object.fromEntries(['evaluate', 'getCurrent', 'getTimeline', 'snapshot', 'checkThreshold', 'getRegressionAlerts'].map((method) => [method, async (input: unknown) => { calls.push(input); return []; }])) as unknown as MasteryTimelinePort;
  const ports: QituSDKPorts<string, string, { studentId: string }> = {
    mastery,
    agent: { run: async (input, scope) => `${scope.studentId}:${input}` },
    project: {
      canAdvance: async () => ({ allowed: false, stage: 'theory_check', nextStage: 'practice_ready', reason: 'THEORY_MASTERED_REQUIRED' }),
      advance: async () => ({ allowed: true, stage: 'theory_learning', nextStage: 'theory_check', reason: 'ok' }),
    },
    profile: { get: async (scope) => ({ studentId: scope.studentId }) },
  };
  const scope = { studentId: 'student', projectId: 'project' };
  const sdk = createQituSDK(scope, ports);
  const typedSdk: QituSDK<string, string, { studentId: string }> = sdk;
  scope.studentId = 'changed';
  await sdk.mastery.getCurrent();
  assert.equal((calls[0] as { studentId: string }).studentId, 'student');
  assert.equal(await sdk.agent.run('hello'), 'student:hello');
  assert.equal((await sdk.project.canAdvance()).allowed, false);
  assert.equal((await sdk.profile.get()).studentId, 'student');
  assert.throws(() => sdk.mastery.getCurrent({ studentId: 'other' } as never), /SDK_SCOPE_MISMATCH/);
  assert.throws(() => sdk.project.advance(''), /IDEMPOTENCY_KEY_REQUIRED/);
  assert.throws(() => createQituSDK(scope, {} as never), /SDK_PORT_NOT_CONFIGURED/);
  assert.equal(BUILTIN_ASSISTANTS.every((assistant) => assistant.enabledSkills.every((skillId) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(skillId))), true);
  assert.equal(BUILTIN_ASSISTANTS.every((assistant) => assistant.defaults.skills.value.every((skillId) => assistant.enabledSkills.includes(skillId))), true);
  const rejects = async (work: Promise<unknown>, code: string) => {
    try { await work; } catch (error) { assert.equal((error as Error).message, code); return; }
    throw new Error('Expected SDK rejection: ' + code);
  };
  assert.equal((await sdk.skills.list()).length, 0);
  assert.equal((await sdk.assistants.list()).length, 0);
  assert.equal((await sdk.teams.list()).length, 0);
  await rejects(sdk.teams.getMembers('unknown'), 'SDK_TEAM_NOT_AVAILABLE');
  await rejects(sdk.tools.call('unknown', {}), 'SDK_TOOL_NOT_FOUND');
  await rejects(sdk.mcp.callTool('server', 'tool', {}), 'SDK_MCP_NOT_CONFIGURED');
  let executions = 0;
  let allowed = false;
  const configured = createQituSDK({ studentId: 'student', projectId: 'project' }, {
    ...ports,
    tools: {
      unavailable: { id: 'unavailable', name: 'unavailable', description: '' },
      read: { id: 'read', name: 'read', description: '', authorize: async () => allowed,
        execute: async (_args, bound) => { executions++; return bound.studentId; } },
    },
    authorizeMcp: async () => allowed,
    mcpExecutor: async (_call, bound) => { executions++; return bound.projectId; },
  });
  await rejects(configured.tools.call('unavailable', {}), 'SDK_TOOL_NOT_CONFIGURED');
  await rejects(configured.tools.call('read', {}), 'SDK_TOOL_DENIED');
  await rejects(configured.mcp.callTool('s', 't', {}), 'SDK_MCP_DENIED');
  assert.equal(executions, 0);
  allowed = true;
  assert.equal(await configured.tools.call('read', {}), 'student');
  assert.equal(await configured.mcp.callTool('s', 't', {}), 'project');
  assert.equal((await configured.tools.get('read'))?.execute, undefined);
  await rejects(configured.tools.call('read', { studentId: 'foreign' }), 'SDK_SCOPE_MISMATCH');
  allowed = false;
  await rejects(configured.tools.call('read', {}), 'SDK_TOOL_DENIED');
  assert.equal(executions, 2);

}
