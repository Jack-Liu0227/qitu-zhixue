import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser, GetTutorSessionResponse, TutorReplyBlock } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import { LearningPlanService } from './learning-plan.service';
import { InMemoryLearningPlanStore, type PlanBundle } from './learning-plan.store';
import type { PlanGenerator } from './plan-generator';
import { dynamicQuestionEnvelope, parseChoiceQuestionCandidate, type QuestionCandidateScope } from './question-candidate';
import type { VerifyQuestionEvidence } from './question-candidate.sources';
import { TutorQuizService } from '../ai-tutor/tutor-quiz.service';
import { InMemoryTutorQuizStore } from '../ai-tutor/tutor-quiz.store';
import type { TutorSessionRecord } from '../ai-tutor/tutor.service';
import { restoreQuestionResults } from '../ai-tutor/tutor-question-results';

const actor: CurrentUser = { id: 'student-fixture', role: 'student', email: 'fixture@example.test', displayName: 'Fixture' };
const scope: QuestionCandidateScope = { projectId: 'project-fixture', planId: 'plan-fixture', planRevision: 1,
  learningSessionId: 'lesson-fixture', objectiveId: 'objective-fixture', tutorSessionId: 'tutor-fixture' };
const candidate = { prompt: 'A light ray reflects from a mirror. Which relation holds?',
  options: [{ text: 'Incident angle equals reflection angle' }, { text: 'Incident angle is always larger' }],
  correctOptionIndex: 0, explanation: 'Complete private explanation: measure both angles from the normal.',
  difficulty: 'easy' as const, sourceRefs: ['ima-read:fixture'] };
const verify: VerifyQuestionEvidence = async refs => refs.map(sourceRef => ({ sourceRef,
  knowledgeBaseId: 'kb-fixture', documentRefHash: 'a'.repeat(64), expiresAt: Date.now() + 60_000 }));
class IdempotencyFixture {
  private rows = new Map<string, { hash: string; body: unknown; status: number }>();
  async execute<T>(namespace: string, key: string, hash: string, handler: () => Promise<{ body: T; status?: number }>) {
    const id = `${namespace}:${key}`;
    const existing = this.rows.get(id);
    if (existing) {
      if (existing.hash !== hash) throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'Conflict');
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    const result = await handler();
    this.rows.set(id, { hash, body: result.body, status: result.status ?? 200 });
    return { ...result, status: result.status ?? 200, replayed: false };
  }
}
async function harness() {
  const store = new InMemoryLearningPlanStore();
  const now = new Date();
  const bundle: PlanBundle = {
    plan: { id: scope.planId, studentUserId: actor.id, projectId: null, interest: 'Optics', goal: 'Explain',
      lessonCount: 1, lessonMinutes: 60, minutesPerSession: 60, templateVersion: 'fixture-version', status: 'draft',
      version: 1, idempotencyKey: 'fixture-plan', confirmedAt: null, completedAt: null, createdAt: now, updatedAt: now },
    modules: [{ id: 'module', planId: scope.planId, name: 'Reflection', lessonIndex: 1, objective: 'Explain', ordinal: 1 }],
    objectives: [{ id: scope.objectiveId, planId: scope.planId, moduleId: 'module', name: 'Reflection', type: 'memory',
      objective: 'Explain reflection', prerequisiteIds: [], ordinal: 1 }],
    sessions: [{ id: scope.learningSessionId, planId: scope.planId, moduleId: 'module', index: 0, lessonIndex: 1,
      blocks: [{ kind: 'theory', minutes: 60 }], theoryObjectiveIds: [scope.objectiveId], practiceObjectiveIds: [], mode: 'study' }],
  };
  await store.createPlan(bundle);
  await store.confirmPlan({ planId: scope.planId, now, project: { id: scope.projectId, studentId: actor.id,
    templateVersionId: 'fixture-version', status: 'theory_learning', currentStageIndex: 2, stageTotal: 8,
    progressPercent: 25, title: 'Optics fixture', subtitle: null, tags: [] } });
  const audit = { entries: [] as AuditEntry[], fail: false, async write(entry: AuditEntry) {
    if (this.fail) throw new Error('audit unavailable'); this.entries.push(entry); return 'audit-fixture';
  } };
  const outbox = { events: [] as unknown[], async write(event: unknown) { this.events.push(event); return 'outbox'; } };
  const idempotency = new IdempotencyFixture() as unknown as IdempotencyStore;
  const service = new LearningPlanService(store, {} as PlanGenerator, idempotency, audit as unknown as AuditWriter,
    outbox as unknown as OutboxWriter, {} as AccessPolicy);
  return { store, service, audit, outbox, idempotency };
}
function code(expected: string) {
  return (error: unknown) => {
    assert.equal((error as { getResponse: () => { code: string } }).getResponse().code, expected); return true;
  };
}
function tutorSession(block: Extract<TutorReplyBlock, { kind: 'quiz' }>): TutorSessionRecord {
  return { sessionId: scope.tutorSessionId, projectId: scope.projectId, ownerId: actor.id, source: 'project',
    createdAt: new Date().toISOString(), lastSeq: 1, lastHintLevel: null, stallCount: 0, escalated: false,
    turns: [{ turnId: 'turn-fixture', role: 'assistant', blocks: [block], hintLevel: null, stageBefore: null, stageAfter: null,
      seq: 1, createdAt: new Date().toISOString(), modality: 'text', pedagogicMove: 'hint', expectedEvidence: null,
      promptVersion: null, evidenceRef: null }] };
}

