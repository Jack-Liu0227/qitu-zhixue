import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCopilotCatalog,
  createCopilotCatalogLoader,
  resolveCopilotSelection,
  resolveCopilotTeamSelection,
} from '../apps/admin-console/lib/copilot/assistant-catalog.ts';

const assistant = (id, extra = {}) => ({
  id, name: id, role: 'Coach', instructions: 'Server instructions', enabled: true, sortOrder: 0, ...extra,
});
const team = (id, ids, extra = {}) => ({
  id, name: id, enabled: true, leaderAssistantId: ids[0] ?? '',
  members: ids.map((assistantId) => ({ assistantId })), ...extra,
});

test('assistants and teams are independent registries', () => {
  const catalog = buildCopilotCatalog([
    assistant('qitu-assistant'), assistant('coach'), assistant('disabled', { enabled: false }),
  ], [team('live-team', ['coach']), team('retired-team', ['coach'], { enabled: false })]);
  assert.deepEqual(catalog.assistants.map((item) => item.id), ['coach', 'qitu-assistant']);
  assert.deepEqual(catalog.teams, [{ id: 'live-team', name: 'live-team', memberCount: 1, leaderAssistantId: 'coach' }]);
});

test('a disabled assistant never appears even when a team still references it', () => {
  const catalog = buildCopilotCatalog([
    assistant('coach', { name: 'Renamed coach', avatar: 'coach.svg' }), assistant('disabled', { enabled: false }),
  ], [team('optics', ['coach', 'coach', 'disabled', 'deleted'])]);
  assert.deepEqual(catalog.assistants, [{
    id: 'coach', name: 'Renamed coach', role: 'Coach', icon: 'coach.svg', systemPrompt: 'Server instructions',
  }]);
  assert.deepEqual(catalog.teams, [{ id: 'optics', name: 'optics', memberCount: 1, leaderAssistantId: 'coach' }]);
});

test('assistant and team selection reset only their own deleted value', () => {
  const catalog = buildCopilotCatalog([assistant('coach'), assistant('qitu-assistant')], [team('optics', ['coach'])]);
  assert.equal(resolveCopilotSelection(catalog.assistants, 'coach'), 'coach');
  assert.equal(resolveCopilotSelection(catalog.assistants, 'deleted'), 'qitu-assistant');
  assert.equal(resolveCopilotTeamSelection(catalog.teams, 'optics'), 'optics');
  assert.equal(resolveCopilotTeamSelection(catalog.teams, 'deleted'), '');
});

test('newer refresh wins even when an old response arrives after a team deletion', async () => {
  let oldAssistants;
  let oldTeams;
  let loads = 0;
  const states = [];
  const loader = createCopilotCatalogLoader({
    loadAssistants: () => ++loads === 1
      ? new Promise((resolve) => { oldAssistants = resolve; })
      : Promise.resolve([assistant('qitu-assistant')]),
    loadTeams: () => loads === 1
      ? new Promise((resolve) => { oldTeams = resolve; })
      : Promise.resolve([]),
    onChange: (state) => states.push(state),
  });
  const old = loader.refresh();
  await loader.refresh();
  oldAssistants([assistant('old-coach')]); oldTeams([team('deleted-team', ['old-coach'])]);
  await old;
  assert.deepEqual(states.map((state) => state.kind), ['loading', 'loading', 'ready']);
  assert.deepEqual(states.at(-1).catalog.assistants.map((item) => item.id), ['qitu-assistant']);
  assert.deepEqual(states.at(-1).catalog.teams, []);
});

test('partial API failure clears the catalog instead of retaining cached options; retry recovers', async () => {
  const states = [];
  let failed = true;
  const loader = createCopilotCatalogLoader({
    loadAssistants: async () => [assistant('qitu-assistant')],
    loadTeams: async () => { if (failed) throw new Error('403'); return []; },
    onChange: (state) => states.push(state),
  });
  assert.equal(await loader.refresh(), null);
  assert.equal(states.at(-1).kind, 'unavailable');
  failed = false;
  await loader.refresh();
  assert.equal(states.at(-1).kind, 'ready');
  assert.deepEqual(states.at(-1).catalog.assistants.map((item) => item.id), ['qitu-assistant']);
});

test('offline invalidation and unmount prevent in-flight responses from restoring selectable options', async () => {
  for (const action of ['offline', 'dispose']) {
    const states = [];
    let finish;
    const loader = createCopilotCatalogLoader({
      loadAssistants: () => new Promise((resolve) => { finish = resolve; }), loadTeams: async () => [],
      onChange: (state) => states.push(state),
    });
    const pending = loader.refresh();
    if (action === 'offline') loader.unavailable(new Error('offline'));
    else loader.dispose();
    finish([assistant('deleted')]); await pending;
    assert.equal(states.at(-1).kind, action === 'offline' ? 'unavailable' : 'loading');
  }
});
