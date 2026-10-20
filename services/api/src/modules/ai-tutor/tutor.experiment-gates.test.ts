import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import type { TutorReplyBlock } from '@qitu/contracts';
import { TutorService } from './tutor.service';
import { TutorExperimentService } from './tutor-experiment.service';
import { ProjectEvidenceMaterializer } from '../works/project-evidence.service';
import { EmptyProjectEvidenceSource, InMemoryProjectEvidenceStore } from '../works/project-evidence.store';
import { FakeAuditWriter, FakeIdempotencyStore } from '../templates/templates.test-support';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { AuditWriter } from '../../common/audit';
import type { IdempotencyStore } from '../../common/idempotency';

const scope = {
  planId: 'plan-gates', planRevision: 1, learningSessionId: 'lesson-gates',
  rubricRef: 'rubric:optics-v1:optics-rubric', cerRef: 'cer:claim-evidence-reasoning:v1',
};

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
    scope,
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
      listPlansByStudent: async () => [{ id: 'plan-gates', projectId: 'project-gates', version: 1 }],
      findBundle: async () => ({ sessions: [{ id: 'lesson-gates', lessonIndex: 1 }] }),
    },
  });
  const evidenceStore = new InMemoryProjectEvidenceStore();
  const plans = (service as unknown as { learningStore: LearningPlanStore }).learningStore;
  const bindings = { getFrozenTeachingBundle: async () => ({
    scheduleProfileId: 'profile', template: { rubricId: 'optics-rubric', curriculum: {
      profiles: [{ id: 'profile', sessions: [{ sessionIndex: 1 }] }],
    } },
  }) } as unknown as TemplateBindingService;
  Object.assign(service, { experiments: new TutorExperimentService(
    plans, bindings, new ProjectEvidenceMaterializer(evidenceStore, new EmptyProjectEvidenceSource()),
    new FakeIdempotencyStore() as unknown as IdempotencyStore,
    new FakeAuditWriter() as unknown as AuditWriter, null,
  ) });

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
    action: 'record_observation', payload: { mode: 'diffraction', runActionId: run.actionId, observation: 'The central band is wider.', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'observation-after-run',
  });
  assert.equal(observation.accepted, true);
  assert.equal(observation.action, 'record_observation');
  assert.equal(observation.observationReceipt?.provenance, 'simulated_observation');
  assert.equal(observation.observationReceipt?.planRevision, 1);
  assert.equal((await evidenceStore.listByProject('project-gates')).length, 1);
  const replay = await service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'record_observation', payload: { mode: 'diffraction', runActionId: run.actionId, observation: 'The central band is wider.', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'observation-after-run',
  });
  assert.deepEqual(replay, observation);
  assert.equal((await evidenceStore.listByProject('project-gates')).length, 1);
  await assert.rejects(service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'record_observation', payload: { mode: 'diffraction', runActionId: run.actionId, observation: 'The central band is wider.', parameters: { wavelength: 532, slitWidth: 81, screenDistance: 1 } }, idempotencyKey: 'changed-parameters',
  }), (error: unknown) => errorCode(error) === 'TUTOR_EXPERIMENT_RUN_REQUIRED');
  Object.assign(plans, { listPlansByStudent: async () => [{ id: 'plan-gates', projectId: 'project-gates', version: 2 }] });
  await assert.rejects(service.submitExperimentAction('student-gates', record, 'optics-exp-gate-test', {
    action: 'run', payload: { mode: 'diffraction', parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } }, idempotencyKey: 'stale-plan',
  }), (error: unknown) => errorCode(error) === 'TUTOR_EXPERIMENT_REVISION_CHANGED');
});
