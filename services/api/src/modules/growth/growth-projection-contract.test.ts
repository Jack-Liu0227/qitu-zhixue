import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGrowthEvidenceRefs,
  validateGrowthProjectionResult,
} from '@qitu/contracts';

test('growth projection contract rejects unknown fields and unsupported evidence refs', () => {
  const profile = {
    version: 1,
    priorKnowledge: null,
    targetLevel: null,
    timeBudgetMinutesPerWeek: null,
    preferences: [],
    interests: ['optics'],
    strengths: [],
    nextQuestions: [],
    rawConversation: 'must not enter the projection',
  };
  const unknown = validateGrowthProjectionResult('learner_profile', profile);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'PROJECTION_UNKNOWN_FIELD');

  const trajectory = validateGrowthProjectionResult('growth_trajectory', {
    version: 1,
    milestones: [],
    strengths: [],
    nextQuestions: [],
    studentSummary: null,
    evidenceRefs: ['raw_conversation:turn-1'],
    confidence: null,
  });
  assert.equal(trajectory.ok, false);
  assert.equal(trajectory.code, 'PROJECTION_EVIDENCE_INVALID');
  assert.deepEqual(normalizeGrowthEvidenceRefs(['artifact:work-1', 'raw_conversation:turn-1']), ['artifact:work-1']);
});

test('growth trajectory requires at least one opaque evidence ref to validate', () => {
  const result = validateGrowthProjectionResult('growth_trajectory', {
    version: 1,
    milestones: [],
    strengths: [],
    nextQuestions: [],
    studentSummary: null,
    evidenceRefs: [],
    confidence: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROJECTION_EVIDENCE_INVALID');
});
