import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '@qitu/database';
import { PlatformRegistryService } from './platform-registry.service';

function fakeDatabase() {
  let selectCount = 0;
  const partner = {
    id: 'tutor-default', displayName: 'Tutor', soul: 'private prompt body', modelUsage: 'tutor.chat',
    promptVersion: 'v3', capabilities: ['explore', 'teach'], enabled: true,
  };
  let query: {
    from: () => Promise<typeof partner[]> | typeof query;
    where: () => typeof query;
    orderBy: () => typeof query;
    limit: () => Promise<never[]>;
  };
  query = {
    from: () => selectCount === 1 ? Promise.resolve([partner]) : query,
    where: () => query,
    orderBy: () => query,
    limit: async () => [],
  };
  return {
    execute: async () => ({ rows: [{ '?column?': 1 }] }),
    select: () => {
      selectCount += 1;
      return query;
    },
  } as unknown as Database;
}

test('runtime projection uses persisted partner metadata and excludes prompt contents', async () => {
  const service = new PlatformRegistryService(fakeDatabase(), 'live');
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.dataSource, 'live');
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0]?.promptVersion, 'v3');
  assert.deepEqual(snapshot.agents[0]?.capabilities, ['explore', 'teach']);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('private prompt body'), false);
  assert.equal(snapshot.policy.id, 'AGENTS.md');
  assert.equal(snapshot.policy.status, 'ready');
  assert.equal(snapshot.skills.some((skill) => skill.id === 'student-module'), false);
  assert.equal(snapshot.agents.some((agent) => agent.id === 'admin'), false);
  assert.deepEqual(snapshot.builtInTools[0]?.agentIds, ['qitu-learning-partner']);
  assert.deepEqual(snapshot.mcpServers, []);
});
