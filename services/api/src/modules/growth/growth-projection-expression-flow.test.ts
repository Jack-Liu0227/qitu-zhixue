import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expressionQuestion, expressionSummary } from '@qitu/contracts';
import { adminAssistants, agentConfigs, agentProjectionCandidates, agentRoutes, agentTeamEvents, agentTeamRuns, agentTeamTasks,
  outbox, readTutorProjectionEvidence, tutorSessions, tutorTurns } from '@qitu/database';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { DirectoryService } from '../directory/directory.service';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';
import { GrowthProjectionReviewWorker } from './growth-projection-review.worker';
import { GrowthService } from './growth.service';
import { ProjectionDatabaseFixture } from './growth-projection.test-fixture';

const rawText = '我喜欢光学，我希望先看模拟。光学中缝宽变化有什么影响？';
const time = new Date('2026-10-21T00:00:00Z');
async function fixture(type: 'learner_profile' | 'growth_trajectory' = 'learner_profile', derivedRun = false) {
  const agentId = type === 'learner_profile' ? 'profile' : 'growth';
  const taskType = type === 'learner_profile' ? 'profile.project' : 'growth.project';
  const f = new ProjectionDatabaseFixture()
    .seed(adminAssistants, [{ id: agentId, enabled: true }]).seed(agentConfigs, [{ id: agentId, enabled: true }, { id: 'leader', enabled: true }])
    .seed(tutorSessions, [{ id: 'session', studentId: 'student', projectId: null, archivedAt: null }])
    .seed(tutorTurns, [
      { id: 'turn-student', studentId: 'student', sessionId: 'session', role: 'student', seq: 1, blocks: [{ kind: 'text', text: rawText }], createdAt: time },
      { id: 'turn-assistant', studentId: 'student', sessionId: 'session', role: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'model answer is not student evidence' }], createdAt: time },
    ]).seed(agentTeamEvents, [{ id: 'event', topic: 'tutor.turn.completed', runId: derivedRun ? null : 'run',
      payload: { studentUserId: 'student', projectId: null, sessionId: 'session', sourceAgentId: 'leader',
        studentTurnId: 'turn-student', assistantTurnId: 'turn-assistant', studentSeq: 1, assistantSeq: 2, evidenceRef: 'learning_interaction:turn-student' } }])
    .seed(agentTeamRuns, [{ id: 'run', leaderAgentId: 'leader', studentUserId: 'student', projectId: null, trigger: 'event:tutor.turn.completed', context: { sourceEventId: 'event' } }])
    .seed(agentRoutes, [{ id: 'route', fromAgentId: 'leader', toAgentId: agentId, taskType, trigger: 'event', enabled: true }])
    .seed(agentTeamTasks, [{ id: 'task', runId: 'run', agentId, taskType, status: 'succeeded', input: {
      sourceEventId: 'event', sourceTopic: 'tutor.turn.completed', projectionType: type, studentUserId: 'student', projectId: null,
      authorization: { routeId: 'route', fromAgentId: 'leader', toAgentId: agentId, taskType, trigger: 'event' },
    } }]);
  const evidence = await readTutorProjectionEvidence(f.db, { sourceEventId: 'event', runId: 'run', studentId: 'student', projectId: null, projectionType: type });
  const result: Record<string, unknown> = type === 'learner_profile'
    ? { version: 1, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null, interests: ['光学'], preferences: ['先看模拟'], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')] }
    : { version: 1, milestones: [], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')], studentSummary: expressionSummary('缝宽变化'), confidence: 'low', evidenceRefs: [evidence.evidenceRef] };
  const candidate = { id: 'candidate', runId: 'run', taskId: 'task', agentId, projectionType: type, studentUserId: 'student', projectId: null,
    status: 'proposed', reviewErrorCode: null, reviewedBy: null, reviewedAt: null, createdAt: time,
    payload: { contractVersion: 'qitu.growth-projection.v1', sourceEventId: 'event', sourceTopic: 'tutor.turn.completed', studentUserId: 'student', projectId: null,
      evidenceRefs: [evidence.evidenceRef], result, analysisManifest: evidence.manifest } };
  f.seed(agentProjectionCandidates, [candidate]);
  const audits: Record<string, unknown>[] = [];
  const owner = new GrowthProjectionOwnerService(f.db, { write: async (entry: Record<string, unknown>) => { audits.push(entry); } } as unknown as AuditWriter);
  const view = new GrowthService({} as DirectoryService, undefined, 'test', undefined, f.db);
  return { f, owner, candidate, audits, view };
}

test('private real turn -> owner accepted profile -> public coverage, with no raw conversation', async () => {
  const { owner, candidate, view, audits } = await fixture();
  assert.deepEqual((await view.getStudentProfile('student')).interests, []);
  assert.equal((await view.getStudentProfile('student')).analysis.status, 'pending');
  assert.equal((await owner.processReady('candidate')).status, 'accepted');
  const profile = await view.getStudentProfile('student');
  assert.deepEqual(profile.interests, ['光学']);
  assert.deepEqual(profile.preferences, ['先看模拟']);
  assert.deepEqual(profile.strengths, []);
  assert.equal(profile.analysis.observedThrough, time.toISOString());
  assert.equal(profile.analysis.policyVersion, 'tutor-expression.v1');
  assert.equal(profile.analysis.status, 'accepted');
  assert.equal(JSON.stringify(profile).includes(rawText), false);
  assert.equal(JSON.stringify(candidate.payload).includes(rawText), false);
  assert.equal(audits[0]?.actorRole, undefined);
  assert.equal((await owner.processReady('candidate')).status, 'accepted');
  assert.equal(audits.length, 1);
});

test('derived exploration run has verifiable event provenance and accepted trajectory shares the profile source', async () => {
  const { owner, view } = await fixture('growth_trajectory', true);
  assert.equal((await owner.processReady('candidate')).status, 'accepted');
  const profile = await view.getStudentProfile('student');
  const analysis = await view.getGrowthAnalysis('student');
  assert.deepEqual(analysis.trajectory, profile.trajectory);
  assert.equal(analysis.analysis.status, 'accepted');
  assert.equal(analysis.trajectory?.studentSummary, expressionSummary('缝宽变化'));
  assert.deepEqual(analysis.trajectory?.milestones, []);
});

test('owner rechecks object ownership, current grants, task identity, source hash and authority fields', async () => {
  const cases: Array<[string, (value: Awaited<ReturnType<typeof fixture>>) => void]> = [
    ['PROJECTION_OWNER_INVALID', ({ f }) => { f.rows(tutorSessions)[0]!.studentId = 'other-student'; }],
    ['PROJECTION_OWNER_INVALID', ({ f }) => { f.rows(agentTeamRuns)[0]!.studentUserId = 'other-student'; }],
    ['PROJECTION_SOURCE_INVALID', ({ f }) => { f.rows(tutorTurns)[0]!.studentId = 'other-student'; }],
    ['PROJECTION_MANIFEST_STALE', ({ f }) => { f.rows(tutorTurns)[0]!.blocks = [{ kind: 'text', text: `${rawText} new statement` }]; }],
    ['PROJECTION_ROUTE_REVOKED', ({ f }) => { f.rows(agentRoutes)[0]!.enabled = false; }],
    ['PROJECTION_ROUTE_REVOKED', ({ f }) => { f.rows(agentRoutes)[0]!.trigger = 'delegate'; }],
    ['PROJECTION_PURPOSE_CHANGED', ({ f }) => { f.config.growthProjection = { profileAssistantId: null, growthAssistantId: null }; }],
    ['PROJECTION_ASSISTANT_UNAVAILABLE', ({ f }) => { f.rows(adminAssistants)[0]!.enabled = false; }],
    ['PROJECTION_SOURCE_AGENT_UNAVAILABLE', ({ f }) => { f.rows(agentConfigs)[1]!.enabled = false; }],
    ['PROJECTION_TASK_INVALID', ({ f }) => { f.rows(agentTeamRuns)[0]!.leaderAgentId = 'different-leader'; }],
    ['PROJECTION_TASK_INVALID', ({ f }) => { f.rows(agentTeamTasks)[0]!.status = 'running'; }],
    ['PROJECTION_TASK_INVALID', ({ f }) => { (f.rows(agentTeamTasks)[0]!.input as Record<string, unknown>).studentUserId = 'other-student'; }],
    ['PROJECTION_AUTHORITY_CLAIM_FORBIDDEN', ({ candidate }) => { candidate.payload.result.strengths = ['已掌握光学']; }],
  ];
  for (const [expected, mutate] of cases) {
    const value = await fixture(); mutate(value);
    const result = await value.owner.processReady('candidate');
    assert.equal(result.status, 'proposed', expected);
    assert.equal(result.errorCode, expected);
    assert.deepEqual((await value.view.getStudentProfile('student')).interests, []);
  }
});

test('stale base version and forged derived-run provenance remain proposed', async () => {
  const value = await fixture();
  value.f.rows(agentProjectionCandidates).push({ ...value.candidate, id: 'prior', status: 'accepted', createdAt: new Date(time.getTime() - 1000),
    payload: { result: { ...value.candidate.payload.result }, analysisManifest: { observedThrough: '2026-10-20T00:00:00Z' } } });
  assert.equal((await value.owner.processReady('candidate')).errorCode, 'PROJECTION_MANIFEST_STALE');
  const derived = await fixture('growth_trajectory', true);
  derived.f.rows(agentTeamRuns)[0]!.context = { sourceEventId: 'another-event' };
  assert.equal((await derived.owner.processReady('candidate')).errorCode, 'PROJECTION_SOURCE_INVALID');
});

test('a later real turn advances a pure Tutor trajectory without replacing newer evidence with an old result', async () => {
  const { f, owner, candidate, view } = await fixture('growth_trajectory');
  assert.equal((await owner.processReady(candidate.id)).status, 'accepted');
  const later = new Date(time.getTime() + 1000);
  f.rows(tutorTurns).push(
    { id: 'student-next', studentId: 'student', sessionId: 'session', role: 'student', seq: 3, blocks: [{ kind: 'text', text: '我想了解衍射条纹。' }], createdAt: later },
    { id: 'assistant-next', studentId: 'student', sessionId: 'session', role: 'assistant', seq: 4, blocks: [], createdAt: later },
  );
  const event = f.rows(agentTeamEvents)[0]!;
  f.rows(agentTeamEvents).push({ ...event, id: 'event-next', payload: { ...(event.payload as Record<string, unknown>),
    studentTurnId: 'student-next', assistantTurnId: 'assistant-next', studentSeq: 3, assistantSeq: 4, evidenceRef: 'learning_interaction:student-next' } });
  const task = f.rows(agentTeamTasks)[0]!;
  f.rows(agentTeamTasks).push({ ...task, id: 'task-next', input: { ...(task.input as Record<string, unknown>), sourceEventId: 'event-next' } });
  const evidence = await readTutorProjectionEvidence(f.db, { sourceEventId: 'event-next', runId: 'run', studentId: 'student', projectId: null, projectionType: 'growth_trajectory' });
  const next = { ...candidate, id: 'candidate-next', taskId: 'task-next', status: 'proposed', reviewedBy: null, reviewedAt: null, createdAt: later,
    payload: { ...candidate.payload, sourceEventId: 'event-next', evidenceRefs: [evidence.evidenceRef], analysisManifest: evidence.manifest,
      result: { ...candidate.payload.result, version: 2, nextQuestions: [], studentSummary: expressionSummary('衍射条纹'), evidenceRefs: [evidence.evidenceRef] } } };
  f.rows(agentProjectionCandidates).push(next);
  const accepted = await owner.processReady(next.id);
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(accepted.supersededCandidateIds, ['candidate']);
  assert.equal(candidate.status, 'superseded');
  const publicView = await view.getGrowthAnalysis('student');
  assert.equal(publicView.trajectory?.version, 2);
  assert.equal(publicView.analysis.sourceEventId, 'event-next');
  assert.equal(publicView.analysis.observedThrough, later.toISOString());
  assert.equal((await owner.processReady('candidate')).status, 'superseded');
  assert.equal((await view.getGrowthAnalysis('student')).trajectory?.version, 2);
});

test('durable ready consumer handles accepted/deferred events without bypassing owner or reapplying', async () => {
  const { f, owner, candidate } = await fixture();
  f.seed(outbox, [{ id: 'ready', topic: 'growth.projection.ready', payload: { candidateId: 'candidate' }, status: 'pending', attempts: 0, createdAt: time }]);
  const consumer = new GrowthProjectionReviewWorker(f.db, owner);
  assert.equal(await consumer.tick(), 'published');
  assert.equal(candidate.status, 'accepted');
  assert.equal(f.rows(outbox)[0]!.status, 'published');
  assert.equal(await consumer.tick(), 'idle');
  const deferred = await fixture();
  deferred.candidate.payload.result.strengths = ['invented ability'];
  deferred.f.seed(outbox, [{ id: 'ready', topic: 'growth.projection.ready', payload: { candidateId: 'candidate' }, status: 'pending', attempts: 0, createdAt: time }]);
  assert.equal(await new GrowthProjectionReviewWorker(deferred.f.db, deferred.owner).tick(), 'published');
  assert.equal(deferred.candidate.status, 'proposed');
  assert.equal(deferred.f.rows(outbox)[0]!.lastError, 'PROJECTION_AUTHORITY_CLAIM_FORBIDDEN');
  assert.equal((await deferred.owner.processReady('candidate')).status, 'proposed');
  assert.equal(deferred.audits.length, 1, 'replaying a deferred receipt must not violate audit idempotency');
});
