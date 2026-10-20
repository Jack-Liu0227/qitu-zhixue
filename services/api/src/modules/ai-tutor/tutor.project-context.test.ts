import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { LearningPlanStore, type LearningProjectRecord } from '../learning-plan/learning-plan.store';
import { ProjectLifecycleService } from '../projects/project-lifecycle.service';
import { PostgresLearningPlanStore } from '../learning-plan/learning-plan.store.postgres';
import { projects, type Database } from '@qitu/database';
import { PgDialect } from 'drizzle-orm/pg-core';

const project: LearningProjectRecord = {
  id: 'fresh-intent-project', studentId: 'owner', templateVersionId: null,
  status: 'intent_confirmed', currentStageIndex: 1, stageTotal: 10, progressPercent: 11,
  title: 'Synthetic motion exploration', subtitle: null, tags: ['motion'], createdAt: new Date(), completedAt: null,
};

function makeTutor(store?: LearningPlanStore) {
  return new TutorService('live', { complete: async () => { throw new Error('not called'); } },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store);
}

test('intent-confirmed project without a frozen binding fails closed', async () => {
  const store = {
    findProject: async () => ({ ...project }),
    listProjectsByStudent: async (owner: string) => owner === project.studentId ? [{ ...project }] : [],
  } as unknown as LearningPlanStore;
  const tutor = makeTutor(store);
  await assert.rejects(tutor.getProjectContext(project.id, 'owner'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code?: string }).code, 'PROJECT_BINDING_RECONFIRM_REQUIRED');
    return true;
  });
  await assert.rejects(tutor.resolveSession(project.id, 'owner'), ConflictException);
  await assert.rejects(tutor.getProjectContext(project.id, 'other'), ForbiddenException);
  await assert.rejects(tutor.resolveSession(project.id, 'other'), ForbiddenException);
  assert.equal(await tutor.getProjectContext(undefined, 'other'), null);
  assert.equal(await makeTutor().getProjectContext(project.id, 'owner'), null);
});

test('explicit exploration context returns the real intake identity without a project row', async () => {
  const context = await makeTutor().getProjectContext(undefined, 'owner', true);
  // 探索会话不得返回哨兵项目：否则前端会把 'exploration' 当真实 projectId。
  assert.equal(context?.project, null);
  assert.deepEqual(context?.team, {
    teamId: null,
    teamName: null,
    assistantId: 'qitu-intake-assistant',
    assistantName: '启途智学助手',
    assistantAvatar: '🧭',
  });
  assert.deepEqual(context?.phases, []);
});

test('recommended exploration resolves its bound template team without creating a project', async () => {
  const tutor = makeTutor();
  const team = {
    id: 'team-thunder', name: '雷霆战机团队', enabled: true, leaderAssistantId: 'thunder-leader',
    members: [], pblSpec: { projectId: 'template-thunder', phases: [] },
  };
  Object.assign(tutor, {
    projects: { getExploration: async () => ({
      id: 'exp-bound', source: 'recommended', templateVersionId: 'version-bound', status: 'exploring',
      intentDraft: null, projectId: null, createdAt: '', updatedAt: '',
    }) },
    platformRegistry: {
      listAssistants: async () => [{ id: 'thunder-leader', name: '雷霆领航员', enabled: true }],
      listTeams: async () => [team],
      getTeamForTemplateVersion: async () => team,
    },
    database: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ id: 'template-thunder', title: '雷霆战机', slug: 'thunder' }] }) }) }) }) },
  });
  const context = await tutor.getProjectContext(undefined, 'owner', true, 'exp-bound');
  assert.equal(context?.project, null);
  assert.equal(context?.team?.teamId, 'team-thunder');
  assert.equal(context?.team?.teamName, '雷霆战机团队');
  assert.equal(context?.team?.assistantName, '雷霆领航员');
});

test('team graph rejects a cross-student project before returning any graph data', async () => {
  const store = {
    findProject: async () => ({ ...project }),
  } as unknown as LearningPlanStore;
  const tutor = makeTutor(store);
  await assert.rejects(tutor.getTeamGraph(project.id, 'other'), ForbiddenException);
});
test('project list includes confirmed projects before a learning plan exists', async () => {
  const store = {
    listProjectsByStudent: async (owner: string) => owner === project.studentId ? [project] : [],
    listPlansByStudent: async () => { throw new Error('project list must not require a plan'); },
  } as unknown as LearningPlanStore;
  const service = new ProjectLifecycleService(store, {} as never, {} as never, {} as never, {} as never, {} as never);
  const actor = { id: 'owner', role: 'student', email: '', displayName: '' } as const;
  assert.equal((await service.listProjects(actor))[0]?.id, project.id);
  assert.deepEqual(await service.listProjects({ ...actor, id: 'other' }), []);
  await assert.rejects(service.listProjects({ ...actor, role: 'teacher' }), ForbiddenException);
});

test('Postgres project list queries projects directly with student ownership predicate', async () => {
  const db = { select: () => ({ from: (table: unknown) => {
    assert.equal(table, projects);
    return { where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = new PgDialect().sqlToQuery(predicate);
      assert.deepEqual(query.params, ['owner']);
      assert.match(query.sql, /student_user_id/);
      return { orderBy: async () => [] };
    } };
  } }) } as unknown as Database;
  assert.deepEqual(await new PostgresLearningPlanStore(db).listProjectsByStudent('owner'), []);
});
