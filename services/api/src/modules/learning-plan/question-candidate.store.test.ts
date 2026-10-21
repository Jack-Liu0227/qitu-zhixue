import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masteryAttempts, masteryEvents, masteryRecords, pendingQuestions, type Database } from '@qitu/database';
import { PostgresLearningPlanStore } from './learning-plan.store.postgres';
import type { AttemptRecord, PendingQuestionRecord } from './learning-plan.store';

const now = new Date();
const attempt: AttemptRecord = { id: 'attempt-fixture', studentUserId: 'student-fixture', planId: 'plan-fixture',
  objectiveId: 'objective-fixture', questionId: 'question-fixture', result: 'correct', isCorrect: true,
  assessmentType: 'formative', errorType: null, hintsUsed: 0, attemptCount: 1, qualityBasisPoints: 10000,
  userAnswer: 'option-fixture', createdAt: now };
const pending: PendingQuestionRecord = { id: 'question-fixture', schoolId: null, studentUserId: 'student-fixture',
  planId: 'plan-fixture', sessionId: 'lesson-fixture', objectiveId: 'objective-fixture', questionType: 'choice',
  prompt: 'Fixture?', options: [{ id: 'option-fixture', label: 'A', body: 'Fixture answer' }], expectedAnswer: '{}',
  explanation: 'Private fixture explanation', difficulty: 'easy', assessmentType: 'formative', status: 'awaiting',
  attempt: 1, hintsUsed: 0, idempotencyKey: 'fixture-key', askedAt: now, answeredAt: null, createdAt: now, updatedAt: now };

// SQL adapter probe, not a live PostgreSQL constraint/rollback integration test.
function transactionProbe() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  let claimed = true;
  const tx = {
    insert: (table: unknown) => ({ values: async (_value: unknown) => {
      assert.notEqual(table, masteryRecords, 'formative completion must not write a mastery projection');
      assert.notEqual(table, masteryEvents, 'formative completion must not write a mastery event');
      inserted.push(table);
    } }),
    update: (table: unknown) => ({ set: (_value: unknown) => ({ where: (_condition: unknown) => ({ returning: async () => {
      updated.push(table);
      if (!claimed) return [];
      claimed = false;
      return [{ id: pending.id }];
    } }) }) }),
  };
  return { tx, inserted, updated, store: new PostgresLearningPlanStore(tx as unknown as Database, true) };
}

test('Postgres formative completion claims pending, appends one attempt and shares audit transaction without mastery SQL', async () => {
  const h = transactionProbe();
  let commits = 0;
  const input = { questionId: pending.id, answeredAt: now, attempt, mastery: null, masteryEvent: null,
    commit: async (tx?: unknown) => { assert.equal(tx, h.tx); commits += 1; } };
  assert.equal(await h.store.completePendingQuestion(input), true);
  assert.equal(await h.store.completePendingQuestion(input), false);
  assert.deepEqual(h.inserted, [masteryAttempts]);
  assert.deepEqual(h.updated, [pendingQuestions, pendingQuestions]);
  assert.equal(commits, 1);
});

test('Postgres generated question creation shares its transaction with the audit callback', async () => {
  const h = transactionProbe();
  let committed = false;
  await h.store.createPendingQuestion(pending, async tx => { assert.equal(tx, h.tx); committed = true; });
  assert.equal(committed, true);
  assert.deepEqual(h.inserted, [pendingQuestions]);
});

test('both pending completion and reviewed assessment reject formative attempts carrying mastery writes', async () => {
  const h = transactionProbe();
  const input = { attempt, mastery: {} as never, masteryEvent: null };
  await assert.rejects(h.store.completeAssessment(input), /FORMATIVE_MASTERY_WRITE_FORBIDDEN/);
  await assert.rejects(h.store.completePendingQuestion({ ...input, questionId: pending.id, answeredAt: now }), /FORMATIVE_MASTERY_WRITE_FORBIDDEN/);
  assert.equal(h.inserted.length, 0);
  assert.equal(h.updated.length, 0);
});
