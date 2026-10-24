import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DOMAIN_OBSERVATION_POLICY, expectedDomainProjection, validateDomainProjection,
  type GrowthDomainKind, type GrowthProjectionType,
} from '@qitu/contracts';
import {
  adminAssistants, agentConfigs, agentProjectionCandidates, agentRoutes,
  agentTeamEvents, agentTeamRuns, agentTeamTasks, artifacts, artifactVersions, auditLogs, growthRecords,
  learningObjectives, learningPlans, learningSessions, masteryEvents, masteryRecords, mentorAssignments,
  mentorReviews, outbox, pblTemplateTeamBindings, projectBindingSnapshots, projectEvidence, projects,
  readDomainProjectionEvidence, readGrowthDomainObservation,
} from '@qitu/database';
import { AuditService } from '../../common/audit/audit.service';
import type { DirectoryService } from '../directory/directory.service';
import { GrowthDomainEvidenceWorker } from './growth-domain-evidence.worker';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';
import { GrowthService } from './growth.service';
import { PostgresGrowthRecordStore } from './growth.persistence.postgres';
import { ProjectionDatabaseFixture } from './growth-projection.test-fixture';

const time = new Date('2026-10-21T00:00:00Z');
const privateReflection = 'Private disposable reflection: I compared evidence and revised the model.';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sources: Array<{ kind: GrowthDomainKind; sourceId: string }> = [
  { kind: 'project_transition', sourceId: 'transition' }, { kind: 'published_artifact', sourceId: 'artifact' },
  { kind: 'reflection', sourceId: 'reflection-evidence' }, { kind: 'mastered_objective', sourceId: 'mastery' },
];

function fixture() {
  const f = new ProjectionDatabaseFixture()
    .seed(agentTeamRuns, []).seed(agentRoutes, []).seed(agentTeamTasks, []).seed(agentProjectionCandidates, [])
    .seed(projects, [{ id: 'project', studentUserId: 'student', templateVersionId: 'template', title: 'Optics', status: 'completed' }])
    .seed(projectBindingSnapshots, [{ projectId: 'project', templateVersionId: 'template', bindingId: 'binding', teamVersionId: 'team', bindingHash: 'frozen-hash', bundleDigest: null, backfilled: false }])
    .seed(pblTemplateTeamBindings, [{ id: 'binding', templateVersionId: 'template', teamVersionId: 'team', bindingHash: 'frozen-hash', bundleDigest: null, teamSnapshots: { team: { id: 'team', leaderAssistantId: 'leader', enabled: true } } }])

    .seed(agentConfigs, [{ id: 'leader', enabled: true }, { id: 'profile', enabled: true }, { id: 'growth', enabled: true }])
    .seed(adminAssistants, [{ id: 'profile', enabled: true }, { id: 'growth', enabled: true }])
    .seed(learningPlans, [{ id: 'plan', studentUserId: 'student', projectId: 'project', templateVersionId: 'template', version: 1 }])
    .seed(learningSessions, [{ id: 'session', planId: 'plan' }])
    .seed(learningObjectives, [{ id: 'objective', planId: 'plan', name: 'Evidence-based optics', type: 'concept' }])
    .seed(outbox, [{ id: 'transition', topic: 'project.completed', payload: { studentId: 'student', projectId: 'project', from: 'published', to: 'completed' }, status: 'published', createdAt: time }])
    .seed(artifacts, [
      { id: 'artifact', studentUserId: 'student', projectId: 'project', templateVersionId: 'template', status: 'published', publishedAt: new Date(time.getTime() + 1000), currentVersionIndex: 1, schoolId: null },
      { id: 'reflection-artifact', studentUserId: 'student', projectId: 'project', templateVersionId: 'template', status: 'draft', currentVersionIndex: 1 },
    ])
    .seed(artifactVersions, [
      { id: 'published-version', artifactId: 'artifact', ordinal: 1, note: '' },
      { id: 'reflection-version', artifactId: 'reflection-artifact', ordinal: 1, note: `qitu:inline-text:v1:${JSON.stringify({ note: '', text: privateReflection })}` },
    ])
    .seed(mentorAssignments, [{ id: 'assignment', studentUserId: 'student', mentorUserId: 'mentor', status: 'active' }])
    .seed(mentorReviews, [{ id: 'review', artifactRef: 'artifact', studentUserId: 'student', mentorUserId: 'mentor', projectId: 'project', status: 'approved', reviewedAt: time }])
    .seed(projectEvidence, [
      { id: 'review-evidence', projectId: 'project', studentUserId: 'student', artifactId: 'artifact', sourceKind: 'task_submission', sourceId: 'review:review',
        detail: JSON.stringify({ schema: 'qitu.artifact-review-request.v1', reviewId: 'review', artifactVersionId: 'published-version', versionOrdinal: 1 }) },
      { id: 'reflection-evidence', projectId: 'project', studentUserId: 'student', artifactId: 'reflection-artifact', sourceKind: 'reflection', columnKind: 'independent', occurredAt: new Date(time.getTime() + 2000),
        detail: JSON.stringify({ schema: 'qitu.learning-submission.v1', kind: 'session_response',
          scope: { projectId: 'project', planId: 'plan', planRevision: 1, learningSessionId: 'session', objectiveIds: ['objective'] },
          artifactId: 'reflection-artifact', artifactVersionId: 'reflection-version', contentDigest: digest(privateReflection), evidenceRefs: [] }) },
    ])
    .seed(masteryEvents, [{ id: 'mastery', studentUserId: 'student', projectId: 'project', planId: 'plan', objectiveId: 'objective', knowledgePointId: 'optics', courseVersion: 'v1',
      eventType: 'assessed', knowledgeType: 'concept', qualitativeMastered: true, scoreBasisPoints: null, validFrom: time, recordedAt: new Date(time.getTime() + 3000) }])
    .seed(masteryRecords, [{ id: 'current', studentUserId: 'student', planId: 'plan', objectiveId: 'objective', knowledgePointId: 'optics', courseVersion: 'v1',
      sourceEventId: 'mastery', status: 'mastered', qualitativeMastered: true, masteryBasisPoints: 0, thresholdBasisPoints: 9000 }]);
  const growth = new GrowthService({} as DirectoryService, new PostgresGrowthRecordStore(f.db), 'test', undefined, f.db);
  const audit = new AuditService(f.db);
  const owner = new GrowthProjectionOwnerService(f.db, audit);
  return { f, growth, owner, worker: new GrowthDomainEvidenceWorker(f.db, growth, audit) };
}

