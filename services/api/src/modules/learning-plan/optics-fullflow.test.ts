import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';
import { fullflowHarness, STUDENT, TEACHER } from './optics-fullflow.test-fixture';

async function rejectsCode(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === code);
}

test('frozen optics v3 completes all sixteen lessons through formal grading, real observations, version-bound teacher approval and final reflection', async () => {
  const h = await fullflowHarness();
  const revision = h.plan.plan.version;
  const profile = h.teaching.template.curriculum!.profiles.find((item) => item.id === h.teaching.scheduleProfileId)!;
  assert.equal(profile.id, 'optics-16x60-v3');
  assert.equal(h.plan.sessions.length, 16);
  assert.equal((await h.store.findProject(h.projectId))!.status, 'intent_confirmed');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  await rejectsCode(h.learningEvidence.submitArtifact(STUDENT, h.planId, h.plan.sessions[13]!.id,
    { planRevision: revision, content: 'Premature report', requestReview: true }, 'early-report'), 'LEARNING_SESSION_OUT_OF_ORDER');
  let answers = 0;
  let approvedArtifactId: string | null = null;
  let approvedVersionId: string | null = null;
  for (const session of h.plan.sessions) {
    const n = session.lessonIndex;
    const frozen = profile.sessions[n - 1]!;
    const scope = { planId: h.planId, planRevision: revision, learningSessionId: session.id };
    const current = await h.current();
    assert.equal(current.lesson.learningSessionId, session.id, `actual frozen current lesson ${n}`);
    assert.equal(current.role.roleSlotId, h.teaching.sessionRoutes.find((route) => route.sessionIndex === n)!.roleSlotId);
    const required = frozen.completionSpec!.requiredMasteryObjectiveIds.map((id) => `${h.planId}:${id}`);
    for (let rounds = 0; required.length && !await h.mastery.checkRequiredObjectives(STUDENT, STUDENT.id, h.planId, required, h.store); rounds++) {
      assert.ok(rounds < 24, `formal grading must converge for lesson ${n}`);
      const started = await h.assessment.start(STUDENT, h.projectId, scope);
      const question = started.nextStep?.question;
      assert.ok(question, `formal question must be available at lesson ${n}: ${JSON.stringify(started)}`);
      const persisted = await h.store.findPendingQuestion(question.questionId);
      assert.ok(persisted && persisted.assessmentType !== 'formative');
      assert.equal(persisted.sessionId, session.id);
      // A server-side test oracle supplies the stored expected response; no mastery record is injected.
      const result = await h.assessment.answer(STUDENT, h.projectId, { ...scope, questionId: persisted.id, answer: persisted.expectedAnswer }, `answer-${answers++}`);
      assert.equal(result.answer.isCorrect, true);
      assert.ok(result.answer.explanation);
    }
    if (n <= 10 || n === 13 || n === 15) {
      const response = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
        { planRevision: revision, content: `Lesson ${n}: I compare my prediction with the available model and explain its limitations.` }, `response-${n}`);
      assert.equal(response.proof.scope.learningSessionId, session.id);
      assert.equal(response.masteryUpdated, false);
    } else if (n === 11 || n === 12) {
      const mode = n === 11 ? 'diffraction' : 'scattering';
      const parameters: Record<string, number> = n === 11
        ? { wavelength: 532, slitWidth: 80, screenDistance: 1 } : { wavelength: 532, particleRadius: 5 };
      const objectiveId = `${h.planId}:${frozen.objectiveIds[0]!}`;
      const chatId = `chat-${n}`;
      const block = await h.experiments.propose(STUDENT.id, { ...scope, projectId: h.projectId, objectiveId, tutorSessionId: chatId },
        { title: `Investigation ${n}`, summary: 'Predict, run the bounded model, then explain the observation.', mode, parameters }, `activity-${n}`);
      const record = { sessionId: chatId, ownerId: STUDENT.id, projectId: h.projectId, source: 'project',
        createdAt: new Date().toISOString(), lastSeq: 1, lastHintLevel: null, stallCount: 0, escalated: false,
        turns: [{ turnId: `turn-${n}`, role: 'assistant', seq: 1, createdAt: new Date().toISOString(), blocks: [block],
          modality: 'text', hintLevel: null, stageBefore: null, stageAfter: null }] } as TutorSessionRecord;
      await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'submit_prediction',
        payload: { mode, hypothesis: 'Changing one parameter should change the model output.' }, idempotencyKey: `prediction-${n}` });
      const run = await h.experiments.submit(STUDENT.id, record, block.experimentId,
        { action: 'run', payload: { mode, parameters }, idempotencyKey: `run-${n}` });
      assert.ok(run.simulationResult);
      const observed = await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'record_observation',
        payload: { mode, parameters, runActionId: run.actionId, observation: 'The computed output agrees with the stated model under these conditions.' },
        idempotencyKey: `observation-${n}` });
      assert.ok(observed.observationReceipt);
      const submitted = await h.plans.submitEvidence(STUDENT, h.planId, session.id,
        { planRevision: revision, objectiveId, evidenceRef: observed.observationReceipt.evidenceRef }, `submit-observation-${n}`);
      assert.equal(submitted.assessmentStatus, 'assessment_required');
      assert.equal(submitted.masteryUpdated, false);
      assert.equal(await h.store.findMastery(STUDENT.id, objectiveId), null, 'model observations do not confer practice mastery');
      const reread = await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision);
      assert.equal(reread.observations[0]?.ref, observed.observationReceipt.evidenceRef);
    } else if (n === 14) {
      const report = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id,
        { planRevision: revision, title: 'Optics report', content: 'Claim: changing the slit changes the simulated band. Evidence: saved model outputs. Reasoning: the model predicts inverse dependence on slit width. Limit: these are simulations, not measured results.', requestReview: true }, 'final-report');
      approvedArtifactId = report.artifact.id;
      approvedVersionId = report.artifact.latestVersion!.id;
      assert.equal(report.artifact.status, 'submitted');
      await rejectsCode(h.progress.complete(STUDENT, h.planId, session.id,
        { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, 'premature-report-complete'), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
      const queue = await h.teacher.listStudentReviews(TEACHER, STUDENT.id);
      const review = queue.items.find((item) => item.artifactId === report.artifact.id);
      assert.ok(review);
      assert.equal(review.artifactVersionId, approvedVersionId);
      const versions = await h.works.listVersions(TEACHER, report.artifact.id);
      assert.ok(versions.find((version) => version.id === approvedVersionId)?.inlineText?.includes('Limit:'));
      const decision = await h.teacher.decideReview(TEACHER, review.reviewId,
        { decision: 'approved', comment: 'The report separates model output from measurement and supports its bounded claim.' });
      assert.equal(decision.status, 'approved');
      assert.equal((await h.teacher.decideReview(TEACHER, review.reviewId, { decision: 'approved' })).idempotentReplay, true);
      const published = await h.works.publishArtifact(STUDENT.id, report.artifact.id, 'publish-reviewed-report');
      assert.equal(published.status, 'published');
      const proof = await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision);
      assert.equal(proof.approvedArtifacts[0]?.artifactVersionId, approvedVersionId);
    } else if (n === 16) {
      await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
        { planRevision: revision, content: 'An ordinary response is not a final reflection.' }, 'ordinary-final-response');
      await rejectsCode(h.progress.complete(STUDENT, h.planId, session.id,
        { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, 'premature-final-complete'), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
      const reflection = await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id,
        { planRevision: revision, content: 'I distinguished model calculation from measurement, revised my explanation using evidence, and would measure uncertainty in a teacher-approved follow-up.' }, 'final-reflection');
      assert.equal(reflection.proof.sourceKind, 'reflection');
      const proof = await h.learningEvidence.getLessonProofs(STUDENT, h.planId, session.id, revision);
      assert.equal(proof.approvedArtifacts[0]?.artifactId, approvedArtifactId);
      assert.equal(proof.approvedArtifacts[0]?.artifactVersionId, approvedVersionId);
    }
    const completion = await h.progress.complete(STUDENT, h.planId, session.id,
      { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, `complete-${n}`);
    assert.equal(completion.progress.completedCount, n);
    assert.equal((await h.progress.complete(STUDENT, h.planId, session.id,
      { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, `complete-${n}`)).replayed, true);
    await h.lifecycle.reconcile(STUDENT, h.projectId, { planId: h.planId, planRevision: revision }, `reconcile-${n}`);
  }
  assert.ok(answers > 4, 'quantitative formal objectives require repeated graded evidence');
  assert.equal((await h.store.findProject(h.projectId))!.status, 'completed');
  assert.equal((await h.store.findBundle(h.planId))!.plan.status, 'completed');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 16);
  assert.equal((await h.current()).lesson.status, 'completed');
  assert.equal((await h.learningEvidence.getLessonProofs(TEACHER, h.planId, h.plan.sessions[15]!.id, revision)).reflections.length, 1);
  assert.ok(h.events.some((event) => event.topic === 'learning.theory_mastered'));
});
