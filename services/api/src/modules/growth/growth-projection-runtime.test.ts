import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { adminAssistants, adminTeams, pblTemplateTeamBindings, agentConfigs, agentRoutes, projectBindingSnapshots, type Database } from '@qitu/database';
import { provisionGrowthProjectionRuntime } from './growth-projection-runtime';

function fixture() {
  const assistants = [
    { id: 'profile-analyst-assistant', name: 'Profile', role: 'analysis', enabled: true },
    { id: 'live-leader', name: 'Live leader', role: 'teacher', enabled: true },
    { id: 'frozen-leader', name: 'Frozen leader', role: 'teacher', enabled: true },
    { id: 'disabled-leader', name: 'Disabled leader', role: 'teacher', enabled: false },
    { id: 'unrelated-assistant', name: 'Unrelated', role: 'teacher', enabled: true },
  ];
  const agents: Array<Record<string, unknown>> = [
    { id: 'qitu-learning-partner', enabled: true }, { id: 'live-leader', enabled: true },
    { id: 'frozen-leader', enabled: true }, { id: 'unrelated', enabled: true }, { id: 'disabled-leader', enabled: true },
    { id: 'learner-profile', enabled: true, modelId: 'legacy-model' },
  ];
  const routes: Array<Record<string, unknown>> = [];
  const tables = new Map<unknown, Array<Record<string, unknown>>>([
    [adminAssistants, assistants], [agentConfigs, agents], [agentRoutes, routes],
    [adminTeams, [{ id: 'live', enabled: true, leaderAssistantId: 'live-leader' }, { id: 'disabled', enabled: true, leaderAssistantId: 'disabled-leader' }]],
    [pblTemplateTeamBindings, [{ id: 'binding', teamSnapshots: { frozen: { id: 'frozen', enabled: true, leaderAssistantId: 'frozen-leader' }, unused: { id: 'unused', enabled: true, leaderAssistantId: 'unrelated' } } }]],
    [projectBindingSnapshots, [{ projectId: 'project', bindingId: 'binding', teamVersionId: 'frozen' }]],
  ]);
  const db = {
    select: () => ({ from: async (table: unknown) => tables.get(table) ?? [] }),
    insert: (table: unknown) => ({ values: (row: Record<string, unknown>) => ({ onConflictDoNothing: async () => {
      const target = tables.get(table)!;
      const exists = table === agentRoutes
        ? target.some((item) => ['fromAgentId', 'toAgentId', 'trigger', 'taskType'].every((key) => item[key] === row[key]))
        : target.some((item) => item.id === row.id);
      if (!exists) target.push({ ...row });
    } }) }),
  } as unknown as Database;
  return { db, agents, routes, assistants, tables };
}

const settings = { profileAssistantId: 'profile-analyst-assistant', growthAssistantId: null };

test('a newly provisioned historical alias has a distinct name without changing its routing identity', async () => {
  const f = fixture();
  f.assistants.push({ id: 'tutor-leader', name: 'Tutor', role: 'teacher', enabled: true });
  f.agents.splice(f.agents.findIndex(agent => agent.id === 'qitu-learning-partner'), 1);
  f.tables.get(adminTeams)!.push({ id: 'alias-team', leaderAssistantId: 'tutor-leader', enabled: true });
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  assert.equal(f.agents.find(agent => agent.id === 'tutor-leader')!.displayName, 'Tutor');
  assert.equal(f.agents.find(agent => agent.id === 'qitu-learning-partner')!.displayName, 'Tutor (qitu-learning-partner)');
  assert.ok(f.routes.some(route => route.fromAgentId === 'tutor-leader'));
  assert.ok(f.routes.some(route => route.fromAgentId === 'qitu-learning-partner'));
});

test('explicit binding creates canonical identity and routes only from real live/frozen leaders', async () => {
  const f = fixture();
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  const canonical = f.agents.find((row) => row.id === settings.profileAssistantId);
  assert.ok(canonical);
  assert.equal(canonical.modelId, undefined, 'Admin model is not copied into an independent configuration');
  assert.equal(canonical.agentDefinition, undefined);
  assert.deepEqual(canonical.capabilities, ['reflect']);
  assert.deepEqual(f.routes.map((row) => row.fromAgentId).sort(), ['frozen-leader', 'live-leader', 'qitu-learning-partner']);
  assert.ok(f.routes.every((row) => row.toAgentId === settings.profileAssistantId && row.trigger === 'event' && row.taskType === 'profile.project'));
  assert.equal(f.agents.find((row) => row.id === 'learner-profile')?.modelId, 'legacy-model');
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  assert.equal(f.routes.length, 3);
  assert.equal(f.agents.filter((row) => row.id === settings.profileAssistantId).length, 1);
});

