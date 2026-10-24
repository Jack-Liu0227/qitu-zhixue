import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorReplyBlock } from '@qitu/contracts';
import { experimentReadOnlyReason } from './experimentAvailability';

const block: Extract<TutorReplyBlock, { kind: 'optics_experiment' }> = {
  kind: 'optics_experiment', experimentId: 'example', title: '双缝比较', initialMode: 'interference',
  specVersion: '2.0.0', objectiveId: 'optics.wave.interference', sessionIndex: 3,
  allowedActions: ['submit_prediction', 'run', 'record_observation'],
  scope: { planId: 'plan', planRevision: 1, learningSessionId: 'lesson', objectiveId: 'target',
    activityId: 'practice', rubricRef: 'rubric', cerRef: 'cer' },
};
const context = {
  project: { stage: 'practice_building' as const },
  lesson: { status: 'current' as const, planId: 'plan', planRevision: 1, learningSessionId: 'lesson',
    currentActivity: { activityId: 'practice', kind: 'practice' as const, evidence: 'experiment_observation' as const,
      status: 'current' as const, guidance: 'Compare', minutes: 20, evidenceRefs: [] } },
};

test('only the owner-issued card for the current practice activity is actionable', () => {
  assert.equal(experimentReadOnlyReason(block, context), null);
  for (const scope of [{ ...block.scope!, planRevision: 2 }, { ...block.scope!, learningSessionId: 'previous' },
    { ...block.scope!, activityId: 'previous' }]) {
    assert.match(experimentReadOnlyReason({ ...block, scope }, context)!, /已经结束或切换/);
  }
  assert.match(experimentReadOnlyReason(block, { ...context, lesson: { ...context.lesson, currentActivity: null } })!, /已经结束或切换/);
});

test('archived projects, missing context and theory are distinct from actionable experiments', () => {
  assert.match(experimentReadOnlyReason(block, { ...context, project: { stage: 'completed' } })!, /供你回看/);
  assert.doesNotMatch(experimentReadOnlyReason(block, { ...context, project: { stage: 'completed' } })!, /门禁未通过/);
  assert.match(experimentReadOnlyReason(block, { ...context, project: { stage: 'theory_check' } })!, /理论课/);
  assert.match(experimentReadOnlyReason(block)!, /正在核对/);
  assert.match(experimentReadOnlyReason({ ...block, allowedActions: [] }, context)!, /仅供回看/);
});
