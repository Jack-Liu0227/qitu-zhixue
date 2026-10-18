import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_CATALOG,
  validateKnowledgeConfig,
  KNOWLEDGE_TOOL,
  type PlatformKnowledgeConfig,
} from './knowledge-center.config';
import { ENGINE_DEFINITIONS, engineDefinition } from './knowledge-engine.catalog';
import { KnowledgeAdapterRegistry, ImaKnowledgeAdapter } from './knowledge-engine.adapters';
import { ImaMcpClient } from '../ai-tutor/ima-mcp.client';

test('DeepTutor catalog covers every engine, mode and editable upstream field without credentials', () => {
  assert.deepEqual(
    new Set(ENGINE_DEFINITIONS.map((d) => d.provider)),
    new Set(ENGINE_CATALOG.map((d) => d[0])),
  );
  for (const d of ENGINE_DEFINITIONS) {
    assert.equal(new Set(d.fields.map((f) => f.key)).size, d.fields.length);
    assert.ok(d.description && d.prerequisites);
    assert.ok(d.fields.every((f) => !/api_key|token|password/i.test(f.key)));
  }
  assert.deepEqual(engineDefinition('graphrag').modes, ['local', 'global', 'drift', 'basic']);
  assert.deepEqual(engineDefinition('lightrag').modes, [
    'naive',
    'local',
    'global',
    'hybrid',
    'mix',
  ]);
});
const current: PlatformKnowledgeConfig = {
  mcpServers: {},
  knowledgeEngines: {},
  platformTools: { 'project-knowledge': { ...KNOWLEDGE_TOOL, enabled: false, boundAssistants: [] } },
};
test('upstream field names and defaults round-trip through the unified configuration validator', () => {
  for (const definition of ENGINE_DEFINITIONS) {
    const config = Object.fromEntries(
      definition.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]),
    );
    const engine = {
      name: definition.provider,
      description: definition.description,
      enabled: false,
      provider: definition.provider,
      config,
    };
    const saved = validateKnowledgeConfig(
      { knowledgeEngines: { [definition.provider]: engine } },
      current,
    );
    assert.deepEqual(saved.knowledgeEngines[definition.provider], engine);
  }
});
test('engine form cannot bypass field ranges, modes, secret or connection validation', () => {
  const validate = (config: Record<string, unknown>) =>
    validateKnowledgeConfig(
      {
        knowledgeEngines: {
          test: { name: 'test', description: '', enabled: false, provider: 'llamaindex', config },
        },
      },
      current,
    );
  assert.throws(() => validate({ vector_top_k_multiplier: 0 }));
  assert.throws(() => validate({ hnsw_m: 1000 }));
  assert.throws(() => validate({ retrieval_profile: 'fake' }));
  assert.throws(() => validate({ api_key: 'private' }));
  assert.throws(() => validate({ chunk_size: 128, chunk_overlap: 128 }));
  assert.throws(() => validate({ vector_candidate_multiplier: 100 }));
});
test('remote adapter dispatches actual upstream operations, never reports success without a runtime', async () => {
  const calls: Record<string, unknown>[] = [];
  const registry = new KnowledgeAdapterRegistry(async (_e, input) => {
    calls.push(input);
    return { ok: true, status: 'ready' };
  });
  const engine = {
    name: 'test',
    description: '',
    enabled: true,
    provider: 'lightrag-server',
    config: {},
  };
  await registry.get(engine.provider)!.connect(engine, { serverUrl: 'https://example.com' });
  await registry.get(engine.provider)!.search(engine, { query: 'evidence' });
  assert.equal(calls[0]!.operation, 'connect');
  assert.equal(calls[1]!.operation, 'search');
  assert.equal((await registry.get(engine.provider)!.create(engine, {})).ok, false);
});
test('ima account check accepts real catalog; search respects the saved remote-library allowlist', async () => {
  const original = ImaMcpClient.prototype.toolsFor;
  const prevUrl = process.env.QITU_IMA_MCP_URL,
    prevToken = process.env.QITU_IMA_MCP_TOKEN;
  process.env.QITU_IMA_MCP_URL = 'http://127.0.0.1:9999';
  process.env.QITU_IMA_MCP_TOKEN = 'test-token-not-a-real-secret';
  let searches = 0;
  ImaMcpClient.prototype.toolsFor = async () => [
    {
      name: 'ima_list_knowledge_bases',
      description: '',
      inputSchema: {},
      execute: async () => ({
        isError: false,
        text: JSON.stringify({ knowledge_bases: [{ knowledge_base_id: 'allowed' }] }),
      }),
    },
    {
      name: 'ima_search_knowledge',
      description: '',
      inputSchema: {},
      execute: async () => {
        searches++;
        return { isError: false, text: JSON.stringify({ items: [] }) };
      },
    },
  ];
  try {
    const adapter = new ImaKnowledgeAdapter();
    const engine = {
      name: 'ima',
      description: '',
      enabled: true,
      provider: 'ima',
      config: { allowedKnowledgeBaseIds: ['allowed'] },
    };
    assert.equal((await adapter.check(engine)).ok, true);
    assert.equal((await adapter.connect(engine, { remoteKnowledgeBaseId: 'allowed' })).ok, true);
    assert.equal(
      (await adapter.search(engine, { remoteKnowledgeBaseId: 'foreign', query: 'x' })).ok,
      false,
    );
    assert.equal(searches, 0);
    assert.equal(
      (await adapter.search(engine, { remoteKnowledgeBaseId: 'allowed', query: 'x' })).ok,
      true,
    );
    assert.equal(searches, 1);
  } finally {
    ImaMcpClient.prototype.toolsFor = original;
    if (prevUrl === undefined) delete process.env.QITU_IMA_MCP_URL;
    else process.env.QITU_IMA_MCP_URL = prevUrl;
    if (prevToken === undefined) delete process.env.QITU_IMA_MCP_TOKEN;
    else process.env.QITU_IMA_MCP_TOKEN = prevToken;
  }
});
