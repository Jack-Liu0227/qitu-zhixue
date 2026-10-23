import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CurrentUser } from '@qitu/contracts';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { editedKnowledgeConnection } from './knowledge-connection-edit';
import { KnowledgeConnectionCheckService } from './knowledge-connection-check.service';
import { KnowledgeCenterController } from './knowledge-center.controller';

const actor = { id: 'fixture-admin', role: 'admin' } as CurrentUser;
function fixture(provider = 'weknora') {
  const base = {
    id: 'library',
    revision: 3,
    kind: 'system',
    lifecycle: 'active',
    engine_instance_id: 'engine',
    library_settings: {},
  };
  let external = {
    serverUrl: 'https://old.example.invalid',
    remoteKnowledgeBaseId: 'old',
  } as Record<string, string>;
  if (provider === 'ima') external = { remoteKnowledgeBaseId: 'old' };
  const configured = {
    name: 'fixture',
    provider,
    enabled: true,
    description: '',
    config: {
      server_url: 'https://old.example.invalid',
      apiKey: 'fixture-only-key',
      allowedKnowledgeBaseIds: ['old'],
    },
  };
  const config = { knowledgeEngines: { engine: configured } };
  const writes: { sql: string; params: unknown[] }[] = [];
  const audits: { detail: { requestHash: string; result: object }; idempotencyKey: string }[] = [];
  const calls: Record<string, string>[] = [];
  let ok = true,
    documentsOk = true,
    mutateDuringCheck = false;
  const execute = async (query: SQL) => {
    const q = new PgDialect().sqlToQuery(query);
    if (q.sql.includes('FROM audit_logs'))
      return audits.filter((a) => a.idempotencyKey === q.params[0]);
    if (q.sql.includes('FROM knowledge_base_connections'))
      return [{ external_ref: structuredClone(external), provider }];
    if (q.sql.includes('FROM knowledge_bases')) return [structuredClone(base)];
    if (q.sql.includes('FROM platform_configuration_revisions'))
      return [{ revision: 7, config: structuredClone(config) }];
    if (/^(UPDATE|DELETE|INSERT)/.test(q.sql)) writes.push(q);
    if (q.sql.startsWith('UPDATE knowledge_base_connections'))
      external = JSON.parse(String(q.params[0]));
    if (q.sql.startsWith('UPDATE knowledge_bases')) base.revision++;
    return [];
  };
  const center = {
    query: execute,
    base: async () => structuredClone(base),
    configuration: async () => ({ config: structuredClone(config) }),
    database: () => ({
      transaction: (run: (tx: object) => Promise<unknown>) =>
        run({ execute: async (query: SQL) => ({ rows: await execute(query) }) }),
    }),
  };
  const engine = {
    adapterFor: () => ({
      connect: async (_engine: unknown, reference: Record<string, string>) => {
        calls.push(reference);
        if (mutateDuringCheck) base.revision++;
        return { ok, errorCode: ok ? undefined : 'REMOTE_RESOURCE_NOT_FOUND' };
      },
    }),
    execute: async () => ({
      ok: documentsOk,
      errorCode: documentsOk ? undefined : 'IMA_DIRECTORY_DENIED',
    }),
  };
  const service = new KnowledgeConnectionCheckService(
    center as never,
    engine as never,
    {
      write: async (record: (typeof audits)[number]) => {
        audits.push(record);
      },
    } as never,
  );
  return {
    service,
    base,
    writes,
    audits,
    calls,
    external: () => external,
    fail: () => {
      ok = false;
    },
    denyDocuments: () => {
      documentsOk = false;
    },
    concurrent: () => {
      mutateDuringCheck = true;
    },
  };
}

test('connection edits validate provider fields, URL and resource IDs without accepting credentials', () => {
  assert.deepEqual(
    editedKnowledgeConnection(
      'lightrag-server',
      { serverUrl: 'https://old.invalid', workspace: 'old' },
      { serverUrl: ' https://new.invalid ', workspace: '' },
    ),
    { serverUrl: 'https://new.invalid' },
  );
  assert.deepEqual(
    editedKnowledgeConnection(
      'kiwix',
      { serverUrl: 'https://old.invalid', zimName: 'old' },
      { zimName: 'new' },
    ),
    { serverUrl: 'https://old.invalid', zimName: 'new' },
  );
  for (const patch of [
    { apiKey: 'fixture' },
    { clientId: 'account' },
    { remoteKnowledgeBaseId: '' },
    { remoteKnowledgeBaseId: 'x'.repeat(513) },
    { remoteKnowledgeBaseId: 1 },
  ])
    assert.throws(() => editedKnowledgeConnection('ima', { remoteKnowledgeBaseId: 'old' }, patch));
  for (const serverUrl of [
    'https://user:key@example.invalid',
    'https://example.invalid/?token=x',
    'file:///tmp/data',
    'http://example.invalid',
  ])
    assert.throws(() =>
      editedKnowledgeConnection('weknora', { remoteKnowledgeBaseId: 'kb' }, { serverUrl }),
    );
  assert.throws(() => editedKnowledgeConnection('obsidian', {}, { vaultPath: '/tmp' }));
});

