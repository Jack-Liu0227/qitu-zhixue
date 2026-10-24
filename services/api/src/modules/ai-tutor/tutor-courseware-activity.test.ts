import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WAVE_TEACHING_TEMPLATE_SPEC, WAVE_OPTICS_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { createLessonActivityChannel } from './tutor-lesson-activity';
import { createCoursewareActivityPort } from './tutor-courseware-activity';
import { CoursewareService } from '../knowledge/courseware.service';
import { InMemoryCoursewareStore } from '../knowledge/courseware.store';
import type { AuditWriter } from '../../common/audit/audit.service';

test('new template covers all eight lessons without changing legacy readiness or practice gates', () => {
  assert.notEqual(WAVE_TEACHING_TEMPLATE_SPEC.version, WAVE_OPTICS_TEMPLATE_SPEC.version);
  const current = WAVE_TEACHING_TEMPLATE_SPEC.curriculum!.profiles[0]!, legacy = WAVE_OPTICS_TEMPLATE_SPEC.curriculum!.profiles[0]!;
  assert.notEqual(current.id, legacy.id); assert.equal(current.sessions.length, 8);
  for (const [i, lesson] of current.sessions.entries()) {
    assert.deepEqual(lesson.teachingSpec!.concepts.map(c => c.objectiveId), lesson.objectiveIds);
    assert.deepEqual(lesson.checkpoint, legacy.sessions[i]!.checkpoint);
    assert.deepEqual(lesson.completionSpec, legacy.sessions[i]!.completionSpec);
    assert.equal(legacy.sessions[i]!.teachingSpec, undefined);
  }
  const invalid = structuredClone(WAVE_TEACHING_TEMPLATE_SPEC);
  invalid.curriculum!.profiles[0]!.sessions[0]!.requiredToolIds = [];
  assert.equal(validateProjectTemplateSpec(invalid).valid, false);
});

