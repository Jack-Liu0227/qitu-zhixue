import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { KnowledgeToolCatalogService } from './knowledge-tool-catalog.service';
import { KnowledgeCenterController } from './knowledge-center.controller';
import { ProjectKnowledgeService } from './project-knowledge.service';
import type { KnowledgeCenterService } from './knowledge-center.service';
import type { KnowledgeEngineService } from './knowledge-engine.service';
import type { AuthService } from '../identity-auth/auth.service';
import { ImaMcpClient } from '../ai-tutor/ima-mcp.client';
const config = {
  mcpServers: { fetch: { name: 'fetch', tools: ['fetch_url'] } },
  knowledgeEngines: {
    ima: { provider: 'ima', config: { connectionRef: 'ima-legacy' } },
    local: { provider: 'llamaindex', config: {} },
  },
};
const center = {
  configuration: async () => ({ config }),
  database: () => ({
    select: () => ({
      from: async () => [{ id: 'fetch', toolIds: ['fetch_url'], lastCheckedAt: null }],
    }),
  }),
} as unknown as KnowledgeCenterService;
const project = new ProjectKnowledgeService(center, {} as KnowledgeEngineService);

test('project metadata shares runtime schemas, without any retrieval execution', async () => {
  const service = new KnowledgeToolCatalogService(center, project);
  const expected = project
    .tools('', '', '', '')
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  assert.deepEqual((await service.list('platformTools', 'project-knowledge')).tools, expected);
  assert.equal(expected[0]!.inputSchema.additionalProperties, false);
  assert.deepEqual(await service.list('knowledgeEngines', 'local').then((r) => r.tools), []);
  assert.equal((await service.list('mcpServers', 'fetch')).tools[0]!.inputSchema, null);
  await assert.rejects(service.list('mcpServers', 'missing'), /未注册/);
  await assert.rejects(service.list('knowledgeEngines', 'missing'), /未注册/);
  await assert.rejects(service.list('invalid', 'id'), /无效/);
});

test('admin metadata requires authentication and admin role before discovery', async () => {
  let calls = 0;
  const catalog = {
    list: async () => {
      calls++;
      return { tools: [] };
    },
  } as unknown as KnowledgeToolCatalogService;
  const auth = {
    getSession: (token: string) => ({ user: { id: token, role: token } }),
  } as unknown as AuthService;
  const controller = new KnowledgeCenterController(
    center,
    {} as KnowledgeEngineService,
    auth,
    catalog,
  );
  await assert.rejects(controller.tools(undefined, 'platformTools', 'project-knowledge'), {
    status: 401,
  });
  await assert.rejects(
    controller.tools('qitu_session=student', 'platformTools', 'project-knowledge'),
    { status: 403 },
  );
  assert.equal(calls, 0);
  await controller.tools('qitu_session=admin', 'platformTools', 'project-knowledge');
  assert.equal(calls, 1);
});

test('ima metadata caches discovery, refreshes explicitly and marks failed refresh stale', async () => {
  let calls = 0;
  let fail = false;
  const discovery = mock.method(ImaMcpClient.prototype, 'toolsFor', async () => {
    calls++;
    if (fail) throw new Error('private diagnostic must not escape');
    return [
      {
        name: 'ima_search_knowledge',
        description: 'search',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute: async () => {
          throw new Error('must not execute');
        },
      },
    ];
  });
  try {
    const service = new KnowledgeToolCatalogService(center, project);
    const first = await service.list('knowledgeEngines', 'ima');
    assert.equal(first.tools.length, 1);
    assert.equal(first.source, 'mcp');
    await service.list('knowledgeEngines', 'ima');
    assert.equal(calls, 1);
    fail = true;
    const stale = await service.list('knowledgeEngines', 'ima', true);
    assert.equal(calls, 2);
    assert.equal(stale.stale, true);
    assert.equal((await service.list('knowledgeEngines', 'ima')).stale, true);
    assert.deepEqual(stale.tools, first.tools);
    assert.ok(!JSON.stringify(stale).includes('private diagnostic'));
  } finally {
    discovery.mock.restore();
  }
});
