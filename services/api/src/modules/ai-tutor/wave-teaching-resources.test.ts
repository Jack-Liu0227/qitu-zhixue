import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { createLessonActivityChannel } from './tutor-lesson-activity';
import type { ImaReadEvidence } from './ima-project-scope';

async function fixture() {
  const f = teachingContextFixture();
  f.teaching.template.curriculum!.profiles[0]!.sessions[0]!.requiredToolIds = ['tutor.propose_wave_activity'];
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const runtime = { agent: { enabled: true, capabilities: ['teach'] },
    skills: [{ id: 'pbl-dynamic-lesson', publicationStatus: 'reviewed' }],
    tools: builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity', 'tutor.propose_wave_activity']) } as unknown as EffectiveAgentRuntime;
  const source: ImaReadEvidence = { sourceRef: 'ima-read:verified', title: '实际读取的课件', knowledgeBaseId: 'authorized-kb',
    documentRefHash: 'a'.repeat(64), expiresAt: Date.now() + 60000 };
  let reads = 0; let allowed = true;
  const input = { teaching, runtime, idempotencyKey: 'turn',
    scope: { projectId: f.project.id, planId: f.plan.id, planRevision: f.plan.version,
      learningSessionId: teaching.session.id, objectiveId: teaching.objective!.id, tutorSessionId: 'chat' },
    refresh: async () => ({ teaching, runtime }),
    verifyEvidence: async (refs: readonly string[]) => {
      reads++; if (!allowed || refs.some(ref => ref !== source.sourceRef)) throw new ConflictException({ code: 'TUTOR_RESOURCE_UNVERIFIED' }); return [source];
    }, proposeOptics: async (): Promise<never> => { throw Error('not called'); } };
  return { input, source, reads: () => reads, revoke: () => { allowed = false; } };
}
const board = { kind: 'board', title: '本课图示', steps: [{ caption: '先比较两个输入。', tex: 'y=y_1+y_2' }] };

test('conceptual wave preview is read-only, opt-in and blocked while an assessment is pending', async () => {
  const h = await fixture(); const candidate = { kind: 'wave_preview', title: '先观察两个图样' };
  const channel = createLessonActivityChannel(h.input);
  await channel.tools[0]!.execute(candidate);
  const result = channel.blocks()[0]; assert.ok(result?.kind === 'board');
  assert.equal(result.steps.length, 2); assert.ok(result.steps.every(step => step.svg && !/script|foreignObject|https?:/iu.test(step.svg)));
  assert.doesNotMatch(JSON.stringify(result), /experimentId|actionId|observationReceipt/);
  const pending = createLessonActivityChannel({ ...h.input, assessmentPending: true });
  assert.deepEqual(pending.tools, []); assert.deepEqual(pending.blocks(), []);
  const arbitrary = createLessonActivityChannel(h.input);
  await assert.rejects(arbitrary.tools[0]!.execute({ ...candidate, parameters: { wavelength: 600 } }));
});

test('wave teaching chooses generated boards, verified recommendations, and attributed adaptations', async () => {
  const h = await fixture(); const generated = createLessonActivityChannel(h.input);
  await generated.tools[0]!.execute({ ...board, origin: 'generated' });
  assert.equal(generated.blocks()[0]?.kind, 'board'); assert.equal(h.reads(), 0);
  const recommended = createLessonActivityChannel(h.input);
  const candidate = { kind: 'recommendation', title: '一起读课件', summary: '先观察波的叠加。', sourceRefs: [h.source.sourceRef] };
  await Promise.all([recommended.tools[0]!.execute(candidate), recommended.tools[0]!.execute(candidate)]);
  assert.deepEqual(recommended.blocks(), [{ kind: 'learning_resource', title: candidate.title, summary: candidate.summary,
    sources: [{ sourceRef: h.source.sourceRef, title: h.source.title }] }]);
  const adapted = createLessonActivityChannel(h.input);
  await adapted.tools[0]!.execute({ ...board, origin: 'adapted', sourceRefs: [h.source.sourceRef] });
  const block = adapted.blocks()[0]; assert.ok(block?.kind === 'board');
  assert.equal(block.provenance?.origin, 'adapted'); assert.equal(block.provenance?.sources[0]?.title, h.source.title);
  assert.doesNotMatch(JSON.stringify(block), /authorized-kb|documentRefHash|https?:/);
});

test('unread, expired, revoked or invented claims cannot produce resources or replace a pending quiz', async () => {
  const h = await fixture();
  const candidate = { kind: 'recommendation', title: '资料', summary: '本课目标', sourceRefs: [h.source.sourceRef] };
  for (const value of [{ ...candidate, title: 'https://invalid.example' }, { ...candidate, sourceRefs: ['invented'] },
    { ...candidate, url: 'https://invalid.example' }, { ...candidate, sourceRefs: [h.source.sourceRef, h.source.sourceRef] }]) {
    const channel = createLessonActivityChannel(h.input);
    assert.equal((await channel.tools[0]!.execute(value)).isError, true); assert.deepEqual(channel.blocks(), []);
  }
  h.source.expiresAt = 0;
  assert.equal((await createLessonActivityChannel(h.input).tools[0]!.execute(candidate)).isError, true);
  h.source.expiresAt = Date.now() + 60000; h.revoke();
  assert.equal((await createLessonActivityChannel(h.input).tools[0]!.execute(candidate)).isError, true);
  const pending = { kind: 'quiz' as const, questionId: 'owner-question', stem: '待回答', options: [{ key: 'a', text: '选项' }] };
  const channel = createLessonActivityChannel({ ...h.input, pendingQuestion: pending, restorePending: true });
  assert.deepEqual(channel.tools, []); assert.deepEqual(channel.blocks(), [pending]);
});
