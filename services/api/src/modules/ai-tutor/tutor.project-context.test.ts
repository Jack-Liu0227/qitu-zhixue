import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
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

test('new intent-confirmed project is immediately available to Tutor without a plan or demo roster', async () => {
  const store = {
    findProject: async () => ({ ...project }),
    listProjectsByStudent: async (owner: string) => owner === project.studentId ? [{ ...project }] : [],
  } as unknown as LearningPlanStore;
  const tutor = makeTutor(store);
  assert.equal((await tutor.getProjectContext(project.id, 'owner'))?.project.stage, 'intent_confirmed');
  assert.equal((await tutor.getProjectContext(undefined, 'owner'))?.project.id, project.id);
  const session = await tutor.resolveSession(project.id, 'owner');
  assert.equal(tutor.toSessionResponse(session).projectId, project.id);
  await assert.rejects(tutor.getProjectContext(project.id, 'other'), ForbiddenException);
  await assert.rejects(tutor.resolveSession(project.id, 'other'), ForbiddenException);
  assert.equal(await tutor.getProjectContext(undefined, 'other'), null);
  assert.equal(await makeTutor().getProjectContext(project.id, 'owner'), null);
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
