import assert from 'node:assert/strict';
import test from 'node:test';
import { expressionQuestion, expressionSummary, validateTutorExpressionProjection, type TutorExpressionEvidence } from '@qitu/contracts';

export const expressionEvidence: TutorExpressionEvidence = {
  manifest: { policyVersion: 'tutor-expression.v1', sourceEventId: 'event', runId: 'run', sessionId: 'session', studentTurnId: 'turn-student',
    assistantTurnId: 'turn-assistant', projectionType: 'learner_profile', observedThrough: '2026-10-21T00:00:00.000Z', sourceHash: 'hash', baseCandidateId: null, baseVersion: 0 },
  studentText: '我喜欢光学，我希望先看模拟。光学中缝宽变化有什么影响？',
  evidenceRef: 'learning_interaction:turn-student', previousResult: null,
};
export const expressionProfile = {
  version: 1, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null,
  preferences: ['先看模拟'], interests: ['光学'], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')],
};
const growth = { version: 1, milestones: [], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')],
  studentSummary: expressionSummary('缝宽变化'), evidenceRefs: [expressionEvidence.evidenceRef], confidence: 'low' };

test('real explicit interest/preference and bounded inquiry produce reviewable results', () => {
  assert.equal(validateTutorExpressionProjection('learner_profile', expressionProfile, expressionEvidence), null);
  assert.equal(validateTutorExpressionProjection('growth_trajectory', growth, expressionEvidence), null);
});

test('conversation cannot establish knowledge, ability, completion, ranking or a diagnosis', () => {
  for (const patch of [{ strengths: ['已经掌握光学'] }, { priorKnowledge: '专家水平' }, { targetLevel: '已通过' }, { timeBudgetMinutesPerWeek: 100 }]) {
    assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, ...patch }, expressionEvidence), 'PROJECTION_AUTHORITY_CLAIM_FORBIDDEN');
  }
  for (const patch of [{ milestones: ['理论已掌握'] }, { strengths: ['高智商'] }, { confidence: 'high' }]) {
    assert.equal(validateTutorExpressionProjection('growth_trajectory', { ...growth, ...patch }, expressionEvidence), 'PROJECTION_AUTHORITY_CLAIM_FORBIDDEN');
  }
});

test('unsupported claims, full utterance copying, negated preferences and foreign evidence stay pending', () => {
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, interests: ['天文学'] }, expressionEvidence), 'PROJECTION_POLICY_REVIEW_REQUIRED');
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, preferences: ['先看模拟'] }, { ...expressionEvidence, studentText: '我不喜欢先看模拟。我喜欢光学，想知道缝宽变化。' }), 'PROJECTION_POLICY_REVIEW_REQUIRED');
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, preferences: [] }, { ...expressionEvidence, studentText: '我喜欢光学吗？我不确定缝宽变化。' }), 'PROJECTION_POLICY_REVIEW_REQUIRED');
  assert.equal(validateTutorExpressionProjection('growth_trajectory', { ...growth, studentSummary: expressionSummary(expressionEvidence.studentText) }, expressionEvidence), 'PROJECTION_POLICY_REVIEW_REQUIRED');
  assert.equal(validateTutorExpressionProjection('growth_trajectory', { ...growth, evidenceRefs: ['learning_interaction:other-student'] }, expressionEvidence), 'PROJECTION_EVIDENCE_INVALID');
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, version: 2 }, expressionEvidence), 'PROJECTION_VERSION_STALE');
});

test('accepted history remains intact and arbitrary student instructions never change allowed fields', () => {
  const evidence = { ...expressionEvidence, previousResult: { ...expressionProfile, interests: ['植物'], preferences: [] }, manifest: { ...expressionEvidence.manifest, baseVersion: 1 } };
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, version: 2, interests: ['植物', '光学'] }, evidence), null);
  assert.equal(validateTutorExpressionProjection('learner_profile', { ...expressionProfile, version: 2 }, evidence), 'PROJECTION_POLICY_REVIEW_REQUIRED');
  assert.equal(validateTutorExpressionProjection('growth_trajectory', { ...growth, rawConversation: expressionEvidence.studentText }, expressionEvidence), 'PROJECTION_UNKNOWN_FIELD');
});

test('conversation updates cannot relabel existing achievements or non-conversation evidence', () => {
  for (const patch of [{ milestones: ['approved work'] }, { strengths: ['reviewed skill'] }, { evidenceRefs: ['artifact:approved-work'] }]) {
    const previousResult = { ...growth, ...patch };
    const evidence = { ...expressionEvidence, previousResult, manifest: { ...expressionEvidence.manifest, baseVersion: 1 } };
    assert.equal(validateTutorExpressionProjection('growth_trajectory', { ...previousResult, version: 2, evidenceRefs: [expressionEvidence.evidenceRef] }, evidence), 'PROJECTION_HISTORY_REVIEW_REQUIRED');
  }
});
