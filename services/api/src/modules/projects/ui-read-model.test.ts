import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthService } from '../identity-auth/auth.service';
import { DirectoryService } from '../directory/directory.service';
import { TeacherService } from '../teacher/teacher.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { LearningPlanStore, type LearningProjectRecord } from '../learning-plan/learning-plan.store';
import { currentStudentProject } from './current-project';
import { ParentController } from '../parent/parent.controller';
import { GrowthService } from '../growth/growth.service';
import { WorksService } from '../works/works.service';

test('a correct public demo credential cannot create a live session', async () => {
  const fixturePassword = 'isolated-fixture-only';
  const directory = {
    findCredentialByEmail: async () => ({ user: { userId: 'admin-demo', email: 'admin@qtzx.local', displayName: 'Fixture', role: 'admin' }, passwordHash: createHash('sha256').update(fixturePassword).digest('hex') }),
    allowsDemoLogin: () => false,
  } as unknown as DirectoryService;
  const auth = new AuthService(directory);
  await assert.rejects(auth.login('admin@qtzx.local', fixturePassword), (error: unknown) => (error as { getStatus(): number }).getStatus() === 401);
});

test('teacher roster uses project owner counts and identity instead of platform demo fields', async () => {
  const records: LearningProjectRecord[] = [
    { id: 'new', studentId: 'student', title: 'Newest', status: 'intent_confirmed', progressPercent: 11, createdAt: new Date('2026-10-20'), completedAt: null, currentStageIndex: 1, stageTotal: 10, templateVersionId: null, subtitle: null, tags: [] },
    { id: 'older', studentId: 'student', title: 'Other', status: 'practice_building', progressPercent: 56, createdAt: new Date('2026-10-19'), completedAt: null, currentStageIndex: 5, stageTotal: 10, templateVersionId: null, subtitle: null, tags: [] },
  ];
  const directory = { studentsOfMentor: async () => [{ userId: 'student', displayName: 'Directory identity', email: 'fixture@example.invalid' }], listGuardianLinks: async () => [] } as unknown as DirectoryService;
  const platform = { getStudent: () => { throw new Error('Must not read demonstration counters'); } } as unknown as PlatformDataService;
  const store = { listProjectsByStudent: async () => records } as unknown as LearningPlanStore;
  const teacher = new TeacherService(directory, platform, undefined, undefined, store);
  const [row] = await teacher.getRoster('teacher');
  assert.equal(row?.displayName, 'Directory identity');
  assert.equal(row?.activeProjectCount, 2);
  assert.equal(row?.currentProjectId, currentStudentProject(records)?.id);
  assert.equal(row?.progressPercent, 11);
  assert.equal(row?.signalsAvailable, false);
});

test('parent dashboard reads the same current project and rejects an unrelated child before reading owners', async () => {
  let projectReads = 0;
  const project = { id: 'current', studentId: 'child', title: 'Current inquiry', status: 'intent_confirmed', progressPercent: 11, createdAt: new Date('2026-10-20') } as LearningProjectRecord;
  const parent = { id: 'guardian', role: 'parent', displayName: 'Fixture parent', email: 'fixture@example.invalid' };
  const auth = { getSession: () => ({ user: parent }) } as unknown as AuthService;
  const directory = { findUser: async () => ({ userId: 'child', displayName: 'Directory child' }) } as unknown as DirectoryService;
  const growth = { canParentReadChild: async (_parent: string, child: string) => child === 'child', getSummary: () => ({ streakDays: 0 }) } as unknown as GrowthService;
  const store = { listProjectsByStudent: async () => { projectReads += 1; return [project]; } } as unknown as LearningPlanStore;
  const works = { listArtifacts: async (actor: { id: string }) => { assert.equal(actor.id, parent.id); return []; } } as unknown as WorksService;
  const controller = new ParentController(auth, directory, growth, {} as PlatformDataService, null!, null!, undefined, store, works);
  const { data } = await controller.getDashboard('qitu_session=fixture', 'child');
  assert.equal(data.currentProject?.projectId, project.id);
  assert.equal(data.currentProject?.progressPercent, 11);
  assert.equal(data.childDisplayName, 'Directory child');
  assert.equal(data.kpis[0]?.value, '暂未接入');
  assert.deepEqual(data.recentArtifacts, []);
  await assert.rejects(controller.getDashboard('qitu_session=fixture', 'unrelated'), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
  assert.equal(projectReads, 1);
});
