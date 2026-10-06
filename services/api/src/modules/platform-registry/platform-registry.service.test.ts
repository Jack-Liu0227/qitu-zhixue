import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentConfigs, runtimeMcpServers, tutorPartners, type Database } from '@qitu/database';
import { PlatformRegistryService } from './platform-registry.service';

function fakeDatabase() {
  const partner = {
    id: 'tutor-default', displayName: 'Tutor', soul: 'private prompt body', modelUsage: 'tutor.chat',
    promptVersion: 'v3', capabilities: ['explore', 'teach'], enabled: true,
    roleDefinition: '教学伙伴定义，使用问题支持学生理解与反思。',
  };
  const chain = {
    where() { return this; },
    orderBy() { return this; },
    limit: async () => [],
  };
  return {
    execute: async () => ({ rows: [{ '?column?': 1 }] }),
    select: () => ({
      from(table: unknown) {
        if (table === tutorPartners) return Promise.resolve([partner]);
        if (table === agentConfigs || table === runtimeMcpServers) return Promise.resolve([]);
        return chain;
      },
    }),
  } as unknown as Database;
}

test('runtime projection uses persisted partner metadata and excludes prompt contents', async () => {
  const service = new PlatformRegistryService(
    fakeDatabase(),
    'live',
    { write: async () => 'audit-id' } as never,
    { getUsages: () => ({ usages: [], bindings: [] }) } as never,
  );
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.dataSource, 'live');
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0]?.promptVersion, 'v3');
  assert.deepEqual(snapshot.agents[0]?.capabilities, ['explore', 'teach']);
  assert.equal(snapshot.agents[0]?.roleDefinition, '教学伙伴定义，使用问题支持学生理解与反思。');
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('private prompt body'), false);
  assert.equal(snapshot.policy.id, 'AGENTS.md');
  assert.equal(snapshot.policy.status, 'ready');
  assert.equal(snapshot.skills.some((skill) => skill.id === 'student-module'), false);
  assert.equal(snapshot.agents.some((agent) => agent.id === 'admin'), false);
  assert.deepEqual(snapshot.builtInTools[0]?.agentIds, ['qitu-learning-partner']);
  assert.deepEqual(snapshot.mcpServers, []);
});
