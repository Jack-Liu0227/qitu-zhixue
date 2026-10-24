import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullflowHarness, STUDENT } from './optics-fullflow.test-fixture';

test('a novice finishes all eight Thunder lessons without any teacher through owners and a controlled evaluator, including a wrong answer and retry', async () => {
  const h = await fullflowHarness(true, true, false, false, true);
  assert.equal(h.plan.sessions.length, 8);
  h.directory.currentMentorId = null;
  let answers = 0, recovered = false;
  let practiceRef: string | undefined;
  let rejectedPracticeRef: string | undefined;
  for (const session of h.plan.sessions) {
    const scope = { planId: h.planId, planRevision: h.plan.plan.version, learningSessionId: session.id };
    for (let step = 0; ; step++) {
      assert.ok(step < 8, 'activities must converge through their evidence owners');
      const progress = await h.progress.readProgress(STUDENT, h.planId);
      const activity = progress.sessions.find(item => item.sessionId === session.id)!.activities!.find(item => item.status === 'current');
      if (!activity) break;
      const key = `thunder-${session.lessonIndex}-${activity.kind}`;
      if (activity.evidence === 'mastery') {
        for (let attempt = 0; ; attempt++) {
          assert.ok(attempt < 20, 'remediation must permit a novice to recover');
          const current = (await h.current()).lesson.currentActivity;
          if (current?.evidence !== 'mastery') break;
          const view = await h.assessment.start(STUDENT, h.projectId, scope);
          if (view.nextStep?.action === 'complete') break;
          assert.ok(view.nextStep?.question);
          const pending = await h.store.findPendingQuestion(view.nextStep.question.questionId); assert.ok(pending);
          // Reload/continue must preserve the owner-issued pending question and not count as an answer.
          const restored = await h.assessment.start(STUDENT, h.projectId, scope);
          assert.equal(restored.nextStep?.question?.questionId, pending.id);
          const wrong: boolean = !recovered;
          const input = { ...scope, questionId: pending.id, answer: wrong ? 'This isolated learner has not understood yet.' : pending.expectedAnswer };
          // The private answer oracle is confined to this disposable fixture, never the production learner.
          const result = await h.assessment.answer(STUDENT, h.projectId, input, `answer-${answers++}`);
          assert.equal(result.answer.isCorrect, !wrong);
          if (wrong) {
            assert.equal(result.answer.theoryMastered, false);
            assert.notEqual((await h.store.findProject(h.projectId))?.status, 'practice_ready');
            recovered = true;
          }
          const replay = await h.assessment.answer(STUDENT, h.projectId, input, `answer-${answers - 1}`);
          assert.equal(replay.answer.replayed, true);
          assert.equal(replay.answer.isCorrect, result.answer.isCorrect);
        }
        if (session.lessonIndex === 2) assert.notEqual((await h.store.findProject(h.projectId))?.status, 'practice_ready', 'the next theory lesson is still required');
        if (session.lessonIndex === 3) assert.equal((await h.store.findProject(h.projectId))?.status, 'practice_ready');
      } else {
        const submission = { planRevision: scope.planRevision, activityId: activity.activityId,
          content: 'Disposable fixture: event handling, state update and drawing repeat each frame; coordinates, delta time and rectangle overlap determine motion and collisions. Synthetic code and test evidence only.' };
        if (activity.evidence === 'submitted_artifact') {
          const submitted = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id,
            { ...submission, title: 'Isolated playable-game test portfolio', requestReview: true }, key);
          assert.equal(submitted.artifact.status, 'published');
          assert.equal((await h.artifacts.listReviewsForArtifact(submitted.artifact.id)).length, 0);
        } else if (session.lessonIndex === 8 && activity.kind === 'reflect') {
          await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id, submission, key);
        } else {
          if (session.lessonIndex === 4 && activity.kind === 'practice') {
            h.evaluation.accepts = false;
            const rejected = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id,
              { ...submission, content: 'Disposable incomplete practice.' }, `${key}-rejected`);
            rejectedPracticeRef = rejected.proof.ref;
            assert.equal(rejected.proof.quality?.status, 'needs_revision');
            h.evaluation.accepts = true;
          }
          const saved = await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, submission, key);
          if (session.lessonIndex === 4 && activity.kind === 'practice') practiceRef = saved.proof.ref;
          if (session.lessonIndex === 4 && activity.kind === 'reflect') {
            const evidence = h.evaluation.inputs.at(-1)!.evidence;
            assert.ok(practiceRef && evidence.some(item => item.ref === practiceRef), 'reflection reuses current owner-accepted practice');
            assert.ok(rejectedPracticeRef && !evidence.some(item => item.ref === rejectedPracticeRef), 'a rejected practice is not supporting evidence');
          }
        }

      }
    }
    const completed = await h.lifecycle.completeLesson(STUDENT, h.planId, session.id,
      { projectId: h.projectId, planRevision: scope.planRevision, evidenceRefs: [] }, `complete-${session.lessonIndex}`);
    assert.equal(completed.progress.completedCount, session.lessonIndex);
    if (session.lessonIndex === 3) assert.equal((await h.store.findProject(h.projectId))?.status, 'practice_building');
  }
  assert.ok(recovered && answers >= 5);
  assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
});
