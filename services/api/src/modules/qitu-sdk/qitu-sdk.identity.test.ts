import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { hashRequest } from '../../common/idempotency';
import { assistantRuntimeFixture } from '../platform-registry/assistant-runtime.test-fixture';
import { QituSDKFactory } from './qitu-sdk.service';

async function fixture(selection = { providerId: 'chosen-provider', modelId: 'same-model-name' }) {
  const h = assistantRuntimeFixture();
  let executions = 0;
  const factory = new QituSDKFactory({
    forActor: () => ({ getCurrent: async () => [] }), reassessProjectEvidence: async () => undefined,
  } as never, {} as never, {} as never, {
    resolvePurposeByModel: async (selection: { providerId: string; modelId: string }) => ({
      usageId: 'agent.model', available: selection.providerId === 'chosen-provider', input: ['text'], output: ['text'], modelId: selection.modelId,
    }),
  } as never, h.service, 'live');
  const runtime = await h.service.getAssistantRuntime(h.assistant.id);
  const sdk = factory.create(
    { id: 'synthetic-owner', role: 'student', email: '', displayName: '' },
    { studentId: 'synthetic-owner', projectId: 'synthetic-project' },
    async (_input: { content: string; idempotencyKey: string; partnerId?: string }) => { executions += 1; return 'candidate'; },
    'tutor.chat', selection,
    { assistantId: h.assistant.id, configurationHash: hashRequest(runtime) },
  );
  return { ...h, sdk, executions: () => executions };
}

test('SDK executes Admin-only identity and ignores a client-shaped partnerId in runner input', async () => {
  const h = await fixture();
  assert.equal(await h.sdk.agent.run({ content: 'A synthetic question', idempotencyKey: 'one', partnerId: 'qitu-learning-partner' }), 'candidate');
  assert.equal(h.executions(), 1);
});

test('SDK rechecks current identity/enable and rejects a retained facade after revocation', async () => {
  const h = await fixture();
  await h.sdk.agent.run({ content: 'A synthetic question', idempotencyKey: 'one' });
  h.assistant.enabled = false;
  await assert.rejects(h.sdk.agent.run({ content: 'Another question', idempotencyKey: 'two' }), /AGENT_ROLE_DISABLED/);
  assert.equal(h.executions(), 1);
});

test('SDK refuses prompt/skill/model changes during one turn instead of mixing old and new configuration', async () => {
  for (const change of ['prompt', 'skill', 'model'] as const) {
    const h = await fixture();
    if (change === 'prompt') h.assistant.instructions = 'CHANGED_MENTOR_INSTRUCTION';
    if (change === 'skill') h.assistant.enabledSkills = [];
    if (change === 'model') h.assistant.modelProviderId = 'other-provider';
    await assert.rejects(h.sdk.agent.run({ content: 'A synthetic question', idempotencyKey: 'one' }), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as { code: string }).code, 'ASSISTANT_RUNTIME_CHANGED');
      return true;
    });
    assert.equal(h.executions(), 0);
  }
});

test('SDK rejects the same bare model name from another provider even with a matching configuration token', async () => {
  const h = await fixture({ providerId: 'other-provider', modelId: 'same-model-name' });
  await assert.rejects(h.sdk.agent.run({ content: 'A synthetic question', idempotencyKey: 'one' }), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'ASSISTANT_MODEL_IDENTITY_MISMATCH');
    return true;
  });
  assert.equal(h.executions(), 0);
});

test('SDK skill catalog and tool calls share the frozen resolver and respect later revocation', async () => {
  const h = assistantRuntimeFixture();
  const runtime = await h.service.getAssistantRuntime(h.assistant.id);
  runtime.tools = [{ id: 'mastery_query', name: 'mastery_query', version: 'v1', kind: 'builtin',
    actorRoles: ['student'], agentIds: [h.assistant.id], description: 'fixture' } as never];
  runtime.agent.toolIds = ['mastery_query', 'student_profile_get'];
  let current = runtime;
  let reads = 0;
  let mutableReads = 0;
  let executed = 0;
  const factory = new QituSDKFactory({ forActor: () => ({ getCurrent: async () => { executed++; return []; } }) } as never,
    {} as never, {} as never, {} as never, {
      getAssistantRuntime: async () => { mutableReads++; throw new Error('MUTABLE_RUNTIME_FORBIDDEN'); },
    } as never, 'live');
  const sdk = factory.create({ id: 'owner', role: 'student', email: '', displayName: '' },
    { studentId: 'owner', projectId: 'project' }, async () => null, undefined, undefined,
    { assistantId: h.assistant.id, configurationHash: hashRequest(runtime), resolveRuntime: async () => { reads++; return current; } });
  assert.deepEqual((await sdk.skills.list()).map(skill => skill.id), runtime.skills.map(skill => skill.id));
  assert.deepEqual((await sdk.tools.list()).map(tool => tool.id), ['mastery_query']);
  await sdk.tools.call('mastery_query', {});
  assert.equal(executed, 1);
  current = { ...runtime, tools: [] };
  await assert.rejects(sdk.tools.call('mastery_query', {}), /SDK_TOOL_NOT_FOUND/);
  assert.equal(executed, 1);
  assert.equal(mutableReads, 0);
  assert.ok(reads >= 5);
});
