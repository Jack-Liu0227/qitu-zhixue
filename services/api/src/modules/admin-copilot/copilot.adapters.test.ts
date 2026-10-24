import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pblTemplateTeamBindings, modelModels } from '@qitu/database';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { CopilotOperations } from './copilot.operations';
import { CopilotLifecycle } from './copilot.lifecycle';
import { actor } from '../templates/templates.test-support';
import { publicMcpAddress, mcpTransport } from './copilot.mcp';

const admin = actor('admin', 'adapter-fixture');
test('knowledge connection/import/rebuild adapters use existing owners and read current build state', async () => {
  const calls: string[] = [];
  let state = 'queued', revision = 2;
  const center = { base: async (id: string) => ({ id, revision, lifecycle: 'active', build_state: state }),
    addFile: async (_actor: unknown, id: string, body: unknown, key: string) => {
      assert.deepEqual(body, { title: 'Supplied source', content: 'User supplied source text' });
      assert.equal(key, 'import-key'); calls.push('import'); return { id, revision, build_state: state };
    }, rebuild: async (id: string, key: string) => { assert.equal(key, 'rebuild-key'); calls.push('rebuild'); return { id }; } };
  const connection = { createBase: async (_actor: unknown, input: unknown, key: string) => {
    assert.equal(key, 'link-key'); calls.push('link'); return { id: 'base', ...input as object };
  } };
  const operations = new CopilotOperations({} as never, {} as never, center as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, connection as never);
  const link = { name: 'Existing index', engineInstanceId: 'fixture-engine', mode: 'link_existing', connection: { remoteKnowledgeBaseId: 'remote' } };
  assert.equal((await operations.execute(admin, 'knowledge.create', link, 'link-key') as { mode: string }).mode, 'link_existing');
  const imported = await operations.execute(admin, 'knowledge.import', { id: 'base', title: 'Supplied source', content: 'User supplied source text' }, 'import-key');
  assert.equal((await operations.readback(admin, 'knowledge.import', imported) as { buildState: string }).buildState, 'queued');
  await operations.execute(admin, 'knowledge.rebuild', { id: 'base' }, 'rebuild-key');
  state = 'ready'; revision++;
  assert.equal((await operations.readback(admin, 'knowledge.import', imported) as { buildState: string }).buildState, 'ready');
  assert.deepEqual(calls, ['link', 'import', 'rebuild']);
  await assert.rejects(operations.execute({ ...admin, role: 'student' }, 'knowledge.import', { id: 'base' }, 'denied'));
});

test('real team delegation derives the current server phase and reports queued separately from completion', async () => {
  let delegated = 0, taskState = 'queued';
  const runtime = { getProjectIdentityForRun: async () => ({ projectId: 'project', templateVersionId: 'frozen-v1', leaderAgentId: 'leader' }), getPhaseStatus: async () => ({ phase: 'exploration' }),
    delegate: async (_actor: unknown, runId: string, input: Record<string, unknown>) => {
      assert.equal(runId, 'existing-run'); assert.equal(input.pblPhase, 'exploration');
      assert.equal(input.idempotencyKey, 'team-key'); delegated++; return { id: 'task', status: taskState };
    }, getRunGraph: async () => ({ run: { status: 'running' }, tasks: [{ id: 'task', status: taskState, input: { private: 'never projected' } }], messages: [{ content: 'private conversation' }] }) };
  const operations = new CopilotOperations({} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    { getFrozenTeachingBundle: async () => ({ teamVersion: { leaderAssistantId: 'leader', members: [{ assistantId: 'leader' }, { assistantId: 'coach' }] } }) } as never,
    undefined, undefined, undefined, runtime as never);
  const result = await operations.execute(admin, 'team.run', { runId: 'existing-run', senderAgentId: 'leader', recipientAgentId: 'coach', taskType: 'authorized-task' }, 'team-key');
  const queued = await operations.readback(admin, 'team.run', result);
  assert.equal((queued as { status: string }).status, 'queued');
  taskState = 'succeeded';
  const done = await operations.execute(admin, 'team.run.status', { runId: 'existing-run' }, 'status');
  assert.equal(JSON.stringify(done).includes('private'), false);
  assert.equal(delegated, 1);
  await assert.rejects(operations.execute(admin, 'team.run', { runId: 'existing-run', senderAgentId: 'leader', recipientAgentId: 'foreign', taskType: 'authorized-task' }, 'foreign-member'));
  assert.equal(delegated, 1);
  await assert.rejects(operations.execute(admin, 'team.run', { runId: 'existing-run', pblPhase: 'guided_practice' }, 'forged-phase'));
});

test('model deletion delegates physical deletion and verifies catalog absence', async () => {
  let models = [{ providerId: 'provider', modelId: 'manual' }];
  const owner = { deleteManualModel: async (provider: string, model: string, actorId: string, key: string) => {
    assert.equal(provider, 'provider'); assert.equal(model, 'manual'); assert.equal(actorId, admin.id); assert.equal(key, 'model-key'); models = [];
  }, listAgentModelOptions: () => models };
  const lifecycle = new CopilotLifecycle({} as never, {} as never, {} as never, owner as never, {} as never, {} as never);
  const result = await lifecycle.execute(admin, 'model.delete', { providerId: 'provider', modelId: 'manual' }, 'model-key');
  await lifecycle.readback(admin, 'model.delete', result);
  models = [{ providerId: 'provider', modelId: 'manual' }];
  await assert.rejects(lifecycle.readback(admin, 'model.delete', result));
});

test('generic MCP network guard rejects private/mapped/metadata addresses and embedded credentials', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:8.8.8.8', 'fe80::1', 'fc00::1', '2002:7f00:1::']) assert.equal(publicMcpAddress(address), false);
  assert.equal(publicMcpAddress('8.8.8.8'), true);
  assert.equal(publicMcpAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://example.com/mcp', 'https://user:password@example.com/mcp', 'https://example.com/mcp?key=value']) assert.throws(() => mcpTransport(url));
});


test('actual model owner blocks deletion when only a frozen team version still references it', async () => {
  let deletes = 0, audits = 0;
  const service = new ModelRegistryService(null, { write: async () => { audits++; return 'audit'; } } as never);
  await service.upsertProvider('fixture-model-owner', { name: 'Fixture', baseUrl: 'https://fixture.invalid' }, admin.id);
  await service.createManualModel('fixture-model-owner', { modelId: 'manual', displayName: 'Fixture model', input: ['text'], output: ['text'] }, admin.id, 'create-fixture-model');
  const tx = { select: () => ({ from: (table: unknown) => ({ where: () => {
    const result = table === modelModels ? [{ source: 'manual', modelId: 'manual' }] : table === pblTemplateTeamBindings ? [{ id: 'frozen-team-v1' }] : [];
    return Object.assign(Promise.resolve(result), { limit: async () => result });
  } }) }), delete: () => { deletes++; throw new Error('Deletion must be blocked'); } };
  Object.defineProperty(service, 'db', { value: { transaction: async (handler: (value: unknown) => Promise<unknown>) => handler(tx) } });
  await assert.rejects(service.deleteManualModel('fixture-model-owner', 'manual', admin.id, 'remove-fixture-model'), /冻结团队版本/);
  assert.equal(deletes, 0); assert.equal(audits, 0);
  assert.ok(service.listAgentModelOptions().some(model => model.modelId === 'manual'));
});