test('failed connection validation keeps the original resource and performs no writes', async () => {
  const f = fixture();
  f.fail();
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      {
        expectedRevision: 3,
        connection: { serverUrl: 'https://new.example.invalid', remoteKnowledgeBaseId: 'new' },
      },
      'failed',
      true,
    ),
    { status: 400 },
  );
  assert.equal(f.external().remoteKnowledgeBaseId, 'old');
  assert.equal(f.writes.length, 0);
});

test('verified service edits invalidate evidence, preserve engine grants and replay idempotently', async () => {
  const f = fixture();
  const body = {
    expectedRevision: 3,
    connection: { serverUrl: 'https://new.example.invalid', remoteKnowledgeBaseId: 'new' },
  };
  const first = await f.service.run(actor, 'library', body, 'save', true);
  assert.equal(f.external().serverUrl, 'https://new.example.invalid');
  assert.ok(f.writes.some((q) => q.sql.startsWith('DELETE FROM knowledge_remote_evidence')));
  assert.ok(!f.writes.some((q) => q.sql.includes('platform_configuration_revisions')));
  assert.ok(!JSON.stringify(f.audits).includes('fixture-only-key'));
  assert.deepEqual(await f.service.run(actor, 'library', body, 'save', true), first);
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      { ...body, connection: { remoteKnowledgeBaseId: 'other' } },
      'save',
      true,
    ),
    { status: 409 },
  );
});

test('IMA compatibility path checks document access before updating its allowlist', async () => {
  const f = fixture('ima');
  f.denyDocuments();
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      { expectedRevision: 3, remoteKnowledgeBaseId: 'new' },
      'denied',
      true,
    ),
    { status: 400 },
  );
  assert.equal(f.writes.length, 0);
  const good = fixture('ima');
  await good.service.run(
    actor,
    'library',
    { expectedRevision: 3, remoteKnowledgeBaseId: 'new' },
    'saved',
    true,
  );
  const inserted = good.writes.find((q) =>
    q.sql.startsWith('INSERT INTO platform_configuration_revisions'),
  );
  assert.ok(inserted);
  assert.deepEqual(
    JSON.parse(String(inserted.params[2])).knowledgeEngines.engine.config.allowedKnowledgeBaseIds,
    ['old', 'new'],
  );
});

test('concurrent edits and unsupported check payloads cannot overwrite a connection', async () => {
  const f = fixture();
  f.concurrent();
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      { expectedRevision: 3, connection: { remoteKnowledgeBaseId: 'new' } },
      'race',
      true,
    ),
    { status: 409 },
  );
  assert.equal(f.writes.length, 0);
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      { expectedRevision: 4, connection: { remoteKnowledgeBaseId: 'new' } },
      'check',
    ),
    { status: 400 },
  );
  await assert.rejects(
    f.service.run(
      actor,
      'library',
      { expectedRevision: 4, connection: {}, remoteKnowledgeBaseId: 'new' },
      'double',
      true,
    ),
    { status: 400 },
  );
});

test('connection edits still require an authenticated Admin and an idempotency key', async () => {
  const f = fixture();
  const auth = { getSession: (id: string) => ({ user: { id, role: id } }) };
  const controller = new KnowledgeCenterController(
    {} as never,
    {} as never,
    auth as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    f.service,
  );
  const body = { expectedRevision: 3, connection: { remoteKnowledgeBaseId: 'new' } };
  await assert.rejects(controller.reconnectLibrary(undefined, 'key', 'library', body), {
    status: 401,
  });
  await assert.rejects(
    controller.reconnectLibrary('qitu_session=student', 'key', 'library', body),
    { status: 403 },
  );
  await assert.rejects(
    controller.reconnectLibrary('qitu_session=admin', undefined, 'library', body),
    { status: 400 },
  );
  assert.equal(f.calls.length, 0);
});
