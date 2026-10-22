import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { assistantRuntimeFixture } from './assistant-runtime.test-fixture';
import { ImaSettingsService } from './ima-settings.service';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';

const actor = { id: 'synthetic-admin', role: 'admin', email: '', displayName: '' } as const;

test('a published teaching role retains all granted skills without an aggregate character ceiling', async () => {
  const h = assistantRuntimeFixture();
  h.assistant.enabledSkills = ['tutor-guided-learning', 'pbl-concept-probe', 'pbl-understanding-coach',
    'pbl-source-literacy', 'pbl-visual-explainer', 'pbl-independent-transfer', 'pbl-dynamic-lesson'];
  h.assistant.toolIds.push('tutor.propose_lesson_activity');
  const source = loadTutorRuntimeSource();
  const runtime = await h.service.getAssistantRuntime(h.assistant.id);
  assert.deepEqual(runtime.skills.map(skill => skill.id).sort(), [...h.assistant.enabledSkills].sort());
  assert.ok(runtime.skills.reduce((sum, skill) => sum + skill.content.length, 0) > 24_000);
  for (const skill of runtime.skills) {
    const published = source.skills.find(entry => entry.id === skill.id);
    assert.equal(skill.content, published?.content);
    assert.equal(skill.contentHash, published?.contentHash);
  }
});

test('Admin-only teaching assistant uses its exact provider/model, prompt, skills and tools', async () => {
  const h = assistantRuntimeFixture();
  h.configs.push(h.runtimeConfig('qitu-learning-partner'));
  const runtime = await h.service.getAssistantRuntime(h.assistant.id);
  assert.equal(runtime.agent.id, h.assistant.id);
  assert.equal(runtime.agent.label, h.assistant.name);
  assert.equal(runtime.agent.roleDefinition, h.assistant.role);
  assert.equal(runtime.agent.agentDefinition, h.assistant.instructions);
  assert.equal(runtime.agent.modelProviderId, 'chosen-provider');
  assert.equal(runtime.agent.modelId, 'same-model-name');
  assert.equal(runtime.agent.modelLabel, 'chosen-provider model');
  assert.equal(runtime.agent.modelAvailable, true);
  assert.deepEqual(runtime.skills.map((skill) => skill.id), h.assistant.enabledSkills);
  assert.deepEqual(runtime.tools.map((tool) => tool.id), h.assistant.toolIds);
  assert.equal(runtime.mcpServers[0]?.serverId, 'ima-knowledge');
  assert.doesNotMatch(JSON.stringify(runtime), /UNRELATED_RUNTIME/);
  h.assistant.modelProviderId = 'missing-provider';
  const unavailable = await h.service.getAssistantRuntime(h.assistant.id);
  assert.equal(unavailable.agent.modelAvailable, false);
  assert.equal(unavailable.agent.modelProviderId, 'missing-provider');
  assert.equal(unavailable.agent.modelId, 'same-model-name');
});

test('Admin skill PATCH is the teaching read source, and audit failure rolls back instead of dual-writing bindings', async () => {
  const h = assistantRuntimeFixture();
  await h.service.updateAssistant(actor, h.assistant.id, { enabledSkills: [] });
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).skills, []);
  h.setFailAudit(true);
  await assert.rejects(h.service.updateAssistant(actor, h.assistant.id, { enabledSkills: ['tutor-guided-learning'] }));
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).skills, []);
  h.setFailAudit(false);
  await h.service.updateAssistant(actor, h.assistant.id, { enabledSkills: ['tutor-guided-learning'] });
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).skills.map((skill) => skill.id), ['tutor-guided-learning']);
});

test('missing assistant, unavailable skill and unreadable authorization storage never fall back', async () => {
  const h = assistantRuntimeFixture();
  await assert.rejects(h.service.getAssistantRuntime('qitu-learning-partner'), NotFoundException);
  h.assistant.enabledSkills = ['not-a-published-skill'];
  await assert.rejects(h.service.getAssistantRuntime(h.assistant.id), ConflictException);
  h.assistant.enabledSkills = [];
  h.setStorageAvailable(false);
  await assert.rejects(h.service.getAssistantRuntime(h.assistant.id), /SYNTHETIC_STORAGE_UNAVAILABLE/);
});

test('Admin catalog visibility never grants management skills to ordinary assistants, including legacy persisted bindings', async () => {
  const h = assistantRuntimeFixture();
  const enabledSkills = ['qitu-project-configurator'];
  const invalidScope = (error: unknown) => {
    const response = (error as { getResponse(): { code: string } }).getResponse();
    return response.code === 'ASSISTANT_SKILL_SCOPE_INVALID';
  };
  await assert.rejects(h.service.createAssistant(actor, {
    name: 'Scope fixture', role: 'coach', instructions: 'Guide learning safely.', enabledSkills,
  } as never), invalidScope);
  await assert.rejects(h.service.updateAssistant(actor, h.assistant.id, { enabledSkills }), invalidScope);
  h.assistant.enabledSkills = enabledSkills;
  await assert.rejects(h.service.getAssistantRuntime(h.assistant.id), ConflictException);
  await assert.rejects(h.service.updateAssistant(actor, h.assistant.id, { enabledSkills }), invalidScope);
  await h.service.updateAssistant(actor, h.assistant.id, { enabledSkills: [] });
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).skills, []);
});

test('explicit historical leader alias preserves runtime disable, capability and MCP tool restrictions', async () => {
  const h = assistantRuntimeFixture();
  h.assistant.id = 'tutor-leader';
  const legacy = h.runtimeConfig('qitu-learning-partner');
  h.configs.push(legacy);
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).mcpServers, []);
  legacy.enabled = false;
  assert.equal((await h.service.getAssistantRuntime(h.assistant.id)).agent.enabled, false);
  legacy.enabled = true;
  legacy.capabilities = [];
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).agent.capabilities, []);
  legacy.capabilities = ['teach'];
  h.bindings.push({ agentId: legacy.id, mcpServerId: h.server.id, enabled: true,
    allowedToolIds: ['ima_list_knowledge_bases'], updatedAt: new Date() });
  assert.deepEqual((await h.service.getAssistantRuntime(h.assistant.id)).mcpServers[0]?.toolIds, ['ima_list_knowledge_bases']);
});

test('same-identity IMA calls recheck current Admin grants and exact/legacy runtime deny on every invocation', async () => {
  const h = assistantRuntimeFixture();
  const ima = new ImaSettingsService(h.db, {} as never);
  const allowed = () => ima.canCall(h.assistant.id, 'ima_list_knowledge_bases', h.assistant.id);
  assert.equal(await allowed(), true);
  h.assistant.mcpServerIds = [];
  assert.equal(await allowed(), false);
  h.assistant.mcpServerIds = ['ima-knowledge'];
  h.server.enabled = false;
  assert.equal(await allowed(), false);
  h.server.enabled = true;
  h.assistant.id = 'tutor-leader';
  const legacy = h.runtimeConfig('qitu-learning-partner');
  h.configs.push(legacy);
  h.bindings.push({ agentId: legacy.id, mcpServerId: h.server.id, enabled: true,
    allowedToolIds: ['ima_list_knowledge_bases'], updatedAt: new Date() });
  assert.equal(await allowed(), true);
  legacy.enabled = false;
  assert.equal(await allowed(), false);
  legacy.enabled = true;
  h.bindings[0]!.allowedToolIds = [];
  assert.equal(await allowed(), false);
  h.setStorageAvailable(false);
  assert.equal(await allowed(), false);
});
