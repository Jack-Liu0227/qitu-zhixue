import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryOutboxHandler, type MemoryRecordSource } from './memory-outbox-handler';
import type { AgentMemoryRecord, MemoryIndexPort } from '@qitu/agent-memory';

const record: AgentMemoryRecord = {
  id: 'memory-1', studentId: 'student-1', partnerId: 'partner-1', scope: 'relationship', kind: 'interest',
  content: '喜欢制作小游戏', sourceRef: 'tutor-session-1', sourceEventId: 'event-1', status: 'active', version: 1,
  expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), indexId: null,
};

function source(overrides: Partial<MemoryRecordSource> = {}) {
  const calls: string[] = [];
  const value: MemoryRecordSource = {
    get: async () => record,
    markIndexed: async () => { calls.push('indexed'); },
    markIndexFailed: async () => { calls.push('failed'); },
    ...overrides,
  };
  return { value, calls };
}

test('memory outbox: active record is reconciled and acknowledged', async () => {
  const target = source();
  const index: MemoryIndexPort = {
    reconcile: async () => 'mem0-1',
    remove: async () => { throw new Error('unexpected remove'); },
    recall: async () => [],
  };
  await new MemoryOutboxHandler(target.value, index).handle({ memoryId: record.id });
  assert.deepEqual(target.calls, ['indexed']);
});

test('memory outbox: index failures mark the record failed and are rethrown', async () => {
  const target = source();
  const index: MemoryIndexPort = {
    reconcile: async () => { throw new Error('MEM0_HTTP_503'); },
    remove: async () => undefined,
    recall: async () => [],
  };
  await assert.rejects(() => new MemoryOutboxHandler(target.value, index).handle({ memoryId: record.id }), /MEM0_HTTP_503/);
  assert.deepEqual(target.calls, ['failed']);
});

test('memory outbox: deleted records use the remove operation', async () => {
  let removed = false;
  const target = source({ get: async () => ({ ...record, status: 'deleted', indexId: 'mem0-1' }) });
  const index: MemoryIndexPort = {
    reconcile: async () => { throw new Error('unexpected reconcile'); },
    remove: async () => { removed = true; },
    recall: async () => [],
  };
  await new MemoryOutboxHandler(target.value, index).handle({ memoryId: record.id, operation: 'delete' });
  assert.equal(removed, true);
  assert.deepEqual(target.calls, ['indexed']);
});
