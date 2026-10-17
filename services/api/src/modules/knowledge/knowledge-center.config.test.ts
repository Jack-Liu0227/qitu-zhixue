import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_TOOL,
  assertAssistantsBindable,
  parseAssistantBindingsInput,
  validateKnowledgeConfig,
  type PlatformKnowledgeConfig,
} from './knowledge-center.config';
function baseline(): PlatformKnowledgeConfig {
  return {
    mcpServers: {
      existing: { name: 'Existing', enabled: false, transport: 'streamable_http', tools: [] },
    },
    knowledgeEngines: {
      'ima-main': {
        name: 'ima',
        description: '',
        provider: 'ima',
        enabled: false,
        config: { allowedKnowledgeBaseIds: [], allowMaterialize: false },
      },
    },
    platformTools: {
      'project-knowledge': { ...PROJECT_TOOL, enabled: false, boundAssistants: [] },
    },
  };
}
test('legacy MCP imports preserve engine and platform authorization', () => {
  const current = baseline();
  assert.deepEqual(validateKnowledgeConfig({ mcpServers: current.mcpServers }, current), current);
});
test('empty source whitelist remains empty and null does not silently become wildcard', () => {
  const current = baseline();
  assert.deepEqual(
    validateKnowledgeConfig(current, current).knowledgeEngines['ima-main']!.config
      .allowedKnowledgeBaseIds,
    [],
  );
  const next = structuredClone(current);
  next.knowledgeEngines['ima-main']!.config.allowedKnowledgeBaseIds = null;
  assert.equal(
    validateKnowledgeConfig(next, current).knowledgeEngines['ima-main']!.config
      .allowedKnowledgeBaseIds,
    null,
  );
});
test('rejects scope escape, writable health, arbitrary tools and provider replacement', () => {
  for (const mutate of [
    (c: PlatformKnowledgeConfig) => {
      c.knowledgeEngines['ima-main']!.config.allowCrossLibraryFallback = true;
    },
    (c: PlatformKnowledgeConfig) => {
      Object.assign(c.knowledgeEngines['ima-main']!, { health_status: 'ready' });
    },
    (c: PlatformKnowledgeConfig) => {
      c.platformTools['project-knowledge'].tools.push('ima_search');
    },
    (c: PlatformKnowledgeConfig) => {
      c.knowledgeEngines['ima-main']!.provider = 'llamaindex';
    },
    (c: PlatformKnowledgeConfig) => {
      c.platformTools['project-knowledge'].boundAssistants = ['a', 'a'];
    },
  ]) {
    const current = baseline();
    const draft = structuredClone(current);
    mutate(draft);
    assert.throws(() => validateKnowledgeConfig(draft, current));
  }
});
test('global omission cannot delete an existing engine; invalid edits leave input untouched', () => {
  const current = baseline();
  const before = structuredClone(current);
  assert.throws(() => validateKnowledgeConfig({ ...current, knowledgeEngines: {} }, current));
  assert.deepEqual(current, before);
});

test('assistant binding input parsing rejects malformed payloads', () => {
  assert.deepEqual(parseAssistantBindingsInput({ expectedRevision: 3, assistantIds: ['a', 'b'] }), {
    expectedRevision: 3,
    assistantIds: ['a', 'b'],
  });
  assert.throws(() => parseAssistantBindingsInput({ assistantIds: [] }), /expectedRevision/);
  assert.throws(() => parseAssistantBindingsInput({ expectedRevision: 1 }), /assistantIds/);
  assert.throws(() => parseAssistantBindingsInput({ expectedRevision: 1, assistantIds: ['a', 'a'] }));
  assert.throws(() => parseAssistantBindingsInput({ expectedRevision: 1, assistantIds: ['x'.repeat(161)] }));
});

test('assistant binding requires every bound assistant to exist and be enabled', () => {
  const rows = [
    { id: 'tutor-leader', enabled: true },
    { id: 'offline-agent', enabled: false },
  ];
  assertAssistantsBindable(['tutor-leader'], rows);
  assert.throws(() => assertAssistantsBindable(['missing'], rows), /助手不存在或未启用/);
  assert.throws(() => assertAssistantsBindable(['offline-agent'], rows), /助手不存在或未启用/);
});
