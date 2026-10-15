import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAgentModelSelection } from './agent-model-selection';

test('unassigned Agent follows its configured scenario, not an arbitrary model', () => {
  const resolved = resolveAgentModelSelection({ modelProviderId: null, modelId: null, modelUsage: 'curriculum.plan' },
    (usage) => usage === 'curriculum.plan' ? { providerId: 'provider', modelId: 'planner' } : null);
  assert.deepEqual(resolved, { providerId: 'provider', modelId: 'planner' });
});
test('explicit and incomplete selections never silently use the scenario fallback', () => {
  for (const modelId of ['explicit', null]) {
    assert.deepEqual(resolveAgentModelSelection({ modelProviderId: 'chosen', modelId, modelUsage: 'tutor.chat' },
      () => { throw new Error('must not fall back'); }), { providerId: 'chosen', modelId });
  }
});
test('unbound scenario remains unavailable', () => {
  assert.deepEqual(resolveAgentModelSelection({ modelProviderId: null, modelId: null, modelUsage: 'tutor.chat' }, () => null),
    { providerId: null, modelId: null });
});