test('generated choice validates exact schema and requires real server evidence before writing', async () => {
  const h = await harness();
  assert.throws(() => parseChoiceQuestionCandidate({ ...candidate, advance_stage: true }), code('QUESTION_CANDIDATE_INVALID'));
  assert.throws(() => parseChoiceQuestionCandidate({ ...candidate, options: [{ text: 'same' }, { text: 'SAME!' }] }), code('QUESTION_CANDIDATE_INVALID'));
  assert.throws(() => parseChoiceQuestionCandidate({ ...candidate, correctOptionIndex: 2 }), code('QUESTION_CANDIDATE_INVALID'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', undefined as never), code('QUESTION_SOURCE_UNVERIFIED'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', async () => []), code('QUESTION_SOURCE_UNVERIFIED'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', async refs => (await verify(refs)).map(source => ({ ...source, expiresAt: 1 }))), code('QUESTION_SOURCE_UNVERIFIED'));
  assert.equal(await h.store.findAwaitingQuestion(actor.id, scope.planId), null);
  assert.equal(h.audit.entries.length, 0);
});

test('candidate ownership, real session objective and exact plan revision are enforced', async () => {
  const h = await harness();
  await assert.rejects(h.service.acceptQuestionCandidate({ ...actor, id: 'other' }, scope, candidate, 'x', verify), code('LEARNING_PLAN_FORBIDDEN'));
  await assert.rejects(h.service.acceptQuestionCandidate({ ...actor, role: 'teacher' }, scope, candidate, 'x', verify), code('LEARNING_PLAN_FORBIDDEN'));
  for (const changed of [{ planRevision: 2 }, { projectId: 'other-project' }, { objectiveId: 'other-objective' }]) {
    await assert.rejects(h.service.acceptQuestionCandidate(actor, { ...scope, ...changed }, candidate, 'x', verify), code('QUESTION_SCOPE_MISMATCH'));
  }
  await assert.rejects(h.service.acceptQuestionCandidate(actor, { ...scope, learningSessionId: 'other-session' }, candidate, 'x', verify), code('LEARNING_SESSION_NOT_FOUND'));
  assert.equal(await h.store.findAwaitingQuestion(actor.id, scope.planId), null);
});

test('stable generation replays without answers, preserves existing pending and rechecks source revocation', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  assert.equal(block.assessmentMode, 'formative');
  assert.deepEqual(block.sourceScope, scope);
  assert.equal(JSON.stringify(block).includes(candidate.explanation), false);
  assert.equal(JSON.stringify(block).includes('correctOption'), false);
  assert.deepEqual(await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify), block);
  assert.deepEqual(await h.service.readPendingQuestionCandidate(actor, scope), block);
  await assert.rejects(h.service.readPendingQuestionCandidate(actor, { ...scope, tutorSessionId: 'other-tutor' }), code('QUESTION_SCOPE_MISMATCH'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, { ...candidate, prompt: 'Changed' }, 'generate', verify), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'second', verify), code('QUESTION_ALREADY_AWAITING'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', async () => []), code('QUESTION_SOURCE_UNVERIFIED'));
  const next = await h.service.getNextStep(actor, scope.planId, scope.learningSessionId);
  assert.equal(next.question?.questionId, block.questionId);
  assert.equal(JSON.stringify(next).includes(candidate.explanation), false);
  assert.equal((await h.store.findAwaitingQuestion(actor.id, scope.planId))?.id, block.questionId);
  assert.equal(h.audit.entries.filter(entry => entry.action === 'learning.question.generated').length, 1);
});

test('concurrent proposals preserve one awaiting question; static pending cannot be overwritten', async () => {
  const h = await harness();
  const results = await Promise.allSettled(['one', 'two'].map(key => h.service.acceptQuestionCandidate(actor, scope, candidate, key, verify)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const other = await harness();
  const staticPending = await other.service.getNextStep(actor, scope.planId, scope.learningSessionId);
  await assert.rejects(other.service.acceptQuestionCandidate(actor, scope, candidate, 'x', verify), code('QUESTION_ALREADY_AWAITING'));
  assert.equal((await other.store.findAwaitingQuestion(actor.id, scope.planId))?.id, staticPending.question?.questionId);
});

test('formative answer discloses full explanation but never writes mastery, events or gate evidence', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  const answer = { questionId: block.questionId, answer: block.options[0]!.key };
  await assert.rejects(h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, { ...answer, answer: 'A' }, 'answer'), code('QUESTION_OPTION_INVALID'));
  const result = await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer');
  assert.equal(result.isCorrect, true);
  assert.equal(result.assessmentMode, 'formative');
  assert.equal(result.explanation, candidate.explanation);
  assert.deepEqual(result.correctOptionIds, [block.options[0]!.key]);
  assert.equal(result.theoryMastered, false);
  assert.equal(result.practiceUnlocked, false);
  assert.equal(await h.store.findMastery(actor.id, scope.objectiveId), null);
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId)).length, 0, 'later mastery recomputation must not consume formative answers');
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length, 1);
  assert.equal(h.outbox.events.length, 0);
  assert.equal(h.audit.entries.some(entry => entry.action.includes('mastery') || entry.action.includes('theory_mastered')), false);
  assert.equal((await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer')).replayed, true);
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length, 1);
  await assert.rejects(h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'different'), code('QUESTION_NOT_AWAITING'));
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify), code('QUESTION_NOT_AWAITING'));
});

