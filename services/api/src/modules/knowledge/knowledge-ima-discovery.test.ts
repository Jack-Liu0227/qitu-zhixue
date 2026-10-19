import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { KnowledgeCenterController } from './knowledge-center.controller';
import { KnowledgeConnectionService } from './knowledge-connection.service';
import { KNOWLEDGE_TOOL, type EngineConfig } from './knowledge-center.config';

function fixture() {
  const engine: EngineConfig = {
    name: 'ima',
    provider: 'ima',
    description: '',
    enabled: true,
    config: { clientId: 'saved-client', apiKey: 'saved-secret', server_url: 'https://ima.qq.com' },
  };
  const config = {
    knowledgeEngines: { ima: engine },
    mcpServers: {},
    platformTools: {
      'project-knowledge': { ...KNOWLEDGE_TOOL, enabled: false, boundAssistants: [] },
    },
  };
  const center = { configuration: async () => ({ revision: 1, config }) };
  const service = new KnowledgeEngineService(center as never, {} as never);
  const requests: Record<string, unknown>[] = [];
  (
    service as unknown as { callBridge: (r: Record<string, unknown>) => Promise<unknown> }
  ).callBridge = async (request) => {
    requests.push(request);
    return {
      ok: true,
      manifest: {
        knowledgeBases: [{ id: 'official-id', name: '教材', description: null }],
        nextCursor: 'next',
        isEnd: false,
      },
    };
  };
  return { service, requests, config, engine, center };
}

test('saved and draft credentials list through the same adapter without saving defaults or grants', async () => {
  const f = fixture(),
    before = structuredClone(f.config);
  const first = await f.service.listImaBases('ima', {});
  assert.equal(first?.nextCursor, 'next');
  assert.deepEqual(f.requests[0]!.credentials, {
    clientId: 'saved-client',
    apiKey: 'saved-secret',
  });
  const draft = {
    ...f.engine,
    config: { ...f.engine.config, clientId: 'draft-client', apiKey: 'draft-key' },
  };
  await f.service.listImaBases('ima', { engine: draft, cursor: 'next', limit: 50 });
  assert.deepEqual(f.requests[1]!.credentials, { clientId: 'draft-client', apiKey: 'draft-key' });
  assert.equal(f.requests[1]!.operation, 'list_bases');
  assert.equal(f.requests[1]!.cursor, 'next');
  assert.equal(f.requests[1]!.limit, 50);
  assert.deepEqual(f.config, before);
  assert.ok(!JSON.stringify(first).includes('saved-secret'));
});

test('discovery rejects bad cursors, limits, unknown engines and injected fields before calling upstream', async () => {
  const f = fixture();
  for (const body of [
    { cursor: 1 },
    { cursor: 'a'.repeat(2049) },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { clientId: 'mix-account' },
  ])
    await assert.rejects(f.service.listImaBases('ima', body), { status: 400 });
  await assert.rejects(f.service.listImaBases('unknown', {}), { status: 400 });
  assert.equal(f.requests.length, 0);
});

test('only administrators may list libraries, including when submitting a draft', async () => {
  let calls = 0;
  const controller = new KnowledgeCenterController(
    {} as never,
    {
      listImaBases: async () => {
        calls++;
      },
    } as never,
    { getSession: (token: string) => ({ user: { id: token, role: token } }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(controller.imaBases(undefined, 'ima', {}), { status: 401 });
  await assert.rejects(controller.imaBases('qitu_session=student', 'ima', {}), { status: 403 });
  await controller.imaBases('qitu_session=admin', 'ima', {});
  assert.equal(calls, 1);
});

test('connection failures return actionable safe messages and never write a library', async () => {
  const f = fixture();
  const service = new KnowledgeConnectionService(
    f.center as never,
    {
      adapterFor: () => ({
        connect: async () => ({
          ok: false,
          errorCode: 'REMOTE_RESOURCE_NOT_FOUND',
          status: 'needs_setup',
        }),
      }),
    } as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    service.probe({
      name: '教材',
      mode: 'link_existing',
      engineInstanceId: 'ima',
      connection: { remoteKnowledgeBaseId: 'internal-id' },
    }),
    (error: unknown) => {
      const response = (
        error as { getResponse(): { code: string; message: string } }
      ).getResponse();
      assert.equal(response.code, 'REMOTE_RESOURCE_NOT_FOUND');
      assert.match(response.message, /OpenAPI/);
      assert.ok(!JSON.stringify(response).includes('saved-secret'));
      return true;
    },
  );
});
