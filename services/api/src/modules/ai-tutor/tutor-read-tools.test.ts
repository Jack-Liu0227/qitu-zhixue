import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantRuntimeFixture } from '../platform-registry/assistant-runtime.test-fixture';
import { QituSDKFactory } from '../qitu-sdk/qitu-sdk.service';
import { tutorReadTools } from './tutor-read-tools';
import { tutorToolEvent } from './tutor-tool-events';

test('model readers use the same SDK owner scope and recheck live assistant revocation', async () => {
  const h = assistantRuntimeFixture();
  h.assistant.toolIds = ['mastery_query', 'student_profile_get', 'tutor.mastery_gate'];
  const reads: string[] = [], audits: string[] = [];
  const actor = { id: 'student-owner', role: 'student' as const, email: '', displayName: '' };
  const factory = new QituSDKFactory({ forActor: (current: typeof actor) => ({
    getCurrent: async ({ studentId }: { studentId: string }) => {
      assert.equal(current.id, actor.id); assert.equal(studentId, actor.id); reads.push('mastery'); return [];
    },
  }) } as never, {} as never, { getMasteryProfile: async (current: typeof actor, studentId: string) => {
    assert.equal(current.id, actor.id); assert.equal(studentId, actor.id); reads.push('profile'); return { summary: {} };
  } } as never, {} as never, h.service, 'live');
  const sdk = factory.create(actor, { studentId: actor.id, projectId: null }, async () => null, undefined, undefined,
    { assistantId: h.assistant.id, configurationHash: '' });
  const tools = await tutorReadTools(sdk, async id => { audits.push(id); });
  assert.deepEqual(tools.map(tool => tool.name), ['mastery_query', 'student_profile_get']);
  assert.equal((await tools[0]!.execute({ studentId: 'another-student' })).isError, true);
  assert.equal(reads.length, 0);
  for (const tool of tools) assert.notEqual((await tool.execute({})).isError, true);
  assert.deepEqual(reads, ['mastery', 'profile']); assert.equal(audits.length, 2);
  h.assistant.toolIds = [];
  assert.equal((await tools[0]!.execute({})).isError, true);
  assert.equal(reads.length, 2); assert.equal(audits.length, 2);
});

test('tool receipts distinguish an empty search, a lookup and a persisted activity', () => {
  const event = { type: 'result' as const, callId: 'one', name: 'knowledge_search', isError: false };
  assert.match(JSON.stringify(tutorToolEvent({ ...event, outcome: 'empty' })), /未找到相关资料/);
  assert.doesNotMatch(JSON.stringify(tutorToolEvent({ ...event, name: 'tutor_propose_lesson_activity' })), /已保存/);
  assert.match(JSON.stringify(tutorToolEvent({ ...event, outcome: 'unchanged' })), /继续使用已保存/);
  assert.match(JSON.stringify(tutorToolEvent({ ...event, isError: true, errorCode: 'COURSEWARE_INVALID' })), /格式需要调整/);
});
