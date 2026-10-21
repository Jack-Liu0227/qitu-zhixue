import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { fullflowHarness, STUDENT, TEACHER } from '../learning-plan/optics-fullflow.test-fixture';

test('unrelated saved response cannot complete a quality lesson; current teacher may return it without mastery or gate writes', async () => {
  const h = await fullflowHarness(true);
  const session = h.plan.sessions[0]!;
  const revision = h.plan.plan.version;
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
    { planRevision: revision, content: 'I ate a sandwich, unrelated to the optical observation.' }, 'unrelated-response');
  assert.equal(saved.assessmentStatus, 'assessment_required');
  const request = { projectId: h.projectId, planRevision: revision, evidenceRefs: [saved.proof.ref] };
  await assert.rejects(h.progress.complete(STUDENT, h.planId, session.id, request, 'unrelated-complete'));
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  const item = (await h.learningEvidence.listStudentLessonQuality(TEACHER, STUDENT.id)).items[0]!;
  assert.match(item.content, /sandwich/);
  const decision = { planRevision: revision, evidenceRef: saved.proof.ref, subjectDigest: item.proof.quality!.subjectDigest,
    criteria: item.criteria.map(criterion => ({ criterionId: criterion.id, meets: false, feedback: 'Please describe the optical observation and distinguish it from your explanation.' })) };
  await assert.rejects(h.learningEvidence.reviewLessonQuality(STUDENT, h.planId, session.id, decision, 'student-forgery'), ForbiddenException);
  await assert.rejects(h.learningEvidence.reviewLessonQuality({ ...TEACHER, id: 'different-teacher' }, h.planId, session.id, decision, 'other-teacher'), ForbiddenException);
  const reviewed = await h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, decision, 'teacher-return');
  assert.equal(reviewed.quality.status, 'needs_revision');
  assert.equal((await h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, decision, 'teacher-return')).replayed, true);
  await assert.rejects(h.progress.complete(STUDENT, h.planId, session.id, request, 'returned-complete'));
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision)).submissions[0]?.quality?.status, 'needs_revision');
  assert.equal((await h.store.findProject(h.projectId))?.status, 'intent_confirmed');
  assert.equal(h.events.length, 0);
});

test('teacher decisions require exact content digest, current revision and all frozen criteria; correct resubmission can complete idempotently', async () => {
  const h = await fullflowHarness(true);
  const session = h.plan.sessions[0]!;
  const revision = h.plan.plan.version;
  const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
    { planRevision: revision, content: 'The observed reflected ray and the inferred light path are distinct. I record the angle relative to the normal in degrees.' }, 'optical-response');
  const item = (await h.learningEvidence.listStudentLessonQuality(TEACHER, STUDENT.id)).items[0]!;
  const decision = { planRevision: revision, evidenceRef: saved.proof.ref, subjectDigest: item.proof.quality!.subjectDigest,
    criteria: item.criteria.map(criterion => ({ criterionId: criterion.id, meets: true, feedback: 'Checked against the actual response version.' })) };
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, { ...decision, subjectDigest: 'a'.repeat(64) }, 'wrong-version'));
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, { ...decision, planRevision: revision + 1 }, 'wrong-revision'));
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, { ...decision, criteria: [] }, 'missing-criteria'), BadRequestException);
  await h.learningEvidence.reviewLessonQuality(TEACHER, h.planId, session.id, decision, 'valid-teacher');
  const request = { projectId: h.projectId, planRevision: revision, evidenceRefs: [saved.proof.ref] };
  assert.equal((await h.progress.complete(STUDENT, h.planId, session.id, request, 'quality-complete')).progress.completedCount, 1);
  assert.equal((await h.progress.complete(STUDENT, h.planId, session.id, request, 'quality-complete')).replayed, true);
});

test('an edited artifact or revoked teacher cannot reuse a quality approval, including an idempotent replay', async () => {
  const h = await fullflowHarness(true);
  const session = h.plan.sessions[0]!;
  const revision = h.plan.plan.version;
  const saved = await h.learningEvidence.submitResponse(STUDENT,h.planId,session.id,
    { planRevision:revision,content:'My observation and optical explanation are separate claims.' },'first-version');
  const item = (await h.learningEvidence.listStudentLessonQuality(TEACHER,STUDENT.id)).items[0]!;
  const decision = { planRevision:revision,evidenceRef:saved.proof.ref,subjectDigest:item.proof.quality!.subjectDigest,
    criteria:item.criteria.map(criterion=>({ criterionId:criterion.id,meets:true,feedback:'Reviewed exact version.' })) };
  await h.learningEvidence.reviewLessonQuality(TEACHER,h.planId,session.id,decision,'adopt-quality');
  h.directory.currentMentorId = 'replacement-teacher';
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER,h.planId,session.id,decision,'adopt-quality'),ForbiddenException);
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT,h.planId,session.id,revision)).submissions[0]!.quality!.status,'pending');
  h.directory.currentMentorId = TEACHER.id;
  await h.works.updateArtifact(STUDENT.id,saved.artifact.id,{ title:'Edited learning response',summary:'Revision after review',version:{ inlineText:'A later edited version.' } },'edit-after-review','1');
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT,h.planId,session.id,revision)).submissions[0]!.quality!.status,'stale');
  await assert.rejects(h.progress.complete(STUDENT,h.planId,session.id,
    { projectId:h.projectId,planRevision:revision,evidenceRefs:[saved.proof.ref] },'stale-quality-completion'));
  await assert.rejects(h.learningEvidence.reviewLessonQuality(TEACHER,h.planId,session.id,decision,'adopt-quality'));
});

test('teacher queue can reach a current lesson after more than twenty other active plans',async()=>{
  const h=await fullflowHarness(true);
  await h.learningEvidence.submitResponse(STUDENT,h.planId,h.plan.sessions[0]!.id,{planRevision:h.plan.plan.version,content:'A scoped optical observation to review.'},'queue-proof');
  const original=h.store.listPlansByStudent.bind(h.store);
  const real=(await original(STUDENT.id))[0]!;
  h.store.listPlansByStudent=async studentId=>studentId===STUDENT.id ? [
    ...Array.from({length:20},(_,index)=>({...real,id:`synthetic-empty-plan-${index}`,createdAt:new Date(real.createdAt.getTime()+index+1)})),real,
  ] : original(studentId);
  const first=await h.learningEvidence.listStudentLessonQuality(TEACHER,STUDENT.id);
  assert.equal(first.hasMore,true);assert.equal(first.items.length,0);assert.ok(first.nextCursor);
  const next=await h.learningEvidence.listStudentLessonQuality(TEACHER,STUDENT.id,first.nextCursor);
  assert.equal(next.hasMore,false);assert.equal(next.items[0]?.planId,h.planId);
  await assert.rejects(h.learningEvidence.listStudentLessonQuality(TEACHER,STUDENT.id,'foreign-plan'),BadRequestException);
});