test('explicit save provisions missing exact registered source leaders without provisioning unrelated Admin assistants', async () => {
  const f = fixture();
  for (const id of ['live-leader', 'frozen-leader']) {
    f.agents.splice(f.agents.findIndex((row) => row.id === id), 1);
  }
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  for (const id of ['live-leader', 'frozen-leader']) {
    const descriptor = f.agents.find((row) => row.id === id);
    assert.ok(descriptor);
    assert.deepEqual(descriptor.capabilities, ['teach']);
    assert.equal(descriptor.modelId, undefined);
    assert.equal(descriptor.agentDefinition, undefined);
    assert.ok(f.routes.some((row) => row.fromAgentId === id));
  }
  assert.equal(f.agents.some((row) => row.id === 'unrelated-assistant'), false);
});

test('explicit save grants the exact enabled server-declared free-exploration intake source', async () => {
  const f = fixture();
  f.assistants.push({ id: 'qitu-intake-assistant', name: 'Intake', role: 'teacher', enabled: true });
  f.agents.push({ id: 'qitu-intake-assistant', enabled: true });
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  const routes = f.routes.filter((row) => row.fromAgentId === 'qitu-intake-assistant');
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.toAgentId, settings.profileAssistantId);
  assert.equal(routes[0]?.trigger, 'event');
  assert.equal(routes[0]?.taskType, 'profile.project');
  assert.equal(f.agents.some((row) => row.id === 'unrelated-assistant'), false);
});

test('explicit save provisions a missing exact intake identity without broad assistant provisioning', async () => {
  const f = fixture();
  f.assistants.push({ id: 'qitu-intake-assistant', name: 'Intake', role: 'teacher', enabled: true });
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  const intake = f.agents.find((row) => row.id === 'qitu-intake-assistant');
  assert.ok(intake);
  assert.deepEqual(intake.capabilities, ['teach']);
  assert.equal(intake.modelId, undefined);
  assert.equal(intake.agentDefinition, undefined);
  assert.ok(f.routes.some((row) => row.fromAgentId === 'qitu-intake-assistant'));
  assert.equal(f.agents.some((row) => row.id === 'unrelated-assistant'), false);
});

test('intake routing requires current Admin authorization and preserves revoked runtime identity', async () => {
  for (const state of ['admin-disabled', 'runtime-disabled', 'admin-missing']) {
    const f = fixture();
    if (state !== 'admin-missing') f.assistants.push({ id: 'qitu-intake-assistant', name: 'Intake', role: 'teacher', enabled: state !== 'admin-disabled' });
    f.agents.push({ id: 'qitu-intake-assistant', enabled: state !== 'runtime-disabled' });
    await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
    assert.equal(f.routes.some((row) => row.fromAgentId === 'qitu-intake-assistant'), false, state);
    assert.equal(f.agents.find((row) => row.id === 'qitu-intake-assistant')?.enabled, state !== 'runtime-disabled', state);
    assert.equal(f.agents.filter((row) => row.id === 'qitu-intake-assistant').length, 1);
  }
});

test('an explicitly revoked source descriptor stays disabled and receives no new route', async () => {
  const f = fixture();
  const source = f.agents.find((row) => row.id === 'frozen-leader')!;
  source.enabled = false;
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  assert.equal(source.enabled, false);
  assert.equal(f.agents.filter((row) => row.id === 'frozen-leader').length, 1);
  assert.equal(f.routes.some((row) => row.fromAgentId === 'frozen-leader'), false);
});

test('a revoked historical leader identity cannot be bypassed by provisioning its canonical source alias', async () => {
  const f = fixture();
  f.assistants.push({ id: 'tutor-leader', name: 'Global leader', role: 'teacher', enabled: true });
  f.tables.get(adminTeams)!.push({ id: 'global', enabled: true, leaderAssistantId: 'tutor-leader' });
  f.agents.find((row) => row.id === 'qitu-learning-partner')!.enabled = false;
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  assert.equal(f.agents.some((row) => row.id === 'tutor-leader'), false);
  assert.equal(f.routes.some((row) => ['tutor-leader', 'qitu-learning-partner'].includes(String(row.fromAgentId))), false);
});

test('binding never re-enables revoked canonical descriptors or routes', async () => {
  const f = fixture();
  f.agents.push({ id: settings.profileAssistantId, enabled: false });
  await assert.rejects(provisionGrowthProjectionRuntime(f.db, settings, 'admin'), /GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE/);
  assert.equal(f.agents.at(-1)?.enabled, false);
  assert.equal(f.routes.length, 0);
  f.agents.at(-1)!.enabled = true;
  f.routes.push({ id: 'revoked', fromAgentId: 'qitu-learning-partner', toAgentId: settings.profileAssistantId,
    trigger: 'event', taskType: 'profile.project', enabled: false });
  await provisionGrowthProjectionRuntime(f.db, settings, 'admin');
  assert.equal(f.routes.find((row) => row.id === 'revoked')?.enabled, false);
  assert.equal(f.routes.filter((row) => row.fromAgentId === 'qitu-learning-partner').length, 1);
});

test('cleared purposes perform no implicit runtime provisioning', async () => {
  const f = fixture();
  await provisionGrowthProjectionRuntime(f.db, { profileAssistantId: null, growthAssistantId: null }, 'admin');
  assert.equal(f.routes.length, 0);
  assert.equal(f.agents.some((row) => row.id === settings.profileAssistantId), false);
});
