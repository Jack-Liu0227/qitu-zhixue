import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTeamEvents, agentTeamRuns, outbox, tutorGrowthSignals, tutorLearnerProfiles, tutorSessions, tutorTurns } from '@qitu/database';
import { ProjectionDatabaseFixture } from '../growth/growth-projection.test-fixture';
import { PostgresTutorSessionStore } from './tutor-session.store.postgres';
import { TutorSessionConflictError, type AppendTurnsInput, type TutorTurnRecord } from './tutor-session.store';
import { TutorWorkspaceService } from './tutor-workspace.service';

function fixture() {
  const f = new ProjectionDatabaseFixture().seed(tutorSessions, [{ id: 'session', studentId: 'student', projectId: null, lastSeq: 0 }]);
  const makeTurn = (role: 'student' | 'assistant', seq: number): TutorTurnRecord => ({
    turnId: `turn-${role}`, role, seq, blocks: [{ kind: 'text', text: role === 'student' ? 'private synthetic inquiry' : 'private synthetic reply' }],
    modality: 'text', hintLevel: null, stageBefore: null, stageAfter: null, createdAt: '2026-10-21T00:00:00Z',
    pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null,
  });
  const input: AppendTurnsInput = { sessionId: 'session', expectedLastSeq: 0, newLastSeq: 2,
    turns: [makeTurn('student', 1), makeTurn('assistant', 2)], projectionEvent: { sourceAgentId: 'leader', runId: null } };
  return { f, input, store: new PostgresTutorSessionStore(f.db) };
}

test('append atomically records one owned conversation event with bounded IDs and a durable outbox receipt', async () => {
  const { f, store, input } = fixture();
  await store.appendTurns(input);
  assert.equal(f.rows(tutorSessions)[0]!.lastSeq, 2);
  assert.equal(f.rows(tutorTurns).length, 2);
  assert.equal(f.rows(agentTeamEvents).length, 1);
  assert.equal(f.rows(outbox).length, 1);
  const event = f.rows(agentTeamEvents)[0]!;
  assert.equal(event.topic, 'tutor.turn.completed');
  assert.equal(event.runId, null);
  assert.deepEqual(event.payload, { studentUserId: 'student', projectId: null, sessionId: 'session', sourceAgentId: 'leader',
    studentTurnId: 'turn-student', assistantTurnId: 'turn-assistant', studentSeq: 1, assistantSeq: 2, evidenceRef: 'learning_interaction:turn-student' });
  assert.equal(JSON.stringify([event, ...f.rows(outbox)]).includes('private synthetic'), false);
  await assert.rejects(store.appendTurns(input), TutorSessionConflictError);
  assert.equal(f.rows(agentTeamEvents).length, 1);
  assert.equal(f.rows(outbox).length, 1);
});

test('failed event delivery persistence rolls back both turn contents and sequence claim', async () => {
  const { f, store, input } = fixture();
  f.failInsertTable = outbox;
  await assert.rejects(store.appendTurns(input), /FIXTURE_INSERT_FAILURE/);
  assert.equal(f.rows(tutorSessions)[0]!.lastSeq, 0);
  assert.equal(f.rows(tutorTurns).length, 0);
  assert.equal(f.rows(agentTeamEvents).length, 0);
});

test('a foreign run cannot attach a learning event to another student conversation', async () => {
  const { f, store, input } = fixture();
  f.seed(agentTeamRuns, [{ id: 'foreign-run', studentUserId: 'other-student', projectId: null }]);
  input.projectionEvent!.runId = 'foreign-run';
  await assert.rejects(store.appendTurns(input), /PROJECTION_OWNER_INVALID/);
  assert.equal(f.rows(tutorSessions)[0]!.lastSeq, 0);
  assert.equal(f.rows(tutorTurns).length, 0);
});

test('generic dialogue activity is idempotent and never becomes a personal question', async () => {
  const f = new ProjectionDatabaseFixture().seed(tutorLearnerProfiles, [{ studentId: 'student', version: 7, nextQuestions: ['a reviewed question'] }]);
  const workspace = new TutorWorkspaceService(f.db);
  const signal = { studentId: 'student', projectId: null, kind: 'question_asked' as const, summary: '学生完成一次对话',
    evidenceRef: null, occurredAt: '2026-10-21T00:00:00Z', idempotencyKey: 'activity-1' };
  await workspace.commitGrowthSignal(signal);
  await workspace.commitGrowthSignal(signal);
  assert.equal(f.rows(tutorGrowthSignals).length, 1);
  assert.deepEqual(f.rows(tutorLearnerProfiles), [{ studentId: 'student', version: 7, nextQuestions: ['a reviewed question'] }]);
});
