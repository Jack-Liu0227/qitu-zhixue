import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudentLearningAnalysisStatus } from '@qitu/contracts';
import { analysisStatusMessage } from './analysis-status.js';

const analysis = (status: StudentLearningAnalysisStatus['status'], pendingReason: string | null = null): StudentLearningAnalysisStatus => ({
  status, pendingReason, policyVersion: null, sourceEventId: null, observedThrough: null,
});

test('unavailable and pending analysis explain different next states', () => {
  assert.match(analysisStatusMessage(analysis('unavailable')), /还没有已确认/);
  assert.match(analysisStatusMessage(analysis('pending')), /正在整理/);
  assert.match(analysisStatusMessage(analysis('accepted')), /核验后的学习记录/);
});

test('review failures never claim the result was accepted or keep saying generation is running', () => {
  for (const code of ['PROJECTION_UNKNOWN_FIELD', 'PROJECTION_RESULT_INVALID', 'PROJECTION_EVIDENCE_INVALID']) {
    const message = analysisStatusMessage(analysis('pending', code));
    assert.match(message, /未通过结果核验/);
    assert.doesNotMatch(message, /正在整理|PROJECTION_/);
  }
  assert.match(analysisStatusMessage(analysis('pending', 'PROJECTION_NO_NEW_OBSERVATION')), /暂未增加/);
  assert.match(analysisStatusMessage(analysis('pending', 'UNRECOGNIZED_INTERNAL_CODE')), /需要核验证据/);
});
