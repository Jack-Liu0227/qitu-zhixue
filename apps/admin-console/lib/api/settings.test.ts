import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSettingsBadgeStates } from './settings';

test('one failed settings domain does not discard other badge states', async () => {
  const states = await loadSettingsBadgeStates(
    [{ id: 'assistants' }, { id: 'teams' }],
    async (item) => {
      if (item.id === 'assistants') throw new Error('assistant endpoint unavailable');
      return '2 支 · 已启用 1';
    },
  );

  assert.deepEqual(states, {
    assistants: { phase: 'error', value: '读取失败' },
    teams: { phase: 'ready', value: '2 支 · 已启用 1' },
  });
});
