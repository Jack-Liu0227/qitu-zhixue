import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeLesson, getLessonProgress, reconcileLearning } from './lessonProgressApi';
import { getLessonEvidence, submitLessonEvidence } from './lessonEvidenceApi';

const scope = { projectId: 'project-fixture', planId: 'plan-fixture', planRevision: 2, learningSessionId: 'session-fixture' };
const proof = { kind: 'session_response', ref: 'task_submission:fixture', scope: { ...scope, objectiveIds: ['objective-fixture'] },
  objectiveId: 'objective-fixture', sourceKind: 'task_submission', artifactId: 'artifact-fixture', artifactVersionId: 'version-fixture' };
const progress = { planId: scope.planId, projectId: scope.projectId, planRevision: scope.planRevision,
  currentSessionId: scope.learningSessionId, completedCount: 0, totalCount: 1, contractReady: true,
  sessions: [{ sessionId: scope.learningSessionId, lessonIndex: 1, title: 'Fixture', status: 'current', completedAt: null, canComplete: true, blockers: [] }] };

test('progress and evidence reject another project, session or revision', async () => {
  await assert.rejects(getLessonProgress(async () => ({ data: { ...progress, projectId: 'other' } }), scope.planId, scope.projectId),
    { code: 'LESSON_PROGRESS_INVALID' });
  const evidence = { scope: proof.scope, sessionType: 'theory', allowedActions: ['respond'], submissions: [proof], observations: [], approvedArtifacts: [], reflections: [] };
  const read = await getLessonEvidence(async () => ({ data: evidence }), scope);
  assert.equal(read.submissions[0]?.ref, proof.ref);
  for (const change of [{ planRevision: 3 }, { learningSessionId: 'other' }, { projectId: 'other' }]) {
    await assert.rejects(getLessonEvidence(async () => ({ data: { ...evidence, submissions: [{ ...proof, scope: { ...proof.scope, ...change } }] } }), scope),
      { code: 'LESSON_EVIDENCE_INVALID' });
  }
});

test('completion sends selected owner refs and stable key; never sends stage or advance', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = { projectId: scope.projectId, planRevision: 2, evidenceRefs: [proof.ref] };
  const fetch = async (path: string, _label?: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { data: { completion: { sessionId: scope.learningSessionId, completedAt: '2026-10-21T00:00:00.000Z', evidenceRefs: [proof.ref] }, progress, replayed: true } };
  };
  const result = await completeLesson(fetch, scope.planId, scope.learningSessionId, request, 'stable');
  assert.equal(result.replayed, true);
  assert.equal(calls[0]?.path, '/api/v1/learning-plans/plan-fixture/sessions/session-fixture/complete');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), request);
  assert.equal(new Headers(calls[0]?.init?.headers).get('idempotency-key'), 'stable');
  assert.doesNotMatch(JSON.stringify(calls), /advance|stage/);
  await assert.rejects(completeLesson(fetch, scope.planId, scope.learningSessionId, { ...request, evidenceRefs: [] }, 'empty'),
    { code: 'LESSON_EVIDENCE_REQUIRED' });
  assert.equal(calls.length, 1);
});

test('submission requires an actual matching stored artifact version and never trusts mastery claims', async () => {
  const valid = { proof, artifact: { id: 'artifact-fixture', projectId: scope.projectId, title: 'Fixture', status: 'draft', reviewStatus: 'none',
    latestVersion: { id: 'version-fixture', inlineText: 'Synthetic learner expression.' } }, assessmentStatus: 'assessment_required', masteryUpdated: false, replayed: false };
  const result = await submitLessonEvidence(async () => ({ data: valid }), scope, 'responses', { planRevision: 2, content: 'Synthetic learner expression.' }, 'key');
  assert.equal(result.masteryUpdated, false);
  await assert.rejects(submitLessonEvidence(async () => ({ data: { ...valid, masteryUpdated: true } }), scope, 'responses',
    { planRevision: 2, content: 'Fixture' }, 'key'), { code: 'LESSON_EVIDENCE_INVALID' });
  await assert.rejects(submitLessonEvidence(async () => ({ data: { ...valid, artifact: { ...valid.artifact, latestVersion: { id: 'other', inlineText: 'Fixture' } } } }), scope, 'responses',
    { planRevision: 2, content: 'Fixture' }, 'key'), { code: 'LESSON_EVIDENCE_INVALID' });
});

test('reconcile asks the owner using plan scope only, with retryable idempotency', async () => {
  let body: unknown;
  const result = await reconcileLearning(async (path, _label, init) => {
    assert.equal(path, '/api/v1/projects/project-fixture/reconcile-learning');
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'reconcile-stable');
    body = JSON.parse(String(init?.body));
    return { data: { projectId: scope.projectId, stage: 'practice_ready', planStatus: 'active', currentSessionId: scope.learningSessionId, replayed: false } };
  }, scope.projectId, { planId: scope.planId, planRevision: 2 }, 'reconcile-stable');
  assert.deepEqual(body, { planId: scope.planId, planRevision: 2 });
  assert.equal(result.stage, 'practice_ready');
});
