import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import type { TutorReplyBlock } from '@qitu/contracts';
import { TutorService } from './tutor.service';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String((response as { code?: unknown }).code)
    : undefined;
}

function opticsBlock(): Extract<TutorReplyBlock, { kind: 'optics_experiment' }> {
  return {
    kind: 'optics_experiment',
    experimentId: 'optics-exp-gate-test',
    title: 'Diffraction',
    initialMode: 'diffraction',
    specVersion: '1.0.0',
    objectiveId: 'optics.wave.diffraction',
    sessionIndex: 1,
    allowedActions: ['submit_prediction', 'run', 'record_observation'],
    predictionGate: { required: true, submitted: false },
  };
}

test('server experiment flow keeps confirmation/theory gate ahead of prediction, run and observation', async () => {
  let projectStatus: 'intent_confirmed' | 'theory_learning' | 'practice_ready' = 'intent_confirmed';
  const service = new TutorService('test', { complete: async () => { throw new Error('not called'); } });
  Object.assign(service, {
    learningStore: {
      findProject: async () => ({
        id: 'project-gates', studentId: 'student-gates', templateVersionId: 'optics-v1',
        status: projectStatus, currentStageIndex: 2, stageTotal: 10, progressPercent: 20,
        title: 'Optics', subtitle: null, tags: ['optics'], createdAt: new Date(), completedAt: null,
      }),
    },
  });

  const record = service.getOrCreateSession('project-gates', 'student-gates');
  record.turns.push({
    turnId: 'assistant-experiment', role: 'assistant', blocks: [opticsBlock()], hintLevel: null,
    stageBefore: 'theory_learning', stageAfter: 'theory_learning', seq: 1,
    createdAt: new Date().toISOString(), modality: 'text',
    pedagogicMove: 'explain', expectedEvidence: null, promptVersion: 'test', evidenceRef: null,
  });

  await assert.rejects(
    service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
      action: 'submit_prediction', payload: { mode: 'diffraction', hypothesis: '中央明纹会变宽' }, idempotencyKey: 'prediction-before-gate',
    }),
    (error: unknown) => errorCode(error) === 'TUTOR_EXPERIMENT_GATE_REQUIRED',
  );

  projectStatus = 'theory_learning';
  await assert.rejects(
    service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
      action: 'submit_prediction', payload: { mode: 'diffraction', hypothesis: '中央明纹会变宽' }, idempotencyKey: 'prediction-during-theory',
    }),
    (error: unknown) => errorCode(error) === 'TUTOR_EXPERIMENT_GATE_REQUIRED',
  );

  projectStatus = 'practice_ready';
  await assert.rejects(
    service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
      action: 'run', payload: { mode: 'diffraction', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'run-before-prediction',
    }),
    (error: unknown) => errorCode(error) === 'TUTOR_EXPERIMENT_PREDICTION_REQUIRED',
  );

  const prediction = await service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'submit_prediction', payload: { mode: 'diffraction', hypothesis: '中央明纹会变宽' }, idempotencyKey: 'prediction-after-gate',
  });
  assert.equal(prediction.accepted, true);
  assert.equal(prediction.experimentId, 'optics-exp-gate-test');
  assert.ok(prediction.actionId);

  const run = await service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'run', payload: { mode: 'diffraction', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'run-after-prediction',
  });
  assert.equal(run.simulationResult?.mode, 'diffraction');

  const observation = await service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'record_observation', payload: { mode: 'diffraction', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'observation-after-run',
  });
  assert.equal(observation.accepted, true);
  assert.equal(observation.action, 'record_observation');
});
