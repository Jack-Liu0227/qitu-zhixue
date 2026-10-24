import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  GROWTH_COMPETENCY_DIMENSIONS, GROWTH_COMPETENCY_FRAMEWORK_VERSION, parseGrowthCompetencyOverview,
  type StudentGrowthEntry,
} from '@qitu/contracts';
import { agentProjectionCandidates } from '@qitu/database';
import type { DirectoryService } from '../directory/directory.service';
import type { AuthService } from '../identity-auth/auth.service';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { GrowthRecordStore, type GrowthAppendResult } from './growth.persistence';
import { buildGrowthStoredRecord, type GrowthStoredRecord } from './growth.record';
import { buildGrowthCompetencyOverview } from './growth-competency.read-model';
import { ProjectionDatabaseFixture } from './growth-projection.test-fixture';

const at = '2026-10-22T01:00:00.000Z';
function reference(id = 'record'): StudentGrowthEntry {
  return { id, title: '有依据的课时作品', type: 'artifact_published', occurredAt: at, projectId: 'project', projectTitle: '测试项目',
    summaryStudent: '已保存作品', stage: null, artifactRef: 'artifact', objectiveTitles: [], icon: 'artifact', encouragement: null,
    evidenceIds: ['artifact:version-1'], observationState: 'observed' };
}

test('six canonical axes have descriptions and evidence guidance, with unknown values kept null', () => {
  const overview = buildGrowthCompetencyOverview([]);
  assert.equal(overview.frameworkVersion, GROWTH_COMPETENCY_FRAMEWORK_VERSION);
  assert.equal(overview.assessmentUnavailableReason, 'framework_not_configured');
  assert.equal(overview.dimensions.length, 6);
  assert.deepEqual(overview.dimensions.map((axis) => axis.id), GROWTH_COMPETENCY_DIMENSIONS.map((axis) => axis.id));
  for (const axis of overview.dimensions) {
    assert.equal(axis.status, 'pending_observation');
    assert.equal(axis.value, null);
    assert.equal(axis.assessment, null);
    assert.deepEqual(axis.evidenceRefs, []);
    assert.ok(axis.description && axis.evidenceGuidance);
  }
  assert.deepEqual(parseGrowthCompetencyOverview(overview), overview);
});

test('explicit owner observation mapping updates footprints without assigning any score or ability', () => {
  const overview = buildGrowthCompetencyOverview([], {
    collaborative_expression: ['learning_interaction:turn-1', 'learning_interaction:turn-1', 'raw_conversation:private'],
    scientific_inquiry: ['experiment_observation:obs-1'],
  });
  assert.equal(overview.dimensions[4].status, 'observed');
  assert.deepEqual(overview.dimensions[4].evidenceRefs, ['learning_interaction:turn-1']);
  assert.equal(overview.dimensions[1].status, 'observed');
  assert.ok(overview.dimensions.every(axis => axis.value === null && axis.assessment === null));
  assert.equal(overview.dimensions[0].status, 'pending_observation');
  assert.deepEqual(parseGrowthCompetencyOverview(overview), overview);
});

test('growth counts, source kinds and boolean review facts cannot assign axes or produce scores', () => {
  const record = { ...reference(), quality: { status: 'accepted', feedback: [{ criterionId: 'criterion', meets: true }] },
    sourceKind: 'reflection', projectsCompleted: 100, score: 100 };
  const overview = buildGrowthCompetencyOverview([record]);
  assert.ok(overview.dimensions.every((axis) => axis.status === 'pending_observation' && axis.value === null));
  assert.equal(overview.unassignedEvidence.length, 1);
  assert.equal(overview.unassignedEvidence[0]?.growthRecordId, record.id);
  assert.equal(JSON.stringify(overview).includes('meets'), false);
  assert.equal(JSON.stringify(overview).includes('projectsCompleted'), false);
  assert.deepEqual(overview.unassignedEvidence[0]?.evidenceRefs, ['artifact:version-1']);
});

test('unassigned references are bounded, deduplicated and never turn a bare record into evidence', () => {
  const records = Array.from({ length: 10 }, (_, index) => reference(`record-${index}`));
  const overview = buildGrowthCompetencyOverview([reference('record-0'), ...records]);
  assert.equal(overview.unassignedEvidence.length, 6);
  assert.equal(new Set(overview.unassignedEvidence.map((record) => record.growthRecordId)).size, 6);
  assert.deepEqual(buildGrowthCompetencyOverview([{ ...reference(), evidenceIds: [] }]).unassignedEvidence, []);
  assert.deepEqual(buildGrowthCompetencyOverview([{ ...reference(), evidenceIds: ['raw_conversation:private'] }]).unassignedEvidence, []);
});

