import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expressionQuestion, expressionSummary, type GrowthProjectionType } from '@qitu/contracts';
import { adminAssistants, agentConfigs, agentProjectionCandidates, agentRoutes, agentTeamEvents, agentTeamRuns,
  agentTeamTasks, growthRecords, outbox, readTutorProjectionEvidence, tutorSessions, tutorTurns } from '@qitu/database';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { DirectoryService } from '../directory/directory.service';
import { PostgresTutorSessionStore } from '../ai-tutor/tutor-session.store.postgres';
import type { TutorTurnRecord } from '../ai-tutor/tutor-session.store';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';
import { GrowthService } from './growth.service';
import { ProjectionDatabaseFixture } from './growth-projection.test-fixture';

const raw = '我喜欢光学。我希望先看模拟。衍射中缝宽变化有什么影响？';
const time = new Date('2026-10-22T00:00:00Z');
async function fixture() {
  const f = new ProjectionDatabaseFixture()
    .seed(adminAssistants, [{ id: 'profile', enabled: true }, { id: 'growth', enabled: true }])
    .seed(agentConfigs, [{ id: 'profile', enabled: true }, { id: 'growth', enabled: true }, { id: 'leader', enabled: true }])
    .seed(tutorSessions, [{ id: 'lifecycle-chat', studentId: 'student', projectId: null, lastSeq: 0, archivedAt: null }]);
  const turn = (role: 'student' | 'assistant', seq: number): TutorTurnRecord => ({
    turnId: `lifecycle-${role}`, role, seq, blocks: [{ kind: 'text', text: role === 'student' ? raw : 'A generated board is not learner mastery.' }],
    modality: 'text', hintLevel: null, stageBefore: null, stageAfter: null, createdAt: time.toISOString(),
    pedagogicMove: null, expectedEvidence: null, promptVersion: null, evidenceRef: null,
  });
  await new PostgresTutorSessionStore(f.db).appendTurns({ sessionId: 'lifecycle-chat', expectedLastSeq: 0, newLastSeq: 2,
    turns: [turn('student', 1), turn('assistant', 2)], projectionEvent: { sourceAgentId: 'leader', runId: null } });
  const event = f.rows(agentTeamEvents)[0]!;
  f.seed(agentTeamRuns, [{ id: 'lifecycle-run', leaderAgentId: 'leader', studentUserId: 'student', projectId: null,
    trigger: 'event:tutor.turn.completed', context: { sourceEventId: event.id } }]);
  f.seed(agentRoutes, ['profile', 'growth'].map(id => ({ id: `route-${id}`, fromAgentId: 'leader', toAgentId: id,
    taskType: id === 'profile' ? 'profile.project' : 'growth.project', trigger: 'event', enabled: true })));
  const audits: Record<string, unknown>[] = [];
  const owner = new GrowthProjectionOwnerService(f.db, { write: async (entry: Record<string, unknown>) => { audits.push(entry); } } as unknown as AuditWriter);
  const view = new GrowthService({} as DirectoryService, undefined, 'test', undefined, f.db);
  return { f, event, owner, view, audits };
}

async function propose(h: Awaited<ReturnType<typeof fixture>>, projectionType: GrowthProjectionType, unsafe = false) {
  const id = projectionType === 'learner_profile' ? 'profile' : 'growth';
  const skillId = id === 'profile' ? 'qitu-learner-profile' : 'qitu-growth-trajectory';
  assert.ok(loadTutorRuntimeSource().skills.some(skill => skill.id === skillId && skill.status === 'ready' && !skill.requiredToolIds?.length));
  const taskType = id === 'profile' ? 'profile.project' : 'growth.project';
  const tasks = [...h.f.rows(agentTeamTasks), { id: `task-${id}`, runId: 'lifecycle-run', agentId: id, taskType, status: 'succeeded', input: {
    sourceEventId: h.event.id, sourceTopic: 'tutor.turn.completed', projectionType, studentUserId: 'student', projectId: null,
    authorization: { routeId: `route-${id}`, fromAgentId: 'leader', toAgentId: id, taskType, trigger: 'event' },
  } }];
  h.f.seed(agentTeamTasks, tasks);
  const evidence = await readTutorProjectionEvidence(h.f.db, { sourceEventId: String(h.event.id), runId: 'lifecycle-run', studentId: 'student', projectId: null, projectionType });
  const result = id === 'profile'
    ? { version: 1, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null,
      interests: ['光学'], preferences: ['先看模拟'], strengths: unsafe ? ['已经掌握光学'] : [], nextQuestions: [expressionQuestion('缝宽变化')] }
    : { version: 1, milestones: [], strengths: [], nextQuestions: [expressionQuestion('缝宽变化')],
      studentSummary: expressionSummary('缝宽变化'), confidence: 'low', evidenceRefs: [evidence.evidenceRef] };
  h.f.seed(agentProjectionCandidates, [...h.f.rows(agentProjectionCandidates), { id: `candidate-${id}`, runId: 'lifecycle-run', taskId: `task-${id}`, agentId: id,
    projectionType, studentUserId: 'student', projectId: null, status: 'proposed', reviewErrorCode: null, reviewedBy: null, reviewedAt: null, createdAt: time,
    payload: { contractVersion: 'qitu.growth-projection.v1', sourceEventId: h.event.id, sourceTopic: 'tutor.turn.completed', studentUserId: 'student', projectId: null,
      evidenceRefs: [evidence.evidenceRef], result, analysisManifest: evidence.manifest } }]);
  return `candidate-${id}`;
}

test('owned Tutor interaction feeds separate profile/growth candidates and only accepted projections appear', async () => {
  const h = await fixture();
  assert.equal(h.f.rows(outbox).length, 1);
  assert.equal(JSON.stringify(h.event).includes(raw), false);
  const profile = await propose(h, 'learner_profile');
  const trajectory = await propose(h, 'growth_trajectory');
  assert.deepEqual((await h.view.getStudentProfile('student')).interests, []);
  assert.equal((await h.owner.processReady(profile)).status, 'accepted');
  assert.equal((await h.owner.processReady(trajectory)).status, 'accepted');
  const view = await h.view.getStudentProfile('student');
  assert.deepEqual(view.interests, ['光学']);
  assert.deepEqual(view.strengths, []);
  assert.deepEqual(view.trajectory?.milestones, []);
  assert.equal(view.analysis.status, 'accepted');
  assert.equal(view.growthAnalysis.status, 'accepted');
  assert.equal(JSON.stringify(view).includes(raw), false);
  assert.equal(h.f.rows(growthRecords).length, 0);
  const audits = h.audits.length;
  await h.owner.processReady(profile); await h.owner.processReady(trajectory);
  assert.equal(h.audits.length, audits);
});

test('new skills cannot turn an expression into mastery or bypass a revoked projection route', async () => {
  const unsafe = await fixture();
  const candidate = await propose(unsafe, 'learner_profile', true);
  assert.equal((await unsafe.owner.processReady(candidate)).status, 'proposed');
  assert.deepEqual((await unsafe.view.getStudentProfile('student')).interests, []);
  const revoked = await fixture();
  const next = await propose(revoked, 'growth_trajectory');
  revoked.f.rows(agentRoutes).find(route => route.toAgentId === 'growth')!.enabled = false;
  assert.equal((await revoked.owner.processReady(next)).errorCode, 'PROJECTION_ROUTE_REVOKED');
  assert.equal((await revoked.view.getStudentProfile('student')).trajectory, null);
  assert.equal(revoked.f.rows(tutorTurns).length, 2);
});
