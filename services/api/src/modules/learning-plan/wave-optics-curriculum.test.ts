import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import { buildQuestion, toPublicQuestion, gradeAnswer } from '@qitu/ai-client';
import { WAVE_OPTICS_TEMPLATE_SPEC, WAVE_OPTICS_READINESS_IDS, OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { generatePlanFromTemplate } from './template-plan-generator';
import { validateGeneratedPlan } from './session-plan-validator';

test('wave course generates eight exact frozen lessons with only its approved readiness gates', () => {
  const template = WAVE_OPTICS_TEMPLATE_SPEC;
  assert.equal(validateProjectTemplateSpec(template).valid, true);
  const plan = generatePlanFromTemplate({ interest: '干涉与衍射', goal: '明暗条纹探究档案', lessonCount: 8, lessonMinutes: 60 },
    { templateVersion: 'wave-course-v1', templateSpec: template });
  assert.equal(plan.sessions.length, 8);
  validateGeneratedPlan(plan, template);
  const altered = structuredClone(plan);
  altered.sessions[1]!.theoryObjectiveIds = ['wave-question'];
  assert.throws(() => validateGeneratedPlan(altered, template), /not declared by the frozen template/);
  assert.deepEqual(plan.sessions[1]?.theoryObjectiveIds, [...WAVE_OPTICS_READINESS_IDS]);
  for (const session of plan.sessions.slice(2, 7)) assert.deepEqual(session.theoryObjectiveIds, [...WAVE_OPTICS_READINESS_IDS]);
  assert.ok(plan.sessions.every(session => !session.theoryObjectiveIds.some(id => id.startsWith('opt-theory-'))));
  assert.equal(OPTICS_16_SESSION_TEMPLATE_SPEC.curriculum?.profiles[0]?.sessions.length, 16);
  assert.ok(template.curriculum?.profiles[0]?.sessions.every(session => session.opening && session.leadAssistantId !== 'qitu-intake-assistant'));
});

test('course parser rejects fake intake teachers, duplicate opening actions and unscheduled collaboration', () => {
  const bad = structuredClone(WAVE_OPTICS_TEMPLATE_SPEC);
  const lesson = bad.curriculum?.profiles[0]?.sessions[0];
  assert.ok(lesson);
  assert.equal(validateProjectTemplateSpec({ ...bad, curriculum: { profiles: [{ ...bad.curriculum?.profiles[0], sessions: [
    { ...lesson, leadAssistantId: 'qitu-intake-assistant' }, ...(bad.curriculum?.profiles[0]?.sessions.slice(1) ?? []),
  ] }] } }).valid, false);
  const mutate = (replacement: unknown) => validateProjectTemplateSpec({ ...bad, curriculum: { profiles: [{
    ...bad.curriculum?.profiles[0], sessions: [replacement, ...(bad.curriculum?.profiles[0]?.sessions.slice(1) ?? [])],
  }] } }).valid;
  assert.equal(mutate({ ...lesson, opening: { ...lesson.opening, options: [{ id: 'same', label: 'a', text: 'a' }, { id: 'same', label: 'b', text: 'b' }] } }), false);
  assert.equal(mutate({ ...lesson, collaborators: [{ assistantId: 'optics-concept-coach', activity: 'practice',
    trigger: 'after_evidence', purpose: 'critique', requiredSkillIds: ['tutor-guided-learning'] }] }), false);
});

test('readiness questions vary deterministically and use private server answers rather than generic objective-name grading', () => {
  for (const objective of WAVE_OPTICS_TEMPLATE_SPEC.objectives.filter(item => WAVE_OPTICS_READINESS_IDS.some(id => id === item.id))) {
    for (let index = 0; index < 6; index++) {
      const input = { objective: { id: `plan:${objective.id}`, name: objective.title, type: 'concept' as const, conceptId: objective.conceptId }, index };
      const card = buildQuestion(input);
      assert.deepEqual(buildQuestion(input), card);
      assert.equal(card.questionType, 'choice');
      assert.equal(new Set(card.options.map(option => option.body)).size, 4);
      const option = card.options.find(item => item.body === card.expectedAnswer);
      assert.ok(option);
      assert.equal(gradeAnswer(card, option.id).isCorrect, true);
      const publicQuestion = toPublicQuestion(card);
      assert.ok(!('expectedAnswer' in publicQuestion));
      assert.ok(!('explanation' in publicQuestion));
    }
  }
});
