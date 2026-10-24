import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivePracticeGateFromDeliverable, GATE_CONDITION_CORE, GATE_CONDITION_REGISTRY,
  parseProjectTemplateSpec, validateProjectTemplateSpec } from '@qitu/contracts';
import { PBL_GATE_SOURCE_WHITELIST, pblGateErrorCode } from '@qitu/ai-client';
import { THUNDER_TEMPLATE_SPEC } from '../templates/content/thunder-fighter';
import { assertGateEvidenceWritable } from '../team-runtime/team-runtime.service';

test('rubric artifacts use an independently registered Works gate without changing historical profiles', () => {
  assert.equal(derivePracticeGateFromDeliverable('narrative_portfolio', 'rubric_artifact'), 'rubric_artifact_validated');
  assert.equal(derivePracticeGateFromDeliverable('narrative_portfolio'), null, 'a title never grants an evidence profile');
  assert.equal(derivePracticeGateFromDeliverable(null, 'runnable_code'), 'code_playable_run_verified');
  assert.equal(derivePracticeGateFromDeliverable(null, 'experiment_report'), 'experiment_report_validated');
  assert.deepEqual(GATE_CONDITION_CORE, ['student_confirmed_intent', 'TheoryMastered', 'code_playable_run_verified', 'review_completed_and_archived']);
  assert.deepEqual(GATE_CONDITION_REGISTRY.rubric_artifact_validated?.allowedSources, ['works.publish-approved']);
  assert.deepEqual(PBL_GATE_SOURCE_WHITELIST.rubric_artifact_validated, ['works.publish-approved']);
  assert.equal(pblGateErrorCode('rubric_artifact_validated'), 'PBL_GATE_ARTIFACT_NOT_VALIDATED');
  assert.equal(GATE_CONDITION_REGISTRY.rubric_artifact_validated?.phase, 'guided_practice');
  assert.deepEqual(assertGateEvidenceWritable('rubric_artifact_validated', 'artifact_version:fixture-v1', 'works.publish-approved'),
    { evidenceRef: 'artifact_version:fixture-v1', source: 'works.publish-approved' });
  for (const source of ['mentor_review', 'runner', 'server_backfill', 'student']) {
    assert.throws(() => assertGateEvidenceWritable('rubric_artifact_validated', 'artifact_version:fixture-v1', source));
  }
});

test('the canonical parser accepts autonomous rubric teaching and rejects unregistered profiles', () => {
  const spec = structuredClone(THUNDER_TEMPLATE_SPEC);
  const canonical = parseProjectTemplateSpec({ ...spec, governancePolicyId: 'rubric-pbl:v1',
    phases: spec.phases.map(phase => phase.phase === 'guided_practice'
      ? { ...phase, gateCondition: 'rubric_artifact_validated', evidenceProfile: 'rubric_artifact' } : phase),
    curriculum: { profiles: spec.curriculum!.profiles.map(profile => ({ ...profile, sessions: profile.sessions.map(session => ({
      ...session,
      ...(session.checkpoint?.requiredGate === 'code_playable_run_verified' ? { checkpoint: { requiredGate: 'rubric_artifact_validated' } } : {}),
      completionSpec: session.completionSpec?.version === 'learning-session-completion.v2'
        ? { ...session.completionSpec, qualityReview: { ...session.completionSpec.qualityReview, reviewer: 'autonomous-learning.v1' } } : session.completionSpec,
    })) })) },
  });
  assert.equal(canonical.phases[2]?.evidenceProfile, 'rubric_artifact');
  assert.equal(validateProjectTemplateSpec({ ...canonical, phases: canonical.phases.map(phase => ({ ...phase, evidenceProfile: 'unknown_profile' })) }).valid, false);
  assert.equal(THUNDER_TEMPLATE_SPEC.phases[2]?.evidenceProfile, 'runnable_code');
});
