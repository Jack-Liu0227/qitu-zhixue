import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectKnowledgeService } from './project-knowledge.service';
import type { KnowledgeCenterService } from './knowledge-center.service';
import type { KnowledgeEngineService } from './knowledge-engine.service';
test('revoking assistant capability stops retrieval before loading any project or calling an engine', async () => {
  let queried = false;
  let executed = false;
  const center = {
    canRetrieve: async () => false,
    query: async () => {
      queried = true;
      return [];
    },
  } as unknown as KnowledgeCenterService;
  const engine = {
    execute: async () => {
      executed = true;
      return { ok: true };
    },
  } as unknown as KnowledgeEngineService;
  const service = new ProjectKnowledgeService(center, engine);
  assert.equal(
    (await service.search('student', 'project', 'assistant', 'question')).state,
    'CAPABILITY_NOT_AUTHORIZED',
  );
  assert.equal(queried, false);
  assert.equal(executed, false);
});
test('project tools reject hidden IDs and arbitrary paths before execution', async () => {
  let searched = false;
  const service = new ProjectKnowledgeService(
    {} as KnowledgeCenterService,
    {} as KnowledgeEngineService,
  );
  service.search = async () => {
    searched = true;
    throw new Error('must not execute');
  };
  const tools = service.tools('student', 'project', 'assistant', 'index-v1');
  const search = tools[0]!;
  const read = tools[1]!;
  assert.equal((await search.execute({ query: 'q', knowledgeBaseId: 'other' })).isError, true);
  assert.equal((await read.execute({ citationId: 'v~m', path: '/etc/passwd' })).isError, true);
  assert.equal(searched, false);
});
test('foreign project ownership returns no metadata and never invokes engine', async () => {
  const service = new ProjectKnowledgeService(
    { canRetrieve: async () => true, query: async () => [] } as unknown as KnowledgeCenterService,
    {
      execute: async () => {
        throw new Error('should not run');
      },
    } as unknown as KnowledgeEngineService,
  );
  await assert.rejects(
    service.search('student-a', 'student-b-project', 'assistant', 'q'),
    /项目资料不可用/,
  );
});