async function candidate(value: ReturnType<typeof fixture>, type: GrowthProjectionType, eventId: string, id = `${type}-candidate`) {
  const { f } = value;
  const event = f.rows(agentTeamEvents).find((row) => row.id === eventId)!;
  const taskType = type === 'learner_profile' ? 'profile.project' : 'growth.project';
  const agentId = type === 'learner_profile' ? 'profile' : 'growth';
  const runId = `${id}-run`, taskId = `${id}-task`, routeId = `${id}-route`;
  f.rows(agentTeamRuns).push({ id: runId, studentUserId: 'student', projectId: 'project', leaderAgentId: 'leader', trigger: `event:${event.topic}`, context: { sourceEventId: eventId } });
  f.tables.set(agentTeamRuns, f.rows(agentTeamRuns));
  f.rows(agentRoutes).push({ id: routeId, fromAgentId: 'leader', toAgentId: agentId, taskType, trigger: 'event', enabled: true });
  f.tables.set(agentRoutes, f.rows(agentRoutes));
  const authorization = { routeId, fromAgentId: 'leader', toAgentId: agentId, taskType, trigger: 'event' };
  f.rows(agentTeamTasks).push({ id: taskId, runId, agentId, taskType, status: 'succeeded',
    input: { authorization, sourceEventId: eventId, sourceTopic: event.topic, projectionType: type, studentUserId: 'student', projectId: 'project' } });
  f.tables.set(agentTeamTasks, f.rows(agentTeamTasks));
  const evidence = await readDomainProjectionEvidence(f.db, { sourceEventId: eventId, runId, studentId: 'student', projectId: 'project', projectionType: type });
  const result = expectedDomainProjection(type, evidence);
  const row = { id, runId, taskId, agentId, projectionType: type, studentUserId: 'student', projectId: 'project', status: 'proposed', reviewedBy: null, reviewedAt: null, reviewErrorCode: null,
    createdAt: new Date(time.getTime() + f.rows(agentProjectionCandidates).length + 10_000),
    payload: { contractVersion: 'qitu.growth-projection.v1', sourceEventId: eventId, sourceTopic: event.topic,
      studentUserId: 'student', projectId: 'project', evidenceRefs: evidence.observation.evidenceRefs, result, analysisManifest: evidence.manifest } };
  const rows = f.rows(agentProjectionCandidates); rows.push(row); f.tables.set(agentProjectionCandidates, rows);
  return { row, evidence };
}