test('audit failures roll back question creation and submitted attempt for a safe retry', async () => {
  const h = await harness();
  h.audit.fail = true;
  await assert.rejects(h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify), /audit unavailable/);
  assert.equal(await h.store.findAwaitingQuestion(actor.id, scope.planId), null);
  h.audit.fail = false;
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  h.audit.fail = true;
  const answer = { questionId: block.questionId, answer: block.options[1]!.key };
  await assert.rejects(h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer'), /audit unavailable/);
  assert.equal((await h.store.findPendingQuestion(block.questionId))?.status, 'awaiting');
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length, 0);
  h.audit.fail = false;
  assert.equal((await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer')).isCorrect, false);
});

test('private envelope rejects malformed persisted protocol instead of falling back to reviewed grading', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  const record = (await h.store.findPendingQuestion(block.questionId))!;
  assert.throws(() => dynamicQuestionEnvelope({ ...record, expectedAnswer: 'A' }), code('QUESTION_CANDIDATE_INVALID'));
  assert.throws(() => dynamicQuestionEnvelope({ ...record, expectedAnswer: JSON.stringify({ ...dynamicQuestionEnvelope(record), schemaVersion: 'unknown' }) }), code('QUESTION_CANDIDATE_INVALID'));
});

test('TutorQuiz adapter accepts only emitted scoped generated IDs and delegates exactly once to question owner', async () => {
  const h = await harness();
  const quizStore = new InMemoryTutorQuizStore();
  const quiz = new TutorQuizService(h.store, quizStore, h.idempotency, h.audit as unknown as AuditWriter, h.service);
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  const session = tutorSession(block);
  const body = { selectedKeys: [block.options[0]!.key], idempotencyKey: 'answer' };
  await assert.rejects(quiz.answer(actor, { ...session, turns: [] }, block.questionId, body, 'answer'), code('TUTOR_QUIZ_NOT_EMITTED'));
  await assert.rejects(quiz.answer(actor, { ...session, sessionId: 'other-tutor' }, block.questionId, body, 'answer'), code('TUTOR_QUIZ_NOT_EMITTED'));
  await assert.rejects(quiz.answer(actor, { ...session, projectId: 'other-project' }, block.questionId, body, 'answer'), code('TUTOR_QUIZ_NOT_EMITTED'));
  const result = await quiz.answer(actor, session, block.questionId, body, 'answer');
  assert.equal(result.correct, true);
  assert.equal(result.explanation, candidate.explanation);
  assert.equal(result.assessmentMode, 'formative');
  assert.deepEqual(result.conceptDeltas, []);
  assert.equal(await quizStore.countAttempts(actor.id, block.questionId), 0, 'no second question state or duplicate attempt store');
  assert.equal((await quiz.answer(actor, session, block.questionId, body, 'answer')).replayed, true);
});

