import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DirectoryService } from '../directory/directory.service';
import { GrowthService } from './growth.service';
import { InMemoryGrowthRecordStore, type GrowthRecordStore } from './growth.persistence';
import type { GrowthStoredRecord } from './growth.record';

const query = { type: 'all' as const, projectId: null, from: null, to: null, cursor: null, limit: 20 };
const directory = {} as DirectoryService;
const observation = {
  studentId: 'student', type: 'reflection_created' as const, occurredAt: '2026-10-22T00:00:00Z',
  title: 'Submitted reflection', summaryStudent: 'Reflection received.', summaryParent: 'Reflection received.',
  evidenceIds: ['reflection:source'], idempotencyKey: 'growth:reflection:source',
};

function persistentStore(): GrowthRecordStore {
  const memory = new InMemoryGrowthRecordStore();
  return {
    persistent: true, seed: () => {}, append: row => memory.append(row),
    listAll: () => memory.listAll(), listByStudent: student => memory.listByStudent(student),
    findByIdempotencyKey: key => memory.findByIdempotencyKey(key),
  };
}

test('another API instance reads a newly persisted growth fact without a restart', async () => {
  const store = persistentStore();
  const first = new GrowthService(directory, store, 'live');
  const second = new GrowthService(directory, store, 'live');
  await Promise.all([first.onModuleInit(), second.onModuleInit()]);
  await first.record(observation);
  assert.equal(second.getTimeline('student', query).items.length, 0);
  const view = await second.getStudentProfile('student');
  assert.equal(view.recentGrowth.length, 1);
  assert.equal((await second.getStudentProfile('other-student')).recentGrowth.length, 0);
  await second.refreshStudent('student');
  assert.equal(second.getTimeline('student', query).items.length, 1);
});

test('a delayed database snapshot cannot erase a newer append', async () => {
  const store = persistentStore();
  let finish: (rows: GrowthStoredRecord[]) => void = () => {};
  store.listByStudent = () => new Promise(resolve => { finish = resolve; });
  const service = new GrowthService(directory, store, 'live');
  const pending = service.refreshStudent('student');
  await service.record(observation);
  finish([]);
  await pending;
  assert.equal(service.getTimeline('student', query).items.length, 1);
});