test('all four owner stores produce factual private timelines and two owner-reviewed views without raw content', async () => {
  const value = fixture();
  const { f, growth, owner, worker } = value;
  for (const source of sources) assert.equal((await readGrowthDomainObservation(f.db, source)).kind, source.kind);
  assert.deepEqual(await worker.tick(), { checked: 4, emitted: 4, deferred: 0 });
  assert.equal(f.rows(growthRecords).length, 4);
  assert.equal(f.rows(auditLogs).filter((row) => row.action === 'growth.domain.observed').length, 4);
  assert.equal(JSON.stringify(f.rows(auditLogs)).includes(privateReflection), false);
  assert.deepEqual(growth.getSummary('student'), { streakDays: 1, projectsCompleted: 1, objectivesMastered: 1, artifactsPublished: 1 });
  assert.equal(growth.getTimeline('student', { type: 'all', projectId: null, from: null, to: null, cursor: null, limit: 20 }).items.length, 4);
  for (const event of f.rows(agentTeamEvents)) {
    for (const type of ['learner_profile', 'growth_trajectory'] as const) {
      const next = await candidate(value, type, String(event.id), `${type}-${event.id}`);
      assert.equal((await owner.processReady(next.row.id)).status, 'accepted');
    }
  }
  const view = await growth.getStudentProfile('student');
  const analysis = await growth.getGrowthAnalysis('student');
  assert.equal(view.version, 4);
  assert.equal(view.analysis.policyVersion, DOMAIN_OBSERVATION_POLICY);
  assert.equal(analysis.trajectory?.version, 4);
  assert.equal(analysis.trajectory?.milestones.length, 4);
  assert.equal(analysis.trajectory?.evidenceRefs.length, 4);
  assert.deepEqual(view.strengths, []);
  assert.equal(JSON.stringify(view).includes(privateReflection), false);
  assert.equal(JSON.stringify(f.rows(agentTeamEvents)).includes(privateReflection), false);
  assert.equal(JSON.stringify(f.rows(growthRecords)).includes(privateReflection), false);
  assert.deepEqual(await worker.tick(), { checked: 4, emitted: 0, deferred: 0 });
  assert.equal(f.rows(growthRecords).length, 4);
  assert.equal(f.rows(outbox).filter((row) => row.topic === 'agent.team.event').length, 4);
  assert.equal(f.rows(auditLogs).filter((row) => row.action === 'growth.domain.observed').length, 4);
});

test('reconciliation repairs the record/event crash gap and atomically rolls back incomplete event publication', async () => {
  const { f, worker } = fixture();
  f.failInsertTable = outbox;
  await assert.rejects(worker.reconcile(sources[0]!), /FIXTURE_INSERT_FAILURE/);
  assert.equal(f.rows(growthRecords).length, 1);
  assert.equal(f.rows(agentTeamEvents).length, 0);
  assert.equal(f.rows(auditLogs).length, 0);
  f.failInsertTable = undefined;
  assert.equal(await worker.reconcile(sources[0]!), true);
  assert.equal(await worker.reconcile(sources[0]!), false);
  assert.equal(f.rows(growthRecords).length, 1);
  assert.equal(f.rows(agentTeamEvents).length, 1);
  assert.equal(f.rows(outbox)[0]!.status, 'published', 'domain source delivery is never claimed or mutated');
});

