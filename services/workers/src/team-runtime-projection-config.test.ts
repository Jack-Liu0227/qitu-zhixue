import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAssistants, agentConfigs, modelModels, type Database } from '@qitu/database';
import { resolveProjectionExecutionConfig } from './team-runtime-projection-config';

function fixture() {
  const assistant = { id: 'canonical', enabled: true, name: 'Admin name', role: 'Admin role', instructions: 'Admin instructions',
    modelProviderId: 'chosen-provider' as string | null, modelId: 'shared-model' as string | null,
    enabledSkills: ['canonical-skill'], temperature: 0.2 };
  const descriptor = { id: 'canonical', enabled: true, displayName: 'Stale name', roleDefinition: 'Stale role',
    agentDefinition: 'Stale instructions', modelProviderId: 'old-provider', modelId: 'shared-model', capabilities: ['analyze'] };
  const model = { enabled: true, inputModalities: ['text'], outputModalities: ['text'] };
  const db = { select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () =>
    table === adminAssistants ? [assistant] : table === modelModels ? [model] : [],
  }) }) }) } as unknown as Database;
  return { assistant, descriptor: descriptor as typeof agentConfigs.$inferSelect, model, db };
}

test('canonical Admin inputs replace stale runtime model/prompt and are reread per task', async () => {
  const f = fixture();
  const current = await resolveProjectionExecutionConfig(f.db, f.descriptor);
  assert.deepEqual(current.model, { providerId: 'chosen-provider', modelId: 'shared-model' });
  assert.equal(current.agent.agentDefinition, 'Admin instructions');
  assert.equal(current.agent.roleDefinition, 'Admin role');
  assert.equal(current.agent.displayName, 'Admin name');
  assert.deepEqual(current.skillIds, ['canonical-skill']);
  assert.equal(current.temperature, 0.2);
  f.assistant.instructions = 'Updated Admin instructions';
  f.assistant.enabledSkills = [];
  const updated = await resolveProjectionExecutionConfig(f.db, f.descriptor);
  assert.equal(updated.agent.agentDefinition, 'Updated Admin instructions');
  assert.deepEqual(updated.skillIds, []);
  assert.equal(f.descriptor.agentDefinition, 'Stale instructions', 'reads do not dual-write configuration');
});

test('disabled identities, incomplete direct pair and incompatible models fail closed', async () => {
  const f = fixture();
  f.assistant.enabled = false;
  await assert.rejects(resolveProjectionExecutionConfig(f.db, f.descriptor), /PROJECTION_ASSISTANT_UNAVAILABLE/);
  f.assistant.enabled = true;
  f.descriptor.enabled = false;
  await assert.rejects(resolveProjectionExecutionConfig(f.db, f.descriptor), /PROJECTION_ASSISTANT_UNAVAILABLE/);
  f.descriptor.enabled = true;
  for (const missing of ['provider', 'model', 'both']) {
    f.assistant.modelProviderId = missing === 'model' ? 'chosen-provider' : null;
    f.assistant.modelId = missing === 'provider' ? 'shared-model' : null;
    await assert.rejects(resolveProjectionExecutionConfig(f.db, f.descriptor), /TEAM_AGENT_MODEL_NOT_CONFIGURED/);
  }
  f.assistant.modelProviderId = 'chosen-provider';
  f.assistant.modelId = 'shared-model';
  f.model.enabled = false;
  await assert.rejects(resolveProjectionExecutionConfig(f.db, f.descriptor), /TEAM_AGENT_MODEL_CAPABILITY_MISMATCH/);
  f.model.enabled = true;
  f.model.outputModalities = ['audio'];
  await assert.rejects(resolveProjectionExecutionConfig(f.db, f.descriptor), /TEAM_AGENT_MODEL_CAPABILITY_MISMATCH/);
});
