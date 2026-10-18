import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import { adminAssistants, agentConfigs, agentMcpBindings, runtimeMcpServers, type Database } from '@qitu/database';
import { ImaSettingsService, parseImaPatch } from './ima-settings.service';
import { ImaSettingsController } from './ima-settings.controller';

function fixture() {
  const server = { id: 'ima-knowledge', label: 'ima', enabled: true, toolIds: ['ima_list_knowledge_bases'], status: 'connected',
    endpointOrigin: 'https://user:secret@example.com/mcp?token=secret', secretRef: 'private-token', lastError: 'secret upstream error', lastCheckedAt: new Date() };
  const agent = { id: 'qitu-learning-partner', displayName: '学习搭档', enabled: true };
  const assistant = { id: 'kinetic-concept-coach', name: '原理教练', enabled: true, mcpServerIds: ['ima-knowledge'] };
  const leader = { id: 'tutor-leader', name: '总导师', enabled: true, mcpServerIds: ['ima-knowledge'] };
  const binding = { agentId: agent.id, mcpServerId: server.id, enabled: true, allowedToolIds: [...server.toolIds] };
  const db = { select: () => ({ from: (table: unknown) => Promise.resolve(
    table === runtimeMcpServers ? [server] : table === agentConfigs ? [agent] : table === agentMcpBindings ? [binding] : table === adminAssistants ? [assistant, leader] : [],
  ) }) } as unknown as Database;
  const service = new ImaSettingsService(db, { write: async () => 'audit' } as never);
  return { service, server, agent, assistant, leader, binding, db };
}

test('ima gates require global, runtime binding, tool allowlist and current phase assistant; revocation is immediate', async () => {
  const h = fixture();
  const allowed = () => h.service.canCall(h.agent.id, 'ima_list_knowledge_bases', h.assistant.id);
  assert.equal(await allowed(), true);
  h.server.enabled = false; assert.equal(await allowed(), false); h.server.enabled = true;
  h.binding.enabled = false; assert.equal(await allowed(), false); h.binding.enabled = true;
  h.agent.enabled = false; assert.equal(await allowed(), false); h.agent.enabled = true;
  h.assistant.enabled = false; assert.equal(await allowed(), false); h.assistant.enabled = true;
  h.assistant.mcpServerIds = []; assert.equal(await allowed(), false); h.assistant.mcpServerIds = ['ima-knowledge'];
  h.binding.allowedToolIds = []; assert.equal(await allowed(), false); h.binding.allowedToolIds = ['ima_list_knowledge_bases'];
  h.leader.enabled = false; assert.equal(await allowed(), false); h.leader.enabled = true;
  assert.equal(await allowed(), true);
  assert.equal(await h.service.canCall(h.agent.id, 'evil_write', h.assistant.id), false);
  assert.equal(await h.service.canCall(h.agent.id, 'ima_list_knowledge_bases', 'unknown-assistant'), false);
  assert.equal(await h.service.canCall('unknown-agent', 'ima_list_knowledge_bases'), false);
});

test('ima authorization fails closed when database is unavailable', async () => {
  assert.equal(await new ImaSettingsService(null, {} as never).canCall('a', 'ima_list_knowledge_bases'), false);
  const db = { select: () => { throw new Error('offline'); } } as unknown as Database;
  assert.equal(await new ImaSettingsService(db, {} as never).canCall('a', 'ima_list_knowledge_bases'), false);
});

test('ima admin projection redacts credentials, URL credentials and raw upstream errors', async () => {
  const h = fixture();
  const state = await h.service.getSettings();
  assert.equal(state.endpointOrigin, 'https://example.com');
  assert.equal(state.assistants.find((row) => row.id === h.assistant.id)?.authorized, true);
  assert.doesNotMatch(JSON.stringify(state), /secret|private-token|upstream error/);
});

test('ima JSON whitelist rejects unknown fields, injected URLs, credentials, duplicate ids and invalid booleans', () => {
  for (const body of [null, [], {}, { enabled: 'false' }, { endpoint: 'https://example.com' }, { token: 'secret' },
    { assistantBindings: [{ id: 'a', enabled: true }, { id: 'a', enabled: false }] }, { agentBindings: [{ id: 'a', enabled: 1 }] },
    { assistantBindings: [{ id: 'a', enabled: true, enabledRole: true }] }]) {
    assert.throws(() => parseImaPatch(body));
  }
  assert.deepEqual(parseImaPatch({ enabled: false, assistantBindings: [{ id: 'a', enabled: true }] }), { enabled: false, assistantBindings: [{ id: 'a', enabled: true }] });
});

test('all ima settings endpoints require an administrator before reading, mutating or probing', async () => {
  let touched = 0;
  for (const role of ['student', 'teacher', 'parent'] as const) {
    const auth = { getSession: () => ({ user: { id: 'user', role } }) };
    const service = { getSettings: async () => touched++, update: async () => touched++, probe: async () => touched++ };
    const controller = new ImaSettingsController(auth as never, service as never, {} as never);
    await assert.rejects(() => controller.get('qitu_session=test'), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
    await assert.rejects(() => controller.update('qitu_session=test', 'key', { enabled: false }));
    await assert.rejects(() => controller.check('qitu_session=test', 'key'));
    await assert.rejects(() => controller.get(undefined), (error: unknown) => (error as { getStatus(): number }).getStatus() === 401);
  }
  assert.equal(touched, 0);
});

test('ima mutations require an idempotency key and do not touch storage when missing', async () => {
  const auth = { getSession: () => ({ user: { id: 'admin', role: 'admin' } as CurrentUser }) };
  const controller = new ImaSettingsController(auth as never, {} as never, {} as never);
  await assert.rejects(() => controller.update('qitu_session=test', undefined, { enabled: false }), (error: unknown) => (error as { getStatus(): number }).getStatus() === 400);
  await assert.rejects(() => controller.check('qitu_session=test', undefined));
});


test('unified knowledge capability revocation also blocks legacy ima MCP for project dialogue', async () => {
  const h = fixture();
  let allowed = true;
  const center = {
    canRetrieve: async (id: string) => allowed && id === h.assistant.id,
    configuration: async () => ({config: {knowledgeEngines: {'ima-main': {enabled: true, config: {allowedKnowledgeBaseIds: ['approved']}}}}}),
  };
  const service = new ImaSettingsService(h.db, {} as never, center as never);
  assert.equal(await service.canCall(h.agent.id, 'ima_list_knowledge_bases', h.assistant.id), true);
  allowed = false;
  assert.equal(await service.canCall(h.agent.id, 'ima_list_knowledge_bases', h.assistant.id), false);
  assert.equal(await service.canCall(h.agent.id, 'ima_list_knowledge_bases'), false);
});
