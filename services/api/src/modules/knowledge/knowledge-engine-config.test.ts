import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateKnowledgeConfig,
  KNOWLEDGE_TOOL,
  type PlatformKnowledgeConfig,
} from './knowledge-center.config';
import { KnowledgeCenterController } from './knowledge-center.controller';

const initial = (): PlatformKnowledgeConfig => ({
  mcpServers: {},
  knowledgeEngines: {},
  platformTools: {
    'project-knowledge': { ...KNOWLEDGE_TOOL, enabled: false, boundAssistants: [] },
  },
});
test('remote engine JSON accepts URL, provider IDs and editable API keys', () => {
  for (const provider of ['lightrag-server', 'pageindex', 'ima', 'weknora']) {
    const current = initial();
    const config = {
      server_url: provider === 'ima' ? 'https://ima.qq.com' : 'https://api.example.org',
      apiKey: 'editable-fixture-key',
      ...(provider === 'ima' ? { clientId: 'account' } : {}),
      ...(provider === 'weknora' ? { remoteKnowledgeBaseId: 'kb-1' } : {}),
    };
    const next = validateKnowledgeConfig(
      {
        knowledgeEngines: {
          [`${provider}-main`]: {
            name: provider,
            provider,
            description: '',
            enabled: false,
            config,
          },
        },
      },
      current,
    );
    assert.deepEqual(next.knowledgeEngines[`${provider}-main`]!.config, config);
  }
});
test('editable remote keys do not permit arbitrary credential fields, malformed keys, or local-engine secrets', () => {
  for (const [provider, config] of [
    ['ima', { apiKey: 'line\nheader' }],
    ['ima', { authorization: 'secret' }],
    ['llamaindex', { apiKey: 'key' }],
    ['ima', { server_url: 'https://user:password@example.org' }],
  ] as const) {
    assert.throws(() =>
      validateKnowledgeConfig(
        {
          knowledgeEngines: {
            main: { name: provider, provider, description: '', enabled: false, config },
          },
        },
        initial(),
      ),
    );
  }
});
test('unsaved remote probes require administrator role', async () => {
  let calls = 0;
  const auth = { getSession: (token: string) => ({ user: { id: token, role: token } }) };
  const controller = new KnowledgeCenterController(
    {} as never,
    {
      probe: async () => {
        calls++;
      },
    } as never,
    auth as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(controller.probeEngine(undefined, 'ima-main', {}), { status: 401 });
  await assert.rejects(controller.probeEngine('qitu_session=student', 'ima-main', {}), {
    status: 403,
  });
  assert.equal(calls, 0);
});