test('new source-grounded boards persist; find does not consume a turn; pending and revocation block every content path', async () => {
  const f = teachingContextFixture();
  const lesson = f.teaching.template.curriculum!.profiles[0]!.sessions[0]!;
  lesson.teachingSpec = { version: 'zero-base.v1', sourceRequired: true, courseware: 'reviewed-with-project-generation.v1',
    concepts: [{ objectiveId: 'objective-1', introduction: 'Explain displacement before checking.' }] };
  lesson.requiredToolIds = ['tutor.propose_courseware_activity'];
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const runtime = { agent: { enabled: true, capabilities: ['teach'] }, skills: [{ id: 'pbl-dynamic-lesson', publicationStatus: 'reviewed' }],
    tools: builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity', 'tutor.propose_courseware_activity']) } as unknown as EffectiveAgentRuntime;
  const store = new InMemoryCoursewareStore(), service = new CoursewareService(store, { write: async () => 'audit' } as AuditWriter);
  const source = { sourceRef: 'knowledge-read:source', knowledgeBaseId: 'kb', documentRefHash: 'a'.repeat(64), title: 'Wave source', expiresAt: Date.now() + 60000 };
  let allowed = true;
  const verify = async (refs: readonly string[]) => { assert.ok(allowed && refs.length === 1 && refs[0] === source.sourceRef); return [source]; };
  const scope = { projectId: f.project.id, planId: f.plan.id, planRevision: f.plan.version, learningSessionId: teaching.session.id,
    objectiveId: teaching.objective!.id, tutorSessionId: 'chat', activityId: 'session:activity:theory' };
  const input = { teaching, runtime, scope, idempotencyKey: 'turn', refresh: async () => ({ teaching, runtime }), verifyEvidence: verify,
    proposeOptics: async (): Promise<never> => { throw Error('practice not called'); },
    courseware: createCoursewareActivityPort({ service, teaching, scope, studentId: f.project.studentId, verify, allowedLibraries: async () => ['kb'] }) };
  const board = { kind: 'board', title: 'Displacement', steps: [{ caption: 'Add displacements.', tex: 'y=y_1+y_2' }], objectiveRefs: ['objective-1'], sourceRefs: [source.sourceRef] };
  const channel = createLessonActivityChannel(input);
  const correction = await channel.tools[0]!.execute({ kind: 'find_courseware', use: 'explain', title: 'Extra metadata' });
  assert.equal(correction.isError, true); assert.match(correction.text, /ONLY kind and use/);
  await channel.tools[0]!.execute({ kind: 'find_courseware', use: 'explain' }); assert.deepEqual(channel.blocks(), []);
  await assert.rejects(channel.tools[0]!.execute({ ...board, sourceRefs: ['invented'] }));
  const saved = await channel.tools[0]!.execute({ ...board, use: 'explain', summary: 'A bounded teaching summary.' });
  assert.equal(saved.isError, undefined); assert.equal(saved.outcome, 'accepted');
  assert.equal(channel.blocks()[0]?.kind, 'board');
  const duplicate = await channel.tools[0]!.execute({ ...board, title: 'Another board' });
  assert.equal(duplicate.isError, undefined); assert.equal(duplicate.outcome, 'unchanged');
  assert.equal(channel.blocks().length, 1);
  assert.equal((await store.instances(scope.projectId, scope.planId, scope.planRevision, scope.learningSessionId)).length, 1);
  for (const candidate of [board, { kind: 'find_courseware', use: 'explain' }, { kind: 'reuse_courseware', assetVersionId: 'guess', sourceRefs: [source.sourceRef] }]) {
    const pending = createLessonActivityChannel({ ...input, assessmentPending: true });
    assert.equal((await pending.tools[0]!.execute(candidate)).isError, true); assert.deepEqual(pending.blocks(), []);
  }
  source.sourceRef = 'ima-read:source';
  const ima = createLessonActivityChannel({ ...input, idempotencyKey: 'verified-ima-read' });
  assert.equal((await ima.tools[0]!.execute({ ...board, sourceRefs: [source.sourceRef] })).outcome, 'accepted');
  await assert.rejects(createLessonActivityChannel({ ...input, idempotencyKey: 'forged-ima-read' }).tools[0]!.execute({ ...board, sourceRefs: ['ima-read:invented'] }));
  allowed = false; await assert.rejects(createLessonActivityChannel({ ...input, idempotencyKey: 'revoked' }).tools[0]!.execute({ ...board, sourceRefs: [source.sourceRef] }));
  runtime.tools = runtime.tools.filter(t => t.id !== 'tutor.propose_courseware_activity');
  assert.throws(() => createLessonActivityChannel(input));
});

test('courseware continuation selects concepts without an acknowledged delivery in this activity', async () => {
  const f = teachingContextFixture();
  const lesson = f.teaching.template.curriculum!.profiles[0]!.sessions[0]!;
  lesson.teachingSpec = { version: 'zero-base.v1', sourceRequired: true, courseware: 'reviewed-with-project-generation.v1',
    concepts: [{ objectiveId: 'objective-1', introduction: 'Displacement' }, { objectiveId: 'objective-2', introduction: 'Coherence' }] };
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const store = new InMemoryCoursewareStore(), service = new CoursewareService(store, { write: async () => 'audit' } as AuditWriter);
  const scope = { projectId: f.project.id, planId: f.plan.id, planRevision: f.plan.version, learningSessionId: teaching.session.id,
    objectiveId: teaching.objective!.id, tutorSessionId: 'chat', activityId: 'session:activity:review' };
  const actor = { id: f.project.studentId, role: 'student' as const, email: '', displayName: '' };
  const source = { sourceRef: 'knowledge-read:source', knowledgeBaseId: 'kb', documentRefHash: 'a'.repeat(64), title: 'Waves', expiresAt: Date.now() + 60000 };
  const input = { service, teaching, scope, studentId: actor.id, verify: async () => [source], allowedLibraries: async () => ['kb'] };
  const port = createCoursewareActivityPort(input);
  const board = { kind: 'board', title: 'Waves', steps: [{ caption: 'Displacement', tex: 'y=y_1+y_2' }], objectiveRefs: ['objective-1'], sourceRefs: [source.sourceRef] };
  const find = async () => JSON.parse((await port.execute({ kind: 'find_courseware', use: 'review' }, 'find')).text).remainingConcepts;
  assert.equal((await find()).length, 2);
  await port.execute(board, 'first');
  const [first] = await store.instances(scope.projectId, scope.planId, scope.planRevision, scope.learningSessionId);
  assert.equal((await find()).length, 2, 'generation alone is not an acknowledged delivery');
  await service.acknowledge(actor, first!, 0, true, 'continue-first');
  assert.deepEqual((await find()).map((concept: { objectiveId: string }) => concept.objectiveId), ['objective-2']);
  assert.equal((await port.execute(board, 'duplicate')).block, undefined);
  await port.execute({ ...board, objectiveRefs: ['objective-2'] }, 'second');
  const instances = await store.instances(scope.projectId, scope.planId, scope.planRevision, scope.learningSessionId);
  assert.equal(instances.length, 2);
  await service.acknowledge(actor, instances[1]!, 0, true, 'continue-second');
  assert.deepEqual(await find(), []);
  const nextActivity = createCoursewareActivityPort({ ...input, scope: { ...scope, activityId: 'session:activity:theory' } });
  assert.equal(JSON.parse((await nextActivity.execute({ kind: 'find_courseware', use: 'explain' }, 'next')).text).remainingConcepts.length, 2);
});