test('unapproved/wrong-version artifacts, forged reflections, nonmastered/revoked objectives and missing frozen binding fail closed', async () => {
  const cases: Array<[number, (f: ProjectionDatabaseFixture) => void]> = [
    [1, (f) => { f.rows(artifacts)[0]!.status = 'submitted'; }],
    [1, (f) => { f.rows(mentorReviews)[0]!.status = 'changes_requested'; }],
    [1, (f) => { f.rows(artifactVersions)[0]!.id = 'other-version'; }],
    [1, (f) => { f.rows(mentorAssignments)[0]!.mentorUserId = 'new-mentor'; }],
    [2, (f) => { f.rows(projectEvidence)[1]!.sourceKind = 'task_submission'; }],
    [2, (f) => { f.rows(artifacts)[1]!.studentUserId = 'other-student'; }],
    [2, (f) => { f.rows(artifactVersions)[1]!.note += 'tampered'; }],
    [3, (f) => { f.rows(masteryEvents)[0]!.eventType = 'revoked'; }],
    [3, (f) => { f.rows(masteryRecords)[0]!.status = 'learning'; }],
    [3, (f) => { f.rows(masteryRecords)[0]!.sourceEventId = 'newer-event'; }],
    [3, (f) => { f.rows(masteryEvents)[0]!.studentUserId = 'other-student'; }],
    [0, (f) => { f.rows(projectBindingSnapshots)[0]!.backfilled = true; }],
    [0, (f) => { f.rows(pblTemplateTeamBindings)[0]!.bindingHash = 'different-hash'; }],
  ];
  for (const [index, mutate] of cases) {
    const { f, worker } = fixture(); mutate(f);
    await assert.rejects(worker.reconcile(sources[index]!));
    assert.equal(f.rows(growthRecords).length, 0);
    assert.equal(f.rows(agentTeamEvents).length, 0);
  }
});

test('the owner independently rejects stale scope, manifest, current route and fabricated abilities or provenance', async () => {
  const cases: Array<[string, (value: ReturnType<typeof fixture>, data: Awaited<ReturnType<typeof candidate>>) => void]> = [
    ['PROJECTION_OWNER_INVALID', ({ f }) => { f.rows(projects)[0]!.studentUserId = 'other-student'; }],
    ['PROJECTION_FROZEN_BINDING_REQUIRED', ({ f }) => { f.rows(projectBindingSnapshots)[0]!.backfilled = true; }],
    ['PROJECTION_ROUTE_REVOKED', ({ f }) => { f.rows(agentRoutes)[0]!.enabled = false; }],
    ['PROJECTION_PURPOSE_CHANGED', ({ f }) => { f.config.growthProjection = { profileAssistantId: null, growthAssistantId: null }; }],
    ['PROJECTION_MANIFEST_STALE', (_value, { row }) => { row.payload.analysisManifest.sourceHash = 'forged'; }],
    ['PROJECTION_DOMAIN_CLAIM_FORBIDDEN', (_value, { row }) => { if ('strengths' in row.payload.result) row.payload.result.strengths = ['invented ability']; }],
    ['PROJECTION_DOMAIN_CLAIM_FORBIDDEN', (_value, { row }) => { if ('evidenceRefs' in row.payload.result) row.payload.result.evidenceRefs.push('artifact:forged'); }],
  ];
  for (const [code, mutate] of cases) {
    const value = fixture();
    await value.worker.reconcile(sources[0]!);
    const data = await candidate(value, 'growth_trajectory', String(value.f.rows(agentTeamEvents)[0]!.id));
    mutate(value, data);
    const reviewed = await value.owner.processReady(data.row.id);
    assert.equal(reviewed.status, 'proposed', code);
    assert.equal(reviewed.errorCode, code);
    assert.equal((await value.growth.getGrowthAnalysis('student')).trajectory, null);
  }
});

test('formal acceptance preserves prior verified evidence and interpretations and rejects stale base versions', async () => {
  const value = fixture();
  await value.worker.reconcile(sources[0]!);
  const eventId = String(value.f.rows(agentTeamEvents)[0]!.id);
  const first = await candidate(value, 'growth_trajectory', eventId, 'first');
  assert.equal((await value.owner.processReady(first.row.id)).status, 'accepted');
  // A synthetic previously reviewed interpretation must survive later factual observations.
  first.row.payload.result.strengths.push('先前已核验的证据表达优势');
  await value.worker.reconcile(sources[1]!);
  const publication = value.f.rows(agentTeamEvents).find((row) => row.topic === 'artifact.published')!;
  const second = await candidate(value, 'growth_trajectory', String(publication.id), 'second');
  assert.equal(validateDomainProjection('growth_trajectory', second.row.payload.result, second.evidence), null);
  assert.equal((await value.owner.processReady(second.row.id)).status, 'accepted');
  assert.equal((await value.growth.getGrowthAnalysis('student')).trajectory?.evidenceRefs.length, 2);
  assert.deepEqual((await value.growth.getGrowthAnalysis('student')).trajectory?.strengths, first.row.payload.result.strengths);
  assert.equal((await value.owner.processReady(first.row.id)).status, 'superseded');
  assert.equal((await value.growth.getGrowthAnalysis('student')).trajectory?.version, 2);
  const stale = { ...second.row, id: 'stale', status: 'proposed', reviewedBy: null, reviewedAt: null };
  value.f.rows(agentProjectionCandidates).push(stale);
  assert.equal((await value.owner.processReady(stale.id)).errorCode, 'PROJECTION_MANIFEST_STALE');
});

