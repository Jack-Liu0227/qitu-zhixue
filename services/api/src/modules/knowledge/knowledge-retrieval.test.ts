import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import type { KnowledgeCenterService } from './knowledge-center.service';
import type { KnowledgeEngineService } from './knowledge-engine.service';
import { KnowledgeBuildWorker } from './knowledge-build.worker';

const scope = { authorizeTool: async () => true, key: 'fixture-exploration', knowledgeBaseIds: null };

test('empty search is a successful lookup; permission and invalid citations remain failures', async () => {
  const f = fixture();
  f.engine.execute = async () => ({ ok: true, hits: [] });
  const [search, read] = f.service.tools('student', 'assistant', scope);
  const empty = await search!.execute({ query: 'no matching material' });
  assert.notEqual(empty.isError, true); assert.equal(empty.outcome, 'empty');
  assert.equal(JSON.parse(empty.text).state, 'NO_KNOWLEDGE_EVIDENCE');
  const invalid = await read!.execute({ citationId: 'invented' });
  assert.equal(invalid.isError, true); assert.match(invalid.text, /^KNOWLEDGE_SOURCE_UNAVAILABLE/);
  f.revoke();
  const denied = await search!.execute({ query: 'private' });
  assert.equal(denied.isError, true); assert.match(denied.text, /^KNOWLEDGE_RETRIEVAL_DISABLED/);
});

function fixture() {
  let authorized = true;
  let version = 'v1';
  let activeMember = true;
  let engineCalls = 0;
  let queries = 0;
  const config = { provider: 'llamaindex', enabled: true, config: {} };
  const base = { id: 'manual', kind: 'platform', name: '手动资料', engine_instance_id: 'engine' };
  const member = {
    id: 'm1',
    title: '动能',
    content: '速度两倍时动能四倍',
    checksum: 'hash',
    origin: {},
  };
  const center = {
    canRetrieve: async () => authorized,
    configuration: async () => ({ config: { knowledgeEngines: { engine: config } } }),
    query: async (query: SQL) => {
      queries++;
      const text = new PgDialect().sqlToQuery(query).sql;
      if (text.includes('JOIN users'))
        return authorized ? [{ ...base, active_index_version_id: version }] : [];
      if (text.includes('knowledge_index_versions'))
        return [{ config_snapshot: { engine: config }, manifest: { memberIds: ['m1'] } }];
      if (text.includes('knowledge_base_members')) return activeMember ? [member] : [];
      return [];
    },
  } as unknown as KnowledgeCenterService;
  const engine = {
    execute: async () => {
      engineCalls++;
      return {
        ok: true,
        hits: [{ memberId: 'm1', text: member.content, locator: null, score: 1 }],
      };
    },
  } as unknown as KnowledgeEngineService;
  return {
    service: new KnowledgeRetrievalService(center, engine),
    engine,
    revoke: () => {
      authorized = false;
    },
    replace: () => {
      version = 'v2';
    },
    deleteMember: () => {
      activeMember = false;
    },
    calls: () => ({ queries, engineCalls }),
  };
}

test('manual knowledge is searchable without a project binding; citations use the original manual base', async () => {
  const f = fixture();
  const result = await f.service.search('student', 'assistant', '动能', 5, scope);
  assert.equal(result.state, 'ready');
  assert.equal(result.evidence[0]?.knowledgeBaseId, 'manual');
  assert.match(
    (await f.service.read('student', 'assistant', result.evidence[0]!.citationId, scope)).text,
    /四倍/,
  );
  f.deleteMember();
  await assert.rejects(f.service.read('student', 'assistant', 'v1~m1', scope), /资料不可用/);
});

test('global revocation prevents all data/engine access; in-flight revocation discards results', async () => {
  const f = fixture();
  f.revoke();
  assert.equal(
    (await f.service.search('student', 'assistant', 'q', 5, scope)).state,
    'CAPABILITY_NOT_AUTHORIZED',
  );
  assert.deepEqual(f.calls(), { queries: 0, engineCalls: 0 });
  const g = fixture();
  const run = g.engine.execute.bind(g.engine);
  g.engine.execute = async (...args) => {
    const receipt = await run(...args);
    g.revoke();
    return receipt;
  };
  assert.equal((await g.service.search('student', 'assistant', 'q', 5, scope)).evidence.length, 0);
  await assert.rejects(g.service.read('student', 'assistant', 'v1~m1', scope), /资料不可用/);
});

test('index replacement while retrieving invalidates both results and historical citation reads', async () => {
  const f = fixture();
  const run = f.engine.execute.bind(f.engine);
  f.engine.execute = async (...args) => {
    const receipt = await run(...args);
    f.replace();
    return receipt;
  };
  assert.equal((await f.service.search('student', 'assistant', 'q', 5, scope)).evidence.length, 0);
  await assert.rejects(f.service.read('student', 'assistant', 'v1~m1', scope), /资料不可用/);
});

test('tools reject hidden base IDs, paths and invalid result budgets', async () => {
  const f = fixture();
  const [search, read] = f.service.tools('student', 'assistant', scope);
  for (const args of [
    { query: 'q', knowledgeBaseId: 'private' },
    { query: 'q', topK: 100 },
    { query: '' },
  ])
    assert.equal((await search!.execute(args)).isError, true);
  assert.equal((await read!.execute({ citationId: 'v1~m1', path: '/etc/passwd' })).isError, true);
  assert.deepEqual(f.calls(), { queries: 0, engineCalls: 0 });
});

test('a queued historical project preparation job is cancelled before model or source work', async () => {
  const statements: string[] = [];
  let queries = 0;
  const execute = async (query: SQL) => {
    statements.push(new PgDialect().sqlToQuery(query).sql);
    return { rows: [{ id: 'old-job' }] };
  };
  const center = {
    query: async () =>
      ++queries === 1
        ? [
            {
              id: 'old-job',
              kb_id: 'old-project-base',
              input_revision: 1,
              fencing_token: 1,
              attempts: 1,
              operation: 'prepare',
            },
          ]
        : [{ id: 'old-project-base', kind: 'project', revision: 1 }],
    database: () => ({
      execute,
      transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) =>
        fn({ execute }),
    }),
  } as unknown as KnowledgeCenterService;
  const worker = new KnowledgeBuildWorker(
    center,
    {
      check: async () => {
        throw new Error('must not use an engine');
      },
    } as unknown as KnowledgeEngineService,
    {} as never,
  );
  await worker.tick();
  assert.equal(queries, 2);
  assert.ok(statements.some((s) => s.includes('UPDATE knowledge_jobs SET state=')));
  assert.equal(
    statements.some((s) => s.includes('INSERT INTO knowledge_base_members')),
    false,
  );
});

test('missing scope denies access and a frozen ceiling excludes newly granted bases', async () => {
  const f = fixture();
  assert.deepEqual((await f.service.search('student', 'assistant', 'q')).evidence, []);
  assert.deepEqual(f.service.tools('student', 'assistant'), []);
  const frozen = { ...scope, key: 'project:a', knowledgeBaseIds: ['other'] };
  assert.deepEqual((await f.service.search('student', 'assistant', 'q', 5, frozen)).evidence, []);
  await assert.rejects(f.service.read('student', 'assistant', 'v1~m1', frozen));
  assert.equal(f.calls().engineCalls, 0);
});