test('plan revision changes invalidate outstanding questions and cached answer replay', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  const answer = { questionId: block.questionId, answer: block.options[0]!.key };
  await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer');
  const findBundle = h.store.findBundle.bind(h.store);
  h.store.findBundle = async planId => {
    const bundle = await findBundle(planId);
    return bundle ? { ...bundle, plan: { ...bundle.plan, version: 2 } } : null;
  };
  await assert.rejects(h.service.submitAnswer(actor, scope.planId, scope.learningSessionId, answer, 'answer'), code('QUESTION_SCOPE_MISMATCH'));
  await assert.rejects(h.service.readPendingQuestionCandidate(actor, scope), code('QUESTION_SCOPE_MISMATCH'));
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length, 1);
});

test('refresh restores persisted outcome and selected IDs while pending blocks disclose no model-provided answers', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  assert.equal(await h.service.readQuestionCandidateResult(actor, scope, block.questionId), null);
  const session = tutorSession({ ...block, graded: { correct: true, attempts: 99, hintLevel: 5 }, answer: {
    quizId: block.questionId, correct: true, attempts: 99, hintLevel: 5, explanation: 'Forged solution',
    correctKeys: ['forged'], conceptDeltas: [], replayed: false,
  } });
  const response: GetTutorSessionResponse = { sessionId: session.sessionId, projectId: session.projectId,
    explorationId: null, source: 'project', context: { kind: 'project', label: 'Project', status: 'confirmed', projectId: session.projectId },
    turns: session.turns, lastSeq: session.lastSeq };
  const pendingResponse = await restoreQuestionResults(actor, session, response, h.service);
  const pendingBlock = pendingResponse.turns[0]!.blocks[0]!;
  assert.equal(pendingBlock.kind, 'quiz');
  assert.equal('answer' in pendingBlock, false);
  assert.equal('graded' in pendingBlock, false);
  assert.equal(JSON.stringify(pendingResponse).includes('Forged solution'), false);
  await assert.rejects(restoreQuestionResults({ ...actor, id: 'other' }, session, response, h.service), /无权/);
  await assert.rejects(restoreQuestionResults(actor, session, response, { readQuestionCandidateResult: async () => { throw new Error('owner unavailable'); } }), /owner unavailable/);
  await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId,
    { questionId: block.questionId, answer: block.options[0]!.key }, 'answer');
  const before = (await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length;
  const restored = await restoreQuestionResults(actor, session, response, h.service);
  const answered = restored.turns[0]!.blocks[0]!;
  assert.equal(answered.kind, 'quiz');
  if (answered.kind !== 'quiz') throw new Error('Missing quiz');
  assert.equal(answered.answer?.correct, true);
  assert.equal(answered.answer?.explanation, candidate.explanation);
  assert.deepEqual(answered.answer?.selectedKeys, [block.options[0]!.key]);
  assert.deepEqual(answered.answer?.correctKeys, [block.options[0]!.key]);
  assert.equal((await h.store.listAttempts(actor.id, scope.objectiveId, { includeFormative: true })).length, before);
  await assert.rejects(h.service.readQuestionCandidateResult({ ...actor, id: 'other' }, scope, block.questionId), code('LEARNING_PLAN_FORBIDDEN'));
});

test('historical answered projection remains readable after revision change without authorizing another submission', async () => {
  const h = await harness();
  const block = await h.service.acceptQuestionCandidate(actor, scope, candidate, 'generate', verify);
  await h.service.submitAnswer(actor, scope.planId, scope.learningSessionId,
    { questionId: block.questionId, answer: block.options[1]!.key }, 'answer');
  const findBundle = h.store.findBundle.bind(h.store);
  h.store.findBundle = async planId => {
    const bundle = await findBundle(planId);
    return bundle ? { ...bundle, plan: { ...bundle.plan, version: 2, status: 'completed' } } : null;
  };
  const result = await h.service.readQuestionCandidateResult(actor, scope, block.questionId);
  assert.equal(result?.correct, false);
  assert.equal(result?.explanation, candidate.explanation);
  assert.deepEqual(result?.selectedKeys, [block.options[1]!.key]);
});
