import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProjectTemplateSpec } from '@qitu/contracts';
import { buildQuestion } from '@qitu/ai-client';
import { QUIZ_BANK, toQuizBlockProjection } from '@qitu/ai-client/quiz-bank';
import { THUNDER_TEMPLATE_SPEC, THUNDER_VERSION_INPUT, THUNDER_THEORY_IDS } from './content/thunder-fighter';
import { assertTemplateTeachingContent } from './templates.content-validator';
import { generatePlanFromTemplate } from '../learning-plan/template-plan-generator';
import { validateGeneratedPlan } from '../learning-plan/session-plan-validator';

test('thunder lessons freeze a complete eight-lesson path with code-specific evidence gates', () => {
  assert.equal(validateProjectTemplateSpec(THUNDER_TEMPLATE_SPEC).valid, true);
  assert.doesNotThrow(() => assertTemplateTeachingContent(THUNDER_VERSION_INPUT.content!, THUNDER_VERSION_INPUT.stages));
  const sessions = THUNDER_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions;
  assert.equal(sessions.length, 8);
  assert.deepEqual(sessions.map(s => s.sessionIndex), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(sessions[2]!.checkpoint?.requiredGate, 'TheoryMastered');
  assert.equal(sessions[6]!.checkpoint?.requiredGate, 'code_playable_run_verified');
  assert.equal(sessions[7]!.checkpoint?.requiredGate, 'review_completed_and_archived');
  assert.equal(THUNDER_TEMPLATE_SPEC.phases[2]!.evidenceProfile, 'runnable_code');
  assert(sessions.every(s => s.leadAssistantId !== 'qitu-intake-assistant' && s.opening && s.completionSpec));
  assert(sessions.every(s => !s.requiredToolIds?.some(t => /wave|optics|execute|shell/.test(t))));
});

test('frozen game curriculum produces scoped formal concepts and practice prerequisites', () => {
  const plan = generatePlanFromTemplate({ interest: '雷霆战机', goal: '完成可玩的小游戏', lessonCount: 8, lessonMinutes: 60 }, {
    templateVersion: 'v1', templateSpec: THUNDER_TEMPLATE_SPEC,
  });
  assert.deepEqual(plan.sessions[3]!.theoryObjectiveIds, [...THUNDER_THEORY_IDS]);
  assert.equal(plan.sessions.length, 8);
  assert.doesNotThrow(() => validateGeneratedPlan(plan, THUNDER_TEMPLATE_SPEC));
  assert(plan.objectives.filter(o => THUNDER_THEORY_IDS.some(id => id === o.id)).every(o => o.conceptId?.startsWith('thunder.')));
});

test('game mastery uses actual registered questions and never exposes private answer fields', () => {
  for (const id of THUNDER_THEORY_IDS) {
    const objective = THUNDER_TEMPLATE_SPEC.objectives.find(o => o.id === id)!;
    const entries = QUIZ_BANK.filter(q => q.conceptId === objective.conceptId);
    assert.equal(entries.length, 3);
    for (let index = 0; index < 3; index++) {
      const question = buildQuestion({ objective: { id, name: objective.title, type: 'concept',
        conceptId: objective.conceptId }, index, seed: 'game-learner' });
      assert(entries.some(e => e.stem === question.prompt));
      assert(!question.prompt.includes('关键点1'));
      const projected = toQuizBlockProjection(entries[index]!);
      for (const key of ['expectedKeys', 'explanation', 'rationaleHint']) assert.equal(key in projected, false);
    }
  }
});
