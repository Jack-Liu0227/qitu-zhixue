import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { fullflowHarness, STUDENT, TEACHER } from '../learning-plan/optics-fullflow.test-fixture';

test('automatic evaluation receives the version-checked saved subject as evidence', async () => {
  const h = await fullflowHarness(true);
  const content = 'I record the observed angle relative to the normal, in degrees, separately from my explanation.';
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, h.plan.sessions[0]!.id,
    { planRevision: h.plan.plan.version, content }, 'saved-subject');
  assert.equal(saved.proof.quality?.status, 'accepted');
  assert.deepEqual(h.evaluation.inputs[0]!.evidence, [{ ref: saved.proof.ref, content }]);
  assert.equal(h.evaluation.inputs[0]!.content, content);
});

test('negative automatic feedback preserves evidence and blocks progress without requesting a teacher', async () => {
  const h = await fullflowHarness(true); h.evaluation.accepts = false; h.directory.currentMentorId = null;
  const session = h.plan.sessions[0]!, revision = h.plan.plan.version;
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
    { planRevision: revision, content: 'An unrelated response.' }, 'unrelated');
  assert.equal(saved.proof.quality?.status, 'needs_revision');
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision)).submissions.length, 1);
  await assert.rejects(h.progress.complete(STUDENT, h.planId, session.id,
    { projectId: h.projectId, planRevision: revision, evidenceRefs: [saved.proof.ref] }, 'not-ready'));
  h.evaluation.accepts = true;
  const corrected = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
    { planRevision: revision, content: 'I record the observed angle relative to the normal, in degrees, separately from my explanation.' }, 'corrected');
  assert.equal(corrected.proof.quality?.status, 'accepted');
  const completed = await h.progress.complete(STUDENT, h.planId, session.id,
    { projectId: h.projectId, planRevision: revision, evidenceRefs: [corrected.proof.ref] }, 'ready');
  assert.equal(completed.progress.completedCount, 1);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'intent_confirmed');
});

test('model outage saves once; student retries and a teacher change cannot revoke automatic evaluation', async () => {
  const h = await fullflowHarness(true); h.evaluation.fail = true;
  const session = h.plan.sessions[0]!, revision = h.plan.plan.version;
  const input = { planRevision: revision, content: 'Synthetic optical observation and explanation.' };
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, input, 'durable');
  assert.equal(saved.proof.quality?.status, 'pending');
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision)).submissions.length, 1);
  h.evaluation.fail = false; h.directory.currentMentorId = null;
  assert.equal((await h.learningEvidence.evaluateLessonQuality(STUDENT, h.planId, session.id, revision, saved.proof.ref)).quality.status, 'accepted');
  const calls = h.evaluation.calls;
  const replay = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, input, 'durable');
  assert.equal(replay.replayed, true); assert.equal(replay.artifact.id, saved.artifact.id); assert.equal(h.evaluation.calls, calls);
  h.directory.currentMentorId = 'replacement-teacher';
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision)).submissions[0]?.quality?.status, 'accepted');
  await assert.rejects(h.learningEvidence.evaluateLessonQuality({ ...STUDENT, id: 'other-student' }, h.planId, session.id, revision, saved.proof.ref), ForbiddenException);
  await assert.rejects(h.learningEvidence.evaluateLessonQuality(TEACHER, h.planId, session.id, revision, saved.proof.ref), ForbiddenException);
  await assert.rejects(h.learningEvidence.evaluateLessonQuality(STUDENT, h.planId, session.id, revision + 1, saved.proof.ref));
});

test('teacher reads assigned records but cannot decide; editing invalidates the exact version', async () => {
  const h = await fullflowHarness(true);
  const session = h.plan.sessions[0]!, revision = h.plan.plan.version;
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
    { planRevision: revision, content: 'Synthetic first observation.' }, 'first');
  const item = (await h.learningEvidence.listStudentLessonQuality(TEACHER, STUDENT.id)).items[0]!;
  assert.equal(item.proof.quality?.status, 'accepted'); assert.match(item.content, /Synthetic/);
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id,
    { planRevision: revision, evidenceRef: saved.proof.ref, subjectDigest: item.proof.quality!.subjectDigest, criteria: [] }, 'teacher'), ForbiddenException);
  await assert.rejects(h.teacher.decideReview(TEACHER, 'any', { decision: 'approved' }), ForbiddenException);
  await assert.rejects(h.teacher.recordInterventionAction(TEACHER.id, 'any', 'resolve'), ForbiddenException);
  await h.works.updateArtifact(STUDENT.id, saved.artifact.id,
    { title: 'Edited', summary: '', version: { inlineText: 'Different content after evaluation.' } }, 'edit', '1');
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision)).submissions[0]?.quality?.status, 'stale');
  await assert.rejects(h.learningEvidence.evaluateLessonQuality(STUDENT, h.planId, session.id, revision, saved.proof.ref));
  h.directory.currentMentorId = null;
  await assert.rejects(h.learningEvidence.listStudentLessonQuality(TEACHER, STUDENT.id), ForbiddenException);
});