test('boundary parser rejects missing, unknown or duplicate axes and fabricated zero fallbacks', () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.frameworkVersion = 'unknown-framework'; },
    (value) => { value.dimensions = []; },
    (value) => { const axes = value.dimensions as Array<Record<string, unknown>>; axes[0]!.id = 'invented'; },
    (value) => { const axes = value.dimensions as Array<Record<string, unknown>>; axes[1] = { ...axes[0] }; },
    (value) => { const axes = value.dimensions as Array<Record<string, unknown>>; axes[0]!.value = 0; },
    (value) => { const axes = value.dimensions as Array<Record<string, unknown>>; axes[0]!.value = false; },
    (value) => { value.assessmentUnavailableReason = null; },
    (value) => { const axes = value.dimensions as Array<Record<string, unknown>>; axes[0]!.status = 'assessed'; axes[0]!.value = 3; },
  ];
  for (const change of cases) {
    const value = structuredClone(buildGrowthCompetencyOverview([])) as unknown as Record<string, unknown>;
    change(value);
    assert.equal(parseGrowthCompetencyOverview(value), null);
  }
  const reordered = structuredClone(buildGrowthCompetencyOverview([]));
  const parsed = parseGrowthCompetencyOverview({ ...reordered, dimensions: [...reordered.dimensions].reverse() });
  assert.deepEqual(parsed?.dimensions.map((axis) => axis.id), GROWTH_COMPETENCY_DIMENSIONS.map((axis) => axis.id));
});

test('reserved assessed shape distinguishes a real zero from missing evidence and requires a bounded receipt', () => {
  const overview = buildGrowthCompetencyOverview([]);
  const assessed = { ...overview.dimensions[0], status: 'assessed', value: 0, evidenceRefs: ['artifact:version-1'],
    assessment: { receiptId: 'receipt', rubricId: 'rubric', rubricVersion: 'v1', scaleId: 'scale-v1', scaleMin: 0, scaleMax: 4, assessedAt: at } };
  const value = { ...overview, assessmentUnavailableReason: null, dimensions: [assessed, ...overview.dimensions.slice(1)] };
  assert.equal(parseGrowthCompetencyOverview(value)?.dimensions[0].value, 0);
  assert.equal(parseGrowthCompetencyOverview({ ...value, dimensions: [{ ...assessed, value: 5 }, ...value.dimensions.slice(1)] }), null);
  assert.equal(parseGrowthCompetencyOverview({ ...value, dimensions: [{ ...assessed, evidenceRefs: [] }, ...value.dimensions.slice(1)] }), null);
});

class ReadOnlyStore extends GrowthRecordStore {
  readonly persistent = true;
  readonly reads: string[] = [];
  readonly records = ['student', 'other-student'].map((studentId) => buildGrowthStoredRecord({
    studentId, type: 'artifact_published', occurredAt: at, title: '正式作品', summaryStudent: '已发布', summaryParent: '已发布',
    artifactRef: `artifact-${studentId}`, evidenceIds: [`artifact:${studentId}`], idempotencyKey: `test:${studentId}`,
  }, at));
  async append(): Promise<GrowthAppendResult> { throw new Error('GET_MUST_NOT_WRITE'); }
  async findByIdempotencyKey(): Promise<GrowthStoredRecord | null> { throw new Error('GET_MUST_NOT_WRITE'); }
  async listAll(): Promise<GrowthStoredRecord[]> { throw new Error('GET_MUST_BE_STUDENT_SCOPED'); }
  async listByStudent(studentId: string): Promise<GrowthStoredRecord[]> { this.reads.push(studentId); return this.records.filter((record) => record.studentId === studentId); }
}

test('profile GET inherits student authentication and scoped reads without writing facts or generating analyses', async () => {
  const store = new ReadOnlyStore();
  const service = new GrowthService({} as DirectoryService, store, 'test');
  const auth = { getSession: (token: string) => ({ user: { id: 'student', role: token === 'teacher' ? 'teacher' : 'student' } }) } as unknown as AuthService;
  const controller = new GrowthController(service, auth);
  await assert.rejects(controller.getProfile(undefined), UnauthorizedException);
  await assert.rejects(controller.getProfile('qitu_session=teacher'), ForbiddenException);
  assert.deepEqual(store.reads, []);
  const first = (await controller.getProfile('qitu_session=student')).data;
  const second = (await controller.getProfile('qitu_session=student')).data;
  assert.deepEqual(store.reads, ['student', 'student']);
  assert.equal(first.summary.artifactsPublished, 1);
  assert.equal(first.competencyOverview.unassignedEvidence.length, 1);
  assert.ok(first.competencyOverview.dimensions.every((axis) => axis.value === null));
  assert.deepEqual(first.competencyOverview, second.competencyOverview);
  assert.equal(JSON.stringify(first.competencyOverview).includes('other-student'), false);
  assert.equal(store.records.length, 2);
});

test('adding a competency overview preserves prior accepted profile content and provenance', async () => {
  const store = new ReadOnlyStore();
  const database = new ProjectionDatabaseFixture().seed(agentProjectionCandidates, [{ id: 'accepted-profile', status: 'accepted',
    studentUserId: 'student', projectionType: 'learner_profile', agentId: 'profile-owner', createdAt: new Date(at), reviewedAt: new Date(at),
    payload: { result: { version: 3, priorKnowledge: null, targetLevel: null, timeBudgetMinutesPerWeek: null,
      preferences: ['先观察再解释'], interests: ['光学'], strengths: ['已核验的表达优势'], nextQuestions: [] } } }]);
  const service = new GrowthService({} as DirectoryService, store, 'test', undefined, database.db);
  const profile = await service.getStudentProfile('student');
  assert.equal(profile.version, 3);
  assert.equal(profile.provenance.profileAssistantId, 'profile-owner');
  assert.deepEqual(profile.interests, ['光学']);
  assert.deepEqual(profile.strengths, ['已核验的表达优势']);
  assert.ok(profile.competencyOverview.dimensions.every((axis) => axis.value === null));
  assert.equal(profile.analysis.status, 'accepted');
});
