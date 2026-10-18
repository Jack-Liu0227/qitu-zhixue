import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import type { KnowledgeCenterService } from './knowledge-center.service';
import type { KnowledgeEngineService } from './knowledge-engine.service';

function fixture() {
  let allowed = true;
  let connected = true;
  let changed = false;
  let calls = 0;
  const cache = new Map<string, Record<string, unknown>>();
  const base = { id: 'linked', name: '远端教材', kind: 'platform', engine_instance_id: 'ima' };
  const configuration = {
    knowledgeEngines: {
      ima: { name: 'ima', provider: 'ima', enabled: true, config: { apiKey: 'never-return-this' } },
    },
  };
  const center = {
    canRetrieve: async () => allowed,
    configuration: async () => ({ config: configuration }),
    query: async (sql: SQL) => {
      const { sql: text, params } = new PgDialect().sqlToQuery(sql);
      if (text.includes('JOIN users')) return allowed ? [base] : [];
      if (text.includes('FROM knowledge_base_connections'))
        return connected
          ? [
              {
                id: changed ? 'new' : 'old',
                status: 'ready',
                external_ref: { remoteKnowledgeBaseId: 'source' },
              },
            ]
          : [];
      if (text.includes('INSERT INTO knowledge_remote_evidence')) {
        cache.set(String(params[0]), {
          kb_id: params[1],
          assistant_id: params[2],
          fingerprint: params[3],
          title: params[4],
          content: params[5],
          origin: JSON.parse(String(params[6])),
        });
        return [];
      }
      if (text.includes('FROM knowledge_remote_evidence')) {
        const saved = cache.get(String(params[0]));
        return saved?.assistant_id === params[1] ? [saved] : [];
      }
      return [];
    },
  } as unknown as KnowledgeCenterService;
  const engine = {
    execute: async () => {
      calls++;
      return {
        ok: true,
        manifest: {
          items: [{ id: 'doc1', title: '动能', content: '质量不变时速度加倍，动能变为四倍。' }],
        },
      };
    },
  } as unknown as KnowledgeEngineService;
  return {
    service: new KnowledgeRetrievalService(center, engine),
    engine,
    revoke: () => {
      allowed = false;
    },
    detach: () => {
      connected = false;
    },
    replace: () => {
      changed = true;
    },
    calls: () => calls,
  };
}

test('linked retrieval returns actual source text with assistant-scoped citations and no credentials', async () => {
  const f = fixture();
  const result = await f.service.search('student', 'a', '动能');
  assert.equal(result.state, 'ready');
  assert.match(result.evidence[0]!.text, /四倍/);
  assert.ok(!JSON.stringify(result).includes('never-return-this'));
  const citation = result.evidence[0]!.citationId;
  assert.match((await f.service.read('student', 'a', citation)).text, /四倍/);
  await assert.rejects(f.service.read('student', 'other', citation), /资料不可用/);
  f.detach();
  await assert.rejects(f.service.read('student', 'a', citation), /资料不可用/);
});

test('global revocation prevents remote calls and invalidates previously returned citations', async () => {
  const f = fixture();
  const result = await f.service.search('student', 'a', 'q');
  f.revoke();
  await assert.rejects(
    f.service.read('student', 'a', result.evidence[0]!.citationId),
    /资料不可用/,
  );
  assert.equal((await f.service.search('student', 'a', 'q')).state, 'CAPABILITY_NOT_AUTHORIZED');
  assert.equal(f.calls(), 1);
});

test('in-flight revocation or connection replacement discards remote results', async () => {
  for (const mutation of ['revoke', 'replace'] as const) {
    const f = fixture();
    const run = f.engine.execute.bind(f.engine);
    f.engine.execute = async (...args) => {
      const receipt = await run(...args);
      f[mutation]();
      return receipt;
    };
    assert.deepEqual((await f.service.search('student', 'a', 'q')).evidence, []);
  }
});

test('title-only matches never become evidence', async () => {
  const f = fixture();
  f.engine.execute = async () => ({ ok: true, manifest: { items: [{ title: '标题' }] } });
  assert.equal((await f.service.search('student', 'a', 'q')).state, 'NO_KNOWLEDGE_EVIDENCE');
});
