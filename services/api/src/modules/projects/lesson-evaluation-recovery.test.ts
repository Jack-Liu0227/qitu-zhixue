import assert from 'node:assert/strict';
import test from 'node:test';
import { fullflowHarness, STUDENT } from '../learning-plan/optics-fullflow.test-fixture';
import { LessonEvaluationRecoveryStore, readLessonRecoveryRequest, type LessonEvaluationRecoveryJob,
  type LessonEvaluationRecoveryRequest } from '../works/lesson-evaluation-recovery.store';
import { LessonEvaluationRecoveryService } from './lesson-evaluation-recovery.service';

class FixtureRecoveryStore extends LessonEvaluationRecoveryStore {
  job: LessonEvaluationRecoveryJob | null = null;
  outcome: { code?: string; terminal: boolean } | null = null;
  constructor() { super(null); }
  override async student() { return { ...STUDENT, role: 'student' as const }; }
  override async schedule(request: LessonEvaluationRecoveryRequest) {
    this.job ??= { id: 'recovery', leaseOwner: 'fixture-lease', attempts: 1, request };
    return true;
  }
  override async claim() { const job = this.job; this.job = null; return job; }
  override async finish(_job: LessonEvaluationRecoveryJob, code?: string, terminal = false) { this.outcome = { code, terminal }; }
}

async function harness() {
  const queue = new FixtureRecoveryStore();
  const h = await fullflowHarness(true, true, true, true, false, undefined, true, queue);
  const worker = new LessonEvaluationRecoveryService(queue, h.learningEvidence, h.lifecycle);
  const sessionId = h.plan.sessions[0]!.id;
  const submit = (key: string) => h.learningEvidence.submitResponse(STUDENT, h.planId, sessionId,
    { planRevision: 1, activityId: `${sessionId}:activity:check`, content: '比较双缝与单缝条纹，只改变缝间距，固定波长与屏幕位置。' }, key);
  return { ...h, queue, worker, sessionId, submit };
}

test('automatic recovery evaluates the saved proof and advances through the existing owners exactly once', async () => {
  const h = await harness();
  h.evaluation.fail = true;
  const saved = await h.submit('initial');
  assert.equal(saved.proof.quality?.status, 'pending');
  assert.ok(h.queue.job);
  const originalJob = h.queue.job;
  h.evaluation.fail = false;
  assert.equal(await h.worker.runOnce(), 'recovered');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 1);
  assert.equal((await h.learningEvidence.getLessonProofs(STUDENT, h.planId, h.sessionId, 1)).submissions.length, 1);
  h.queue.job = originalJob;
  assert.equal(await h.worker.runOnce(), 'recovered');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 1);
});

test('recovery does not pass unavailable evaluation or another project/revision', async () => {
  const h = await harness();
  h.evaluation.fail = true;
  await h.submit('outage');
  assert.ok(h.queue.job);
  const job = h.queue.job;
  assert.equal(await h.worker.runOnce(), 'retry');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  h.queue.job = { ...job, request: { ...job.request, projectId: 'other-project' } };
  assert.equal(await h.worker.runOnce(), 'failed');
  assert.equal(h.queue.outcome?.terminal, true);
  h.queue.job = { ...job, request: { ...job.request, planRevision: 2 } };
  assert.equal(await h.worker.runOnce(), 'failed');
  assert.equal((await h.progress.readProgress(STUDENT, h.planId)).completedCount, 0);
  h.queue.job = { ...job, attempts: 3 };
  assert.equal(await h.worker.runOnce(), 'failed');
});

test('recovery payload contains bounded owner references and rejects malformed scopes', () => {
  const valid = { studentId: 'student', projectId: 'project', planId: 'plan', planRevision: 1,
    learningSessionId: 'session', evidenceRef: 'task_submission:saved' };
  assert.deepEqual(readLessonRecoveryRequest(valid), valid);
  for (const bad of [null, [], { ...valid, planRevision: 1.5 }, { ...valid, evidenceRef: 'model:passed' },
    { ...valid, studentId: '' }, { ...valid, learningSessionId: null }]) assert.equal(readLessonRecoveryRequest(bad), null);
});
