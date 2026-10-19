import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCopilotAssistantGroups, createCopilotCatalogLoader, resolveCopilotSelection } from '../apps/admin-console/lib/copilot/assistant-catalog.ts';

const assistant = (id, extra = {}) => ({ id, name: id, role: 'Coach', instructions: 'Server instructions', enabled: true, sortOrder: 0, ...extra });
const team = (id, ids, extra = {}) => ({ id, name: id, enabled: true, members: ids.map((assistantId) => ({ assistantId })), ...extra });

test('groups reflect actual teams; deleting a team does not resurrect its group or delete its remaining assistants', () => {
  const assistants = [assistant('qitu-assistant'), assistant('coach')];
  const before = buildCopilotAssistantGroups(assistants, [team('live-team', ['coach'])]);
  assert.deepEqual(before.map((group) => [group.label, group.assistants.map((a) => a.id)]), [
    ['未分组助手', ['qitu-assistant']], ['live-team', ['coach']],
  ]);
  const after = buildCopilotAssistantGroups(assistants, []);
  assert.deepEqual(after.map((group) => [group.label, group.assistants.map((a) => a.id)]), [
    ['未分组助手', ['coach', 'qitu-assistant']],
  ]);
});

test('renames and enabled state come from the assistant owner, never stale member labels', () => {
  const groups = buildCopilotAssistantGroups([
    assistant('coach', { name: 'Renamed coach', avatar: 'coach.svg' }), assistant('disabled', { enabled: false }),
  ], [team('optics', ['coach', 'coach', 'disabled', 'deleted']), team('retired', ['coach'], { enabled: false })]);
  assert.deepEqual(groups, [{ id: 'optics', label: 'optics', assistants: [
    { id: 'coach', name: 'Renamed coach', role: 'Coach', icon: 'coach.svg', systemPrompt: 'Server instructions' },
  ] }]);
});

test('selection preserves valid ids, resets deleted ids to the live manager, and does not invent a fallback', () => {
  const groups = buildCopilotAssistantGroups([assistant('coach'), assistant('qitu-assistant')], []);
  assert.equal(resolveCopilotSelection(groups, 'coach'), 'coach');
  assert.equal(resolveCopilotSelection(groups, 'deleted'), 'qitu-assistant');
  assert.equal(resolveCopilotSelection(buildCopilotAssistantGroups([assistant('coach')], []), 'deleted'), 'coach');
  assert.equal(resolveCopilotSelection([], 'deleted'), '');
});

test('newer refresh wins even when an old response arrives after a team deletion', async () => {
  let oldAssistants;
  let oldTeams;
  let loads = 0;
  const states = [];
  const loader = createCopilotCatalogLoader({
    loadAssistants: () => ++loads === 1 ? new Promise((resolve) => { oldAssistants = resolve; }) : Promise.resolve([assistant('qitu-assistant')]),
    loadTeams: () => loads === 1 ? new Promise((resolve) => { oldTeams = resolve; }) : Promise.resolve([]),
    onChange: (state) => states.push(state),
  });
  const old = loader.refresh();
  await loader.refresh();
  oldAssistants([assistant('old-coach')]); oldTeams([team('deleted-team', ['old-coach'])]);
  await old;
  assert.deepEqual(states.map((state) => state.kind), ['loading', 'loading', 'ready']);
  assert.deepEqual(states.at(-1).groups.map((group) => group.assistants.map((a) => a.id)), [['qitu-assistant']]);
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
  assert.equal(states.at(-1).error.message, '403');
  failed = false;
  await loader.refresh();
  assert.equal(states.at(-1).kind, 'ready');
  assert.equal(states.at(-1).groups[0].assistants[0].id, 'qitu-assistant');
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
