import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProjectTemplateSpec, validateProjectTemplateSpec } from '@qitu/contracts';
import { buildQuestion } from '@qitu/ai-client';
import { QUIZ_BANK, toQuizBlockProjection } from '@qitu/ai-client/quiz-bank';
import { INSPIRATION_COURSES } from './content/inspiration';
import { assertTemplateTeachingContent } from './templates.content-validator';
import { generatePlanFromTemplate } from '../learning-plan/template-plan-generator';
import { validateGeneratedPlan } from '../learning-plan/session-plan-validator';

test('eight distinct courses define 24 domain assistants and 64 fully scoped lessons', () => {
  assert.equal(INSPIRATION_COURSES.length, 8);
  for (const field of ['slug', 'teamId', 'profileId', 'bootstrapKey'] as const) {
    assert.equal(new Set(INSPIRATION_COURSES.map(course => course[field])).size, 8);
  }
  assert.equal(new Set(INSPIRATION_COURSES.flatMap(course => [...course.assistantIds])).size, 24);
  assert.equal(new Set(INSPIRATION_COURSES.map(course => course.spec.targetDomain)).size, 8);
  assert.equal(INSPIRATION_COURSES.flatMap(course => course.spec.curriculum!.profiles[0]!.sessions).length, 64);
});

for (const course of INSPIRATION_COURSES) {
  test(`${course.slug}: canonical curriculum, artifact criteria and scoped formal questions`, () => {
    assert.equal(validateProjectTemplateSpec(course.spec).valid, true);
    assert.doesNotThrow(() => assertTemplateTeachingContent(course.versionInput.content!, course.versionInput.stages));
    const plan = generatePlanFromTemplate({ interest: course.spec.title, goal: course.spec.description, lessonCount: 8, lessonMinutes: 60 }, {
      templateVersion: `isolated-${course.slug}-v1`, templateSpec: course.spec,
    });
    assert.doesNotThrow(() => validateGeneratedPlan(plan, course.spec));
    const sessions = course.spec.curriculum!.profiles[0]!.sessions;
    assert.equal(sessions[2]?.checkpoint?.requiredGate, 'TheoryMastered');
    assert.equal(sessions[6]?.checkpoint?.requiredGate, 'rubric_artifact_validated');
    assert.equal(sessions[7]?.checkpoint?.requiredGate, 'review_completed_and_archived');
    assert.deepEqual(sessions.map(session => session.leadAssistantId), [...Array(3).fill(course.assistantIds[0]), ...Array(4).fill(course.assistantIds[1]), course.assistantIds[2]]);
    assert(sessions.every(session => session.opening && session.completionSpec?.version === 'learning-session-completion.v2'
      && session.completionSpec.qualityReview.reviewer === 'autonomous-learning.v1'
      && session.requiredToolIds?.every(tool => tool === 'tutor.propose_lesson_activity')));
    const seventh = sessions[6]!.completionSpec;
    assert(seventh?.version === 'learning-session-completion.v2');
    assert.deepEqual(seventh.qualityReview.artifactCriteria?.map(item => item.id), course.rubric.map(item => item.id));
    const invalid = structuredClone(course.spec);
    const review = invalid.curriculum!.profiles[0]!.sessions[6]!.completionSpec;
    assert(review?.version === 'learning-session-completion.v2');
    review.qualityReview.artifactCriteria = [];
    assert.throws(() => parseProjectTemplateSpec(invalid));
    for (const objective of course.spec.objectives.filter(item => item.kind === 'concept')) {
      const questions = QUIZ_BANK.filter(question => question.conceptId === objective.conceptId);
      assert.equal(questions.length, 3, objective.id);
      for (let index = 0; index < 3; index++) {
        const question = buildQuestion({ objective: { id: objective.id, name: objective.title, type: 'concept', conceptId: objective.conceptId }, index, seed: 'isolated-learner' });
        assert(questions.some(item => item.stem === question.prompt), 'no fallback or other-course question');
        const projected = toQuizBlockProjection(questions[index]!);
        for (const key of ['expectedKeys', 'explanation', 'rationaleHint']) assert.equal(key in projected, false);
      }
    }
  });
}
