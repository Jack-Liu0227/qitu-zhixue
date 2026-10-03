import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GraphitiMasteryProvider, masteryGraphPayload, type MasteryGraphPort } from './mastery-graph-provider';
import { MasteryProjectionWorker, type MasteryProjectionJob, type MasteryProjectionSource } from './mastery-projection-worker';
import type { MasteryAssessmentEvent } from '@qitu/contracts';

const event: MasteryAssessmentEvent = {
  id: 'e1', schoolId: 'school-1', studentId: 'student-1', knowledgePointId: 'kp', courseVersion: 'v1',
  objectiveId: 'obj', planId: 'plan', projectId: 'project', eventType: 'assessed', knowledgeType: 'procedure',
  score: 0.9, confidence: null, qualitativeMastered: null, validFrom: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-02T00:00:00.000Z', sequence: 1,
  evidenceRefs: ['attempt:1'], sourceType: 'quiz', sourceEventId: 'attempt-1', causationId: null, correlationId: null,
  supersedesEventId: null, assessmentVersion: 'qitu.mastery.v1', idempotencyKey: 'k1',
};

function source() {
  const payload = masteryGraphPayload(event);
  const job: MasteryProjectionJob = { payload, leaseOwner: 'lease1', outboxId: 'o1' };
  let claimed = false;
  let failures: string[] = [];
  let finishes = 0;
  const source: MasteryProjectionSource = {
    claim: async () => claimed ? null : (claimed = true, job),
    finish: async () => { finishes += 1; return true; },
    fail: async (_job, code) => { failures.push(code); },
    rebuild: async () => ({ count: 1, nextCursor: null }),
    reconcile: async () => ({ checked: 1, repaired: 0, nextCursor: null }),
  };
  return { source, job, failures, finishes: () => finishes };
}

describe('mastery graph projection', () => {
  it('minimizes fields and produces stable hash/key for retry', () => {
    const payload = masteryGraphPayload({ ...event, conversation: 'raw', answer: 'private' } as MasteryAssessmentEvent);
    assert.equal(JSON.stringify(payload).includes('private'), false);
    assert.equal(JSON.stringify(payload).includes('raw'), false);
    assert.deepEqual(payload, masteryGraphPayload(event));
  });
  it('delivers once and acknowledges only matching graph receipt', async () => {
    const test = source();
    const graph: MasteryGraphPort = {
      reconcile: async (payload) => ({ projectionKey: payload.projectionKey, payloadHash: payload.payloadHash, projectionId: 'g1' }),
      inspect: async () => null,
    };
    const worker = new MasteryProjectionWorker(test.source, graph);
    assert.equal(await worker.runOnce(), 'published');
    assert.equal(await worker.runOnce(), 'idle');
    assert.equal(test.finishes(), 1);
  });
  it('graph outage retries without persisting credential-bearing error text', async () => {
    const test = source();
    const graph = { reconcile: async () => { throw new Error('token=not-for-logs student text'); }, inspect: async () => null };
    assert.equal(await new MasteryProjectionWorker(test.source, graph).runOnce(), 'retry');
    assert.deepEqual(test.failures, ['GRAPHITI_UNAVAILABLE']);
    assert.equal(test.finishes(), 0);
  });
  it('lost lease and mismatched receipt are not acknowledged as success', async () => {
    const test = source();
    test.source.finish = async () => false;
    const graph = { reconcile: async (payload: ReturnType<typeof masteryGraphPayload>) => ({ projectionKey: payload.projectionKey, payloadHash: payload.payloadHash, projectionId: 'g1' }), inspect: async () => null };
    assert.equal(await new MasteryProjectionWorker(test.source, graph).runOnce(), 'lease_lost');
    const mismatch = source();
    graph.reconcile = async () => ({ projectionKey: 'wrong', payloadHash: 'wrong', projectionId: 'g1' });
    assert.equal(await new MasteryProjectionWorker(mismatch.source, graph).runOnce(), 'retry');
    assert.deepEqual(mismatch.failures, ['GRAPHITI_RECEIPT_MISMATCH']);
  });
  it('HTTP provider uses private authenticated idempotent PUT and inspection GET', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    const payload = masteryGraphPayload(event);
    const provider = new GraphitiMasteryProvider({ baseUrl: 'http://localhost:4180', token: 'test-only', fetcher: async (url, options) => {
      calls.push({ url: String(url), method: options?.method });
      assert.equal((options?.headers as Record<string, string>).authorization, 'Bearer test-only');
      return new Response(JSON.stringify({ projectionKey: payload.projectionKey, payloadHash: payload.payloadHash, projectionId: 'g1' }), { status: 200 });
    } });
    await provider.reconcile(payload);
    await provider.inspect(payload.projectionKey);
    assert.equal(calls[0]?.method, 'PUT');
    assert.equal(calls[1]?.method, 'GET');
    assert.ok(calls[0]?.url.endsWith(encodeURIComponent(payload.projectionKey)));
  });
  it('rebuild and reconciliation commands delegate to durable source', async () => {
    const test = source();
    const worker = new MasteryProjectionWorker(test.source, { reconcile: async () => { throw new Error('unused'); }, inspect: async () => null });
    assert.equal((await worker.rebuild()).count, 1);
    assert.equal((await worker.reconcile()).checked, 1);
  });
});
