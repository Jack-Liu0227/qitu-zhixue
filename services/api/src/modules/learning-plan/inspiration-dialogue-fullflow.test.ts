import assert from 'node:assert/strict';
import test from 'node:test';
import { INSPIRATION_COURSES } from '../templates/content/inspiration';
import { INSPIRATION_DIALOGUE_COURSES } from '../templates/content/inspiration/dialogue-courses';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import { fullflowHarness, STUDENT } from './optics-fullflow.test-fixture';

for (const [index, course] of INSPIRATION_DIALOGUE_COURSES.entries()) {
  test(`${course.slug}: final delivery moves to lesson eight and all lessons use existing owners`, async () => {
    const source = INSPIRATION_COURSES[index]!;
    assert.equal(source.spec.lessonPolicy, 'lesson-guided.v1');
    assert.notEqual(source.bootstrapKey, course.bootstrapKey);
    assert.notEqual(source.teamId, course.teamId);
    assert.deepEqual(source.spec.objectives, course.spec.objectives);
    assert.deepEqual(source.spec.materials, course.spec.materials);
    assert.deepEqual(source.spec.safetyRequirements, course.spec.safetyRequirements);
    assert.deepEqual(source.rubric, course.rubric);
    assert.equal(validateProjectTemplateSpec(course.spec).valid, true);
    const h = await fullflowHarness(true, true, false, false, false, course, true);
    h.directory.currentMentorId = null;
    let serial = 0, finalVersions = 0;
    for (const session of h.plan.sessions) {
      const scope = { planId: h.planId, planRevision: 1, learningSessionId: session.id };
      for (let round = 0; (await h.progress.readProgress(STUDENT, h.planId)).currentSessionId === session.id; round++) {
        assert.ok(round < 20);
        const activity = (await h.current()).lesson.currentActivity;
        assert.ok(activity);
        const key = `${course.slug}:${serial++}`;
        if (activity.evidence === 'mastery') {
          const started = await h.assessment.start(STUDENT, h.projectId, scope);
          assert.ok(started.nextStep?.question);
          const pending = await h.store.findPendingQuestion(started.nextStep.question.questionId); assert.ok(pending);
          // Only a disposable synthetic fixture may read its answer oracle.
          await h.assessment.answer(STUDENT, h.projectId, { ...scope, questionId: pending.id, answer: pending.expectedAnswer }, key);
        } else {
          const body = { planRevision: 1, activityId: activity.activityId,
            content: 'Synthetic fixture response: evidence is explicitly simulated; I explain the method, trace the records and identify a limitation.' };
          if (activity.evidence === 'submitted_artifact') {
            assert.equal(session.lessonIndex, 8);
            const receipt = await h.learningEvidence.submitArtifact(STUDENT, h.planId, session.id, { ...body, requestReview: true }, key);
            assert.equal(receipt.artifact.status, 'published'); finalVersions++;
          } else if (activity.kind === 'reflect') await h.learningEvidence.submitReflection(STUDENT, h.planId, session.id, body, key);
          else await h.learningEvidence.submitResponse(STUDENT, h.planId, session.id, body, key);
          await h.lifecycle.reconcile(STUDENT, h.projectId, scope, `${key}:sync`);
        }
      }
    }
    assert.equal(finalVersions, 1);
    assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 8);
    assert.equal((await h.store.findProject(h.projectId))?.status, 'completed');
  });
}
