import assert from 'node:assert/strict';
import { it } from 'node:test';
import { users, type Database } from '@qitu/database';
import { PostgresLearningPlanStore } from './learning-plan.store.postgres';
import type { PlanBundle } from './learning-plan.store';

// Adapter round-trip only: this fixture does not test PostgreSQL DDL or constraints.
function adapterDatabase(): Database {
  const tables = new Map<unknown, Record<string, unknown>[]>();
  const db = {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        tables.set(table, structuredClone([...(tables.get(table) ?? []), ...(Array.isArray(values) ? values : [values])]));
        return Object.assign(Promise.resolve(), { onConflictDoNothing: async () => undefined });
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === users ? [{ schoolId: null }] : structuredClone(tables.get(table) ?? []);
          return Object.assign(Promise.resolve(rows), {
            orderBy: async () => rows,
            limit: async (count: number) => rows.slice(0, count),
          });
        },
      }),
    }),
  };
  return db as unknown as Database;
}

it('Postgres adapter writes and reloads frozen lesson titles and guidance; legacy titles remain null', async () => {
  const now = new Date('2026-10-19T00:00:00Z');
  const store = new PostgresLearningPlanStore(adapterDatabase());
  const bundle: PlanBundle = {
    plan: {
      id: 'fixture-plan', studentUserId: 'fixture-student', projectId: null, interest: 'Optics', goal: 'Evidence',
      weeks: 8, minutesPerSession: 60, templateVersion: 'fixture-16s-version', status: 'draft', version: 1,
      idempotencyKey: 'fixture-plan-key', confirmedAt: null, completedAt: null, createdAt: now, updatedAt: now,
    },
    modules: [{ id: 'fixture-module', planId: 'fixture-plan', name: 'Week 1', weekIndex: 1, objective: 'Observe', ordinal: 1 }],
    objectives: [],
    sessions: [{
      id: 'fixture-session', planId: 'fixture-plan', moduleId: 'fixture-module', index: 0,
      title: 'Frozen optics observation lesson',
      blocks: [{ kind: 'reflect', minutes: 5, title: 'Reflection', guidance: 'Compare prediction and evidence', evidenceRequirements: ['Observation table'] }],
      theoryObjectiveIds: [], practiceObjectiveIds: [], mode: 'study',
    }, {
      id: 'fixture-legacy-session', planId: 'fixture-plan', moduleId: 'fixture-module', index: 1,
      blocks: [{ kind: 'theory', minutes: 60 }], theoryObjectiveIds: [], practiceObjectiveIds: [], mode: 'study',
    }],
  };
  await store.createPlan(bundle);
  const read = await store.findSession('fixture-plan', 'fixture-session');
  assert.equal(read?.title, 'Frozen optics observation lesson');
  assert.deepEqual(read?.blocks, [{
    kind: 'reflect', minutes: 5, title: 'Reflection', guidance: 'Compare prediction and evidence', evidenceRequirements: ['Observation table'],
  }]);
  const sessions = await store.listSessions('fixture-plan');
  assert.deepEqual(sessions.map((session) => session.title), ['Frozen optics observation lesson', null]);
  assert.deepEqual(sessions[1]?.blocks, [{ kind: 'theory', minutes: 60 }]);
});
