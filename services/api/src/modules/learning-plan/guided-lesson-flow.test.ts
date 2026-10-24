import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullflowHarness, STUDENT, TEACHER } from './optics-fullflow.test-fixture';
import { freezeTutorRuntime, scopeTutorRuntimeToLesson } from '../ai-tutor/tutor-frozen-runtime';
import { projectTutorLessonProgram } from '../ai-tutor/tutor-lesson-program';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';

test('guided course resumes exact activity from reviewed receipts; viewing, submission and out-of-order requests cannot skip lessons', async () => {
  const h = await fullflowHarness(true, true);
  const revision = h.plan.plan.version;
  const lesson = h.plan.sessions[0]!;
  const scope = { projectId: h.projectId, planRevision: revision, evidenceRefs: [] };
  const currentActivity = async () => (await h.progress.readProgress(STUDENT, h.planId))
    .sessions[0]!.activities!.find(activity => activity.status === 'current');
  assert.equal((await h.current()).role.assistantId, 'optics-concept-coach');
  assert.equal((await currentActivity())?.kind, 'review');
  await assert.rejects(h.assessment.start(STUDENT, h.projectId,
    { planId: h.planId, planRevision: revision, learningSessionId: lesson.id }));
  const future = `${lesson.id}:activity:reflect`;
  await assert.rejects(h.learningEvidence.submitResponse(STUDENT, h.planId, lesson.id,
    { planRevision: revision, activityId: future, content: 'Do not skip to reflection.' }, 'future-activity'));
  const refs: string[] = [];
  for (const kind of ['review', 'theory', 'check', 'reflect']) {
    const activity = await currentActivity(); assert.equal(activity?.kind, kind); assert.ok(activity);
    assert.equal(projectTutorLessonProgram(await h.current()).currentActivity?.activityId, activity.activityId);
    const request = { planRevision: revision, activityId: activity.activityId,
      content: `Synthetic ${kind}: I distinguish an observed reflected ray from its inferred path and record angle relative to the normal in degrees.` };
    const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, lesson.id, request, `respond-${kind}`);
    refs.push(saved.proof.ref);
    assert.equal(saved.proof.activityId, activity.activityId);
    assert.equal(saved.proof.quality?.status, 'accepted');
    assert.equal((await h.learningEvidence.submitResponse(STUDENT, h.planId, lesson.id, request, `respond-${kind}`)).replayed, true);
  }
  assert.equal(await currentActivity(), undefined);
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  const completion = await h.progress.complete(STUDENT, h.planId, lesson.id, { ...scope, evidenceRefs: refs }, 'complete-one');
  assert.equal(completion.progress.completedCount, 1);
  assert.equal((await h.current()).lesson.lessonIndex, 2);
  assert.equal((await h.current()).role.assistantId, 'optics-leader');
  assert.equal((await h.progress.complete(STUDENT, h.planId, lesson.id, { ...scope, evidenceRefs: refs }, 'complete-one')).replayed, true);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'intent_confirmed');
  assert.equal((await h.store.listMasteryForPlan(STUDENT.id, h.planId)).length, 0);
});

test('lesson skill subset is explicit, revocation fails closed, old templates retain their own frozen semantics', async () => {
  const h = await fullflowHarness(true, true);
  const teaching = await h.current();
  const runtime = await h.registry.getAssistantRuntime(teaching.role.assistantId);
  const frozen = freezeTutorRuntime(runtime, teaching.role, true);
  const scoped = scopeTutorRuntimeToLesson(frozen, teaching);
  assert.ok(scoped.skills.some(skill => skill.id === 'pbl-data-literacy'));
  assert.ok(!scoped.skills.some(skill => skill.id === 'pbl-source-literacy'));
  assert.throws(() => scopeTutorRuntimeToLesson({ ...frozen, skills: [] }, teaching));
  assert.equal(scopeTutorRuntimeToLesson(frozen), frozen);
});

