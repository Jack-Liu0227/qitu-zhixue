const assert = {
  equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`SDK assertion failed: ${String(actual)}`); },
  throws(work: () => unknown, pattern: RegExp) {
    try { work(); } catch (error) { if (error instanceof Error && pattern.test(error.message)) return; throw error; }
    throw new Error('Expected SDK rejection');
  },
};
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
}
