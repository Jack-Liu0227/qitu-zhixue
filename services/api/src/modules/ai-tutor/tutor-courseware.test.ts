import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { InMemoryCoursewareStore } from '../knowledge/courseware.store';
import { CoursewareService } from '../knowledge/courseware.service';
import type { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { TutorCoursewareService } from './tutor-courseware.service';
import type { TutorService } from './tutor.service';
import type { ImaReadEvidence } from './ima-project-scope';

async function fixture() {
  const f = teachingContextFixture();
  f.teaching.template.curriculum!.profiles[0]!.sessions[0]!.teachingSpec = {
    version: 'zero-base.v1', sourceRequired: true, courseware: 'reviewed-with-project-generation.v1',
    concepts: [{ objectiveId: 'objective-1', introduction: 'Explain a wave.' }],
  };
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const activityId = `${teaching.session.id}:activity:theory`;
  teaching.lesson.currentActivity = { activityId, kind: 'theory', evidence: 'teaching_delivery', status: 'current', guidance: 'Explain', minutes: 25, evidenceRefs: [] };
  const student: CurrentUser = { id: f.project.studentId, role: 'student', email: '', displayName: '' };
  const scope = { projectId: f.project.id, planId: f.plan.id, planRevision: f.plan.version, learningSessionId: teaching.session.id, activityId };
  const store = new InMemoryCoursewareStore(), content = new CoursewareService(store, { write: async () => 'audit' } as AuditWriter);
  const source = { title: 'Wave source', knowledgeBaseId: 'kb', documentRefHash: 'a'.repeat(64) };
  const instance = await content.capture({ actor: student, scope, curriculumHash: teachingValueDigest(teaching.bundle.template), content: { title: 'Wave', steps: [
    { caption: 'Observe', tex: 'y_1' }, { caption: 'Compare', tex: 'y_1+y_2' }] }, sources: [source], objectiveRefs: ['objective-1'], key: 'turn' });
  let allowed = true, pending = false, changedSource = false, reads = 0;
  const evidence = new Map<string, ImaReadEvidence>();
  const runtime = { agent: { enabled: true, capabilities: ['teach'] }, skills: [{ id: 'pbl-dynamic-lesson', publicationStatus: 'reviewed' }],
    tools: builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity', 'tutor.propose_courseware_activity']) };
  const access = { managed: { key: 'project-scope' }, authorize: async () => allowed, readEvidence: evidence,
    scope: { knowledgeBaseIds: ['kb'], refreshAllowedKnowledgeBaseIds: async () => allowed ? ['kb'] : [] } };
  const tutor = { readCoursewareContext: async (project: string, actor: string) => {
    assert.equal(project, scope.projectId); assert.equal(actor, student.id); evidence.clear(); return { teaching, runtime, access };
  } } as unknown as TutorService;
  const knowledge = { search: async () => ({ evidence: [{ citationId: 'scoped-read' }] }), read: async () => {
    reads++; evidence.set('read', { ...source, documentRefHash: changedSource ? 'b'.repeat(64) : source.documentRefHash,
      sourceRef: 'read', expiresAt: Date.now() + 10000 });
  } } as unknown as KnowledgeRetrievalService;
  const plans = { findAwaitingQuestion: async () => pending ? { id: 'pending' } : null,
    withSessionProgressTransaction: async (_student: string, _plan: string, work: (store: unknown) => Promise<unknown>) => work(plans) } as unknown as LearningPlanStore;
  const service = new TutorCoursewareService(tutor, store, content, knowledge, plans);
  return { student, scope, instance, store, service, reads: () => reads, revoke: () => { allowed = false; }, change: () => { changedSource = true; }, pending: () => { pending = true; } };
}
test('restoration revalidates sources; positions survive reload; completion requires the last step and current scope', async () => {
  const h = await fixture(); const view = await h.service.read(h.student, h.scope.projectId);
  assert.equal(view?.instances[0]?.position, 0); assert.ok(h.reads() > 0);
  const request = { planId: h.scope.planId, planRevision: h.scope.planRevision, learningSessionId: h.scope.learningSessionId,
    instanceId: h.instance.id, position: 0, continueLearning: true };
  await assert.rejects(h.service.position(h.student, h.scope.projectId, request, 'early'));
  await assert.rejects(h.service.position(h.student, h.scope.projectId, { ...request, planRevision: 99 }, 'stale'));
  await assert.rejects(h.service.position({ ...h.student, id: 'other-student' }, h.scope.projectId, request, 'foreign'));
  await h.service.position(h.student, h.scope.projectId, { ...request, position: 1, continueLearning: false }, 'page');
  assert.equal((await h.service.read(h.student, h.scope.projectId))?.instances[0]?.position, 1);
  const acknowledged = await h.service.position(h.student, h.scope.projectId, { ...request, position: 1 }, 'continue');
  assert.ok(acknowledged.acknowledgedAt);
  assert.equal((await h.store.instances(h.scope.projectId, h.scope.planId, h.scope.planRevision, h.scope.learningSessionId)).length, 1);
});
test('revoked knowledge and changed content cannot disclose restored boards or accept continue', async () => {
  for (const reason of ['revoke', 'change'] as const) {
    const h = await fixture(); h[reason]();
    const view = await h.service.read(h.student, h.scope.projectId);
    assert.deepEqual(view?.instances, []); assert.equal(view?.canContinue, false); assert.ok(view?.blockedReason);
    await assert.rejects(h.service.position(h.student, h.scope.projectId, { planId: h.scope.planId, planRevision: h.scope.planRevision,
      learningSessionId: h.scope.learningSessionId, instanceId: h.instance.id, position: 1, continueLearning: true }, reason));
    assert.equal((await h.store.instance(h.instance.id))?.value.acknowledgedAt, null);
  }
});

test('a pending answer allows reviewing verified courseware without advancing teaching or replacing the question', async () => {
  const h = await fixture(); h.pending();
  const view = await h.service.read(h.student, h.scope.projectId);
  assert.equal(view?.instances.length, 1);
  assert.equal(view?.canContinue, false);
  const request = { planId: h.scope.planId, planRevision: h.scope.planRevision, learningSessionId: h.scope.learningSessionId,
    instanceId: h.instance.id, position: 1, continueLearning: false };
  const reviewed = await h.service.position(h.student, h.scope.projectId, request, 'review-during-question');
  assert.equal(reviewed.position, 1);
  assert.equal(reviewed.acknowledgedAt, null);
  await assert.rejects(h.service.position(h.student, h.scope.projectId, { ...request, continueLearning: true }, 'skip-question'));
  const restored = await h.service.read(h.student, h.scope.projectId);
  assert.equal(restored?.instances[0]?.position, 1);
  assert.equal(restored?.canContinue, false);
});