test('v5 follows all sixteen lessons and activity receipts through grading, registered simulation, report review and reflection owners', async () => {
  const h = await fullflowHarness(true, true);
  const revision = h.plan.plan.version;
  const profile = h.teaching.template.curriculum!.profiles[0]!;
  let answers = 0;
  for (const session of h.plan.sessions) {
    const frozen = profile.sessions[session.lessonIndex - 1]!;
    const scope = { planId: h.planId, planRevision: revision, learningSessionId: session.id };
    for (let steps = 0; ; steps++) {
      assert.ok(steps < 8, 'activity loop must converge');
      const view = await h.progress.readProgress(STUDENT, h.planId);
      const activity = view.sessions.find(item => item.sessionId === session.id)!.activities!.find(item => item.status === 'current');
      if (!activity) break;
      const key = `v5-${session.lessonIndex}-${activity.kind}`;
      const submission = { planRevision: revision, activityId: activity.activityId,
        content: `Synthetic ${activity.kind}: I distinguish observed output from an explanation, record units and identify the model limitations.` };
      if (activity.evidence === 'mastery') {
        const required = frozen.completionSpec!.requiredMasteryObjectiveIds.map(id => `${h.planId}:${id}`);
        for (let rounds = 0; !await h.mastery.checkRequiredObjectives(STUDENT, STUDENT.id, h.planId, required, h.store); rounds++) {
          assert.ok(rounds < 24);
          const started = await h.assessment.start(STUDENT, h.projectId, scope);
          assert.ok(started.nextStep?.question);
          const question = await h.store.findPendingQuestion(started.nextStep.question.questionId); assert.ok(question);
          // A disposable server-side test oracle, never a learner-facing answer key or mastery injection.
          await h.assessment.answer(STUDENT, h.projectId, { ...scope, questionId: question.id, answer: question.expectedAnswer }, `v5-answer-${answers++}`);
        }
      } else if (activity.evidence === 'experiment_observation') {
        const mode = session.lessonIndex === 11 ? 'diffraction' : 'scattering';
        const parameters: Record<string, number> = mode === 'diffraction' ? { wavelength: 532, slitWidth: 80, screenDistance: 1 }
          : { wavelength: 532, particleRadius: 5 };
        const objectiveId = `${h.planId}:${frozen.objectiveIds[0]!}`;
        const chatId = `v5-chat-${session.lessonIndex}`;
        const block = await h.experiments.propose(STUDENT.id, { ...scope, projectId: h.projectId, objectiveId, tutorSessionId: chatId },
          { title: 'Bounded simulation', summary: 'Compare a prediction and simulated observation.', mode, parameters }, key);
        const record: TutorSessionRecord = { sessionId: chatId, ownerId: STUDENT.id, projectId: h.projectId, source: 'project',
          createdAt: new Date().toISOString(), lastSeq: 1, lastHintLevel: null, stallCount: 0, escalated: false,
          turns: [{ turnId: key, role: 'assistant', seq: 1, createdAt: new Date().toISOString(), blocks: [block], modality: 'text',
            hintLevel: null, stageBefore: null, stageAfter: null, pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null }] };
        await h.experiments.submit(STUDENT.id, record, block.experimentId,
          { action: 'submit_prediction', payload: { mode, hypothesis: 'Changing one parameter changes the modeled pattern.' }, idempotencyKey: `${key}-predict` });
        const run = await h.experiments.submit(STUDENT.id, record, block.experimentId,
          { action: 'run', payload: { mode, parameters }, idempotencyKey: `${key}-run` });
        const observed = await h.experiments.submit(STUDENT.id, record, block.experimentId, { action: 'record_observation',
          payload: { mode, parameters, runActionId: run.actionId, observation: 'This is a simulated observation under the registered model assumptions.' }, idempotencyKey: `${key}-observe` });
        assert.ok(observed.observationReceipt);
      } else if (activity.evidence === 'submitted_artifact') {
        const report = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id,
          { ...submission, title: 'V5 optics report', requestReview: true }, key);
        assert.equal(report.artifact.status, 'published');
      } else if (session.lessonIndex === 16 && activity.kind === 'reflect') {
        const reflection = await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id, submission, key);
        assert.equal(reflection.proof.sourceKind, 'reflection');
      } else {
        await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, submission, key);
      }
      assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, session.lessonIndex - 1);
    }
    const done = await h.progress.complete(STUDENT, h.planId, session.id,
      { projectId: h.projectId, planRevision: revision, evidenceRefs: [] }, `v5-complete-${session.lessonIndex}`);
    assert.equal(done.progress.completedCount, session.lessonIndex);
    await h.lifecycle.reconcile(STUDENT, h.projectId, { planId: h.planId, planRevision: revision }, `v5-reconcile-${session.lessonIndex}`);
  }
  assert.ok(answers > 4);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 16);
});
