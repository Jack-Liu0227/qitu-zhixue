import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPTICS_GUIDED_TEMPLATE_SPEC, WAVE_OPTICS_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { LearningEvidenceProof } from '@qitu/contracts';
import { projectLessonActivities } from './lesson-activity-progress';

const lesson = OPTICS_GUIDED_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions[15]!;
const scope = { projectId: 'project', planId: 'plan', planRevision: 1, learningSessionId: 'session', objectiveIds: ['objective'] };
function proof(activity: string, sourceKind: 'task_submission' | 'reflection' = 'task_submission'): LearningEvidenceProof {
  return { activityId: `session:activity:${activity}`, kind: 'session_response', ref: `${sourceKind}:${activity}`,
    sourceKind, scope, objectiveId: 'objective', quality: { status: 'accepted', subjectDigest: 'fixture', feedback: [] } };
}

test('final reflection requires the reflection owner source even if an ordinary response has been reviewed', () => {
  const proofs = ['review', 'theory', 'check', 'reflect'].map(activity => proof(activity));
  const input = { lesson, sessionId: 'session', proofs, masteryAccepted: false };
  assert.equal(projectLessonActivities(input).find(activity => activity.status === 'current')?.kind, 'reflect');
  assert.equal(projectLessonActivities({ ...input, proofs: [...proofs, proof('reflect', 'reflection')] }).every(activity => activity.status === 'completed'), true);
});

test('pending or foreign activity receipts do not advance; locked lessons never advertise an active inner task', () => {
  const pending = proof('review'); pending.quality = { ...pending.quality!, status: 'pending' };
  assert.equal(projectLessonActivities({ lesson, sessionId: 'session', proofs: [pending], masteryAccepted: false })[0]?.status, 'current');
  const foreign = proof('review'); foreign.scope = { ...scope, learningSessionId: 'other-session' };
  assert.equal(projectLessonActivities({ lesson, sessionId: 'session', proofs: [foreign], masteryAccepted: false })[0]?.status, 'current');
  assert.equal(projectLessonActivities({ lesson, sessionId: 'session', proofs: [], masteryAccepted: false, locked: true })
    .every(activity => activity.status === 'locked'), true);
});

test('comparison practice remains current until distinct reviewed observations meet the frozen lesson requirement', () => {
  const comparison = WAVE_OPTICS_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions[3]!;
  const observation: LearningEvidenceProof = { ...proof('practice'), kind: 'experiment_observation',
    sourceKind: 'experiment_observation', ref: 'experiment_observation:first' };
  const input = { lesson: comparison, sessionId: 'session', masteryAccepted: false,
    proofs: [...['review', 'theory', 'check', 'reflect'].map(activity => proof(activity)), observation] };
  const current = (proofs: LearningEvidenceProof[]) => projectLessonActivities({ ...input, proofs }).find(activity => activity.status === 'current')?.kind;
  assert.equal(current(input.proofs), 'practice');
  const practice = (proofs: LearningEvidenceProof[]) => projectLessonActivities({ ...input, proofs }).find(activity => activity.kind === 'practice')!;
  assert.match(practice(input.proofs).guidance, /需保存 2 条.*当前 1 \/ 2 条/);
  assert.match(practice([...input.proofs, observation]).guidance, /当前 1 \/ 2 条/);
  assert.match(practice([...input.proofs, { ...observation, ref: 'experiment_observation:pending', quality: { ...observation.quality!, status: 'pending' } }]).guidance, /当前 1 \/ 2 条/);
  assert.match(practice([...input.proofs, { ...observation, ref: 'experiment_observation:foreign', scope: { ...scope, learningSessionId: 'other' } }]).guidance, /当前 1 \/ 2 条/);
  assert.equal(current([...input.proofs, observation]), 'practice');
  assert.equal(current([...input.proofs, { ...observation, ref: 'experiment_observation:second', quality: { ...observation.quality!, status: 'pending' } }]), 'practice');
  assert.equal(current([...input.proofs, { ...observation, ref: 'experiment_observation:second' }]), undefined);
  assert.match(practice([...input.proofs, { ...observation, ref: 'experiment_observation:second' }]).guidance, /当前 2 \/ 2 条。观察数量已达标/);
});
