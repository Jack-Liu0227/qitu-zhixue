import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertParentGraph, parseAgentUpdate } from './agent-config.validation';

test('Agent update parser rejects unknown fields and duplicate bindings', () => {
  assert.throws(() => parseAgentUpdate({ roleDefinition: 'valid definition '.repeat(2), unknown: true }));
  assert.throws(() => parseAgentUpdate({ toolIds: ['tool.a', 'tool.a'] }));
  assert.deepEqual(parseAgentUpdate({
    label: 'Planner', roleDefinition: 'Use questions to help the learner plan.',
    agentDefinition: 'Follow the global policy.', skillIds: ['curriculum'], toolIds: ['tool.a'], enabled: true,
  }), {
    label: 'Planner', roleDefinition: 'Use questions to help the learner plan.',
    agentDefinition: 'Follow the global policy.', skillIds: ['curriculum'], toolIds: ['tool.a'], enabled: true,
  });
});

test('Agent model provider and model must be submitted as a pair', () => {
  assert.throws(() => parseAgentUpdate({ modelProviderId: 'openai' }));
  assert.throws(() => parseAgentUpdate({ modelId: 'gpt-4.1' }));
  assert.deepEqual(parseAgentUpdate({ modelProviderId: null, modelId: null }), {
    modelProviderId: null,
    modelId: null,
  });
});

test('Agent parent graph rejects self and cyclic inheritance', () => {
  assert.throws(() => assertParentGraph('child', 'child', []));
  assert.throws(() => assertParentGraph('child', 'parent', [
    { id: 'parent', parentAgentId: 'child' },
    { id: 'child', parentAgentId: null },
  ]));
  assert.doesNotThrow(() => assertParentGraph('child', 'parent', [
    { id: 'parent', parentAgentId: null },
  ]));
});