test('revocation after generation and forged domain event references cannot be accepted even by Admin', async () => {
  for (const index of [1, 3]) {
    const value = fixture();
    await value.worker.reconcile(sources[index]!);
    const next = await candidate(value, 'growth_trajectory', String(value.f.rows(agentTeamEvents)[0]!.id));
    if (index === 1) value.f.rows(mentorReviews)[0]!.status = 'changes_requested';
    else value.f.rows(masteryRecords)[0]!.sourceEventId = 'revoked-current';
    assert.equal((await value.owner.accept(next.row.id, { id: 'admin', role: 'admin' })).status, 'rejected');
  }
  const value = fixture();
  await value.worker.reconcile(sources[0]!);
  const next = await candidate(value, 'growth_trajectory', String(value.f.rows(agentTeamEvents)[0]!.id));
  const payload = value.f.rows(agentTeamEvents)[0]!.payload as Record<string, unknown>;
  payload.domainSourceHash = 'forged-source';
  assert.equal((await value.owner.processReady(next.row.id)).errorCode, 'PROJECTION_SOURCE_INVALID');
});

test('finite factual policy preserves all prior provenance or defers at the contract bound', async () => {
  const value = fixture();
  await value.worker.reconcile(sources[0]!);
  const next = await candidate(value, 'growth_trajectory', String(value.f.rows(agentTeamEvents)[0]!.id));
  const previous = { version: 20, milestones: [], strengths: [], nextQuestions: [], studentSummary: null,
    evidenceRefs: Array.from({ length: 20 }, (_, index) => `artifact:verified-${index}`), confidence: 'low' };
  const evidence = { ...next.evidence, previousResult: previous, manifest: { ...next.evidence.manifest, baseVersion: 20 } };
  assert.equal(validateDomainProjection('growth_trajectory', expectedDomainProjection('growth_trajectory', evidence), evidence), 'PROJECTION_HISTORY_REVIEW_REQUIRED');
});

test('bounded source cursors advance past invalid first rows and do not steal mastery graph delivery', async () => {
  const { f, worker } = fixture();
  f.rows(masteryEvents).unshift({ ...f.rows(masteryEvents)[0], id: 'a-invalid', eventType: 'revoked' });
  f.rows(masteryRecords).unshift({ ...f.rows(masteryRecords)[0], id: 'invalid-current', objectiveId: 'invalid-objective', sourceEventId: 'a-invalid' });
  f.rows(outbox).push({ id: 'graph-event', topic: 'mastery.assessed', payload: { eventId: 'mastery' }, status: 'pending', createdAt: time });
  assert.equal((await worker.tick(1)).deferred, 1);
  assert.equal((await worker.tick(1)).emitted, 1);
  assert.equal(f.rows(outbox).find((row) => row.id === 'graph-event')!.status, 'pending');
});

test('growth polling skips incomplete and superseded assessment attempts without repeated deferrals', async () => {
  const { f, worker } = fixture();
  f.rows(masteryEvents).push({ ...f.rows(masteryEvents)[0], id: 'old-attempt', qualitativeMastered: false });
  f.rows(masteryEvents).push({ ...f.rows(masteryEvents)[0], id: 'learning-attempt', qualitativeMastered: false });
  f.rows(masteryRecords).push({ ...f.rows(masteryRecords)[0], id: 'learning-current', sourceEventId: 'learning-attempt', status: 'learning' });
  assert.deepEqual(await worker.tick(), { checked: 4, emitted: 4, deferred: 0 });
  assert.deepEqual(await worker.tick(), { checked: 4, emitted: 0, deferred: 0 });
  assert.equal(f.rows(growthRecords).filter(row => row.type === 'objective_mastered').length, 1);
});
