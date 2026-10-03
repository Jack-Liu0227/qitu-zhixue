import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CurrentUser, EvaluateMasteryInput } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import { InMemoryLearningPlanStore, type MasteryRecord, type PlanBundle } from '../learning-plan/learning-plan.store';
import { MasteryReadService } from './mastery.service';
import { MasteryDomainService } from './mastery-domain.service';

const actor: CurrentUser = { id: 'student', role: 'student', email: '', displayName: '' };
const time = new Date('2026-01-01T00:00:00Z');
const base: EvaluateMasteryInput = {
  studentId: 'student', knowledgePointId: 'local:objective', courseVersion: 'v1', objectiveId: 'objective', planId: 'plan', projectId: null,
  sourceType: 'quiz', sourceEventId: 'attempt', evidenceRefs: ['attempt:attempt'], validFrom: time.toISOString(), assessmentVersion: 'qitu.mastery.v1', idempotencyKey: 'key', knowledgeType: 'procedure', score: 0.95, confidence: null,
};

async function harness(fail = false) {
  const store = new InMemoryLearningPlanStore();
  const bundle: PlanBundle = {
    plan: { id: 'plan', studentUserId: 'student', projectId: null, interest: 'math', goal: '', weeks: 4, minutesPerSession: 60, templateVersion: 'v1', status: 'draft', version: 1, idempotencyKey: 'plan', confirmedAt: null, completedAt: null, createdAt: time, updatedAt: time },
    modules: [{ id: 'module', planId: 'plan', name: 'module', weekIndex: 0, objective: '', ordinal: 0 }],
    objectives: [{ id: 'objective', planId: 'plan', moduleId: 'module', name: 'math', type: 'procedure', objective: 'math', prerequisiteIds: [], ordinal: 0 }], sessions: [],
  };
  await store.createPlan(bundle);
  const record: MasteryRecord = { id: 'record', studentUserId: 'student', planId: 'plan', objectiveId: 'objective', knowledgeType: 'procedure', status: 'mastered', masteryBasisPoints: 9500, thresholdBasisPoints: 9000, qualitativeMastered: false, consecutiveCorrect: 3, consecutiveWrong: 0, intervalIndex: 0, nextReviewAt: null, reviewCount: 0, lapseCount: 0, updatedAt: time };
  await store.upsertMastery(record);
  await store.appendAttempt({ id: 'attempt', studentUserId: 'student', planId: 'plan', objectiveId: 'objective', questionId: 'question', result: 'correct', isCorrect: true, assessmentType: 'quiz', errorType: null, hintsUsed: 0, attemptCount: 3, qualityBasisPoints: 9500, userAnswer: null, createdAt: time });
  const access = { canReadStudent: async (user: CurrentUser, id: string) => (user.role === 'student' && user.id === id) || user.role === 'teacher' } as unknown as AccessPolicy;
  let outboxCount = 0;
  const audit = { write: async () => 'audit' } as unknown as AuditWriter;
  const outbox = { write: async () => { if (fail) throw new Error('outbox failure'); outboxCount += 1; return 'event'; } } as unknown as OutboxWriter;
  const service = new MasteryDomainService(store, new MasteryReadService(store, access), access, audit, outbox);
  return { store, service, outboxCount: () => outboxCount };
}

async function rejection(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal((error as { getResponse(): { code: string } }).getResponse().code, code);
    return true;
  });
}

describe('MasteryDomainService', () => {
  it('implements all MasteryTimelinePort methods, immutable evidence evaluation and replay', async () => {
    const test = await harness();
    const port = test.service.forActor(actor);
    const first = await port.evaluate(base);
    assert.equal(first.event.score, 0.95);
    assert.equal((await port.evaluate(base)).replayed, true);
    assert.equal(test.outboxCount(), 1);
    assert.equal((await port.getCurrent({ studentId: actor.id, validAt: null, knownAt: null })).length, 1);
    assert.equal((await port.checkThreshold({ studentId: actor.id, knowledgePointId: base.knowledgePointId, validAt: null, knownAt: null })).met, true);
    assert.equal((await port.snapshot({ studentId: actor.id, validAt: time.toISOString(), knownAt: null })).points.length, 1);
    assert.equal((await port.getTimeline({ studentId: actor.id, knowledgePointId: base.knowledgePointId, validAt: null, knownAt: null })).length, 1);
    assert.equal((await port.getRegressionAlerts({ studentId: actor.id })).length, 0);
  });
  it('rejects forged score/evidence/version, parents and cross-student writes', async () => {
    const { service } = await harness();
    await rejection(() => service.forActor(actor).evaluate({ ...base, score: 1 } as EvaluateMasteryInput), 'MASTERY_EVIDENCE_INVALID');
    await rejection(() => service.forActor(actor).evaluate({ ...base, sourceEventId: 'nonexistent' }), 'MASTERY_EVIDENCE_INVALID');
    await rejection(() => service.forActor(actor).evaluate({ ...base, assessmentVersion: 'model-picked' }), 'MASTERY_VERSION_MISMATCH');
    await rejection(() => service.forActor({ ...actor, role: 'parent' }).evaluate(base), 'MASTERY_WRITE_DENIED');
    await rejection(() => service.forActor(actor).evaluate({ ...base, studentId: 'other' }), 'MASTERY_WRITE_DENIED');
  });
  it('outbox failure rolls back event and projection', async () => {
    const test = await harness(true);
    await assert.rejects(() => test.service.forActor(actor).evaluate(base), /outbox failure/);
    assert.equal((await test.store.listMasteryEvents({ studentUserId: actor.id })).length, 0);
    assert.equal((await test.store.findMastery(actor.id, 'objective'))?.sourceEventId, undefined);
  });
  it('teacher correction/revoke remain evidence-bound and cannot be requested by a student', async () => {
    const test = await harness();
    const initial = await test.service.forActor(actor).evaluate(base);
    const correction = { ...base, sourceType: 'staff', eventType: 'corrected', score: 0.6, idempotencyKey: 'correct', supersedesEventId: initial.event.id } as EvaluateMasteryInput;
    await rejection(() => test.service.forActor(actor).evaluate(correction), 'MASTERY_WRITE_DENIED');
    const teacher = { ...actor, id: 'teacher', role: 'teacher' as const };
    await test.service.forActor(teacher).evaluate(correction);
    const port = test.service.forActor(teacher);
    assert.equal((await port.checkThreshold({ studentId: actor.id, knowledgePointId: base.knowledgePointId, validAt: null, knownAt: null })).met, false);
    await port.evaluate({ ...correction, eventType: 'revoked', idempotencyKey: 'revoke' });
    assert.equal((await port.getCurrent({ studentId: actor.id, validAt: null, knownAt: null }))[0]?.score, null);
    assert.equal((await test.store.listMasteryEvents({ studentUserId: actor.id })).length, 3);
  });
  it('scope/meaning changes reject reused idempotency keys', async () => {
    const test = await harness();
    await test.service.forActor(actor).evaluate(base);
    await rejection(() => test.service.forActor(actor).evaluate({ ...base, correlationId: 'different' }), 'MASTERY_IDEMPOTENCY_CONFLICT');
  });
});
