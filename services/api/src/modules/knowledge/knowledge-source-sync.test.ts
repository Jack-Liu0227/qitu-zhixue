import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { KnowledgeCenterService, checksum } from './knowledge-center.service';
import { KnowledgeSourceSyncService, KnowledgeSourceReadError } from './knowledge-source-sync.service';
import { KnowledgeCenterController } from './knowledge-center.controller';
import { KnowledgeBuildWorker } from './knowledge-build.worker';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { AuthService } from '../identity-auth/auth.service';

function sourceService() {
  return new KnowledgeSourceSyncService({} as KnowledgeCenterService, {} as AuditWriter);
}
function code(error: unknown): string | undefined {
  const value = error as { getResponse?: () => { code?: string } };
  return value.getResponse?.().code;
}

test('folder sources reject paths outside configured roots after realpath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qitu-source-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'qitu-source-outside-'));
  const previous = process.env.QITU_KNOWLEDGE_FOLDER_ROOTS;
  process.env.QITU_KNOWLEDGE_FOLDER_ROOTS = root;
  try {
    await assert.rejects(sourceService().validateSource('folder', { path: outside }), (error) => code(error) === 'SOURCE_PATH_NOT_ALLOWED');
    const nested = join(root, 'nested');
    await mkdir(nested);
    const accepted = await sourceService().validateSource('folder', { path: nested });
    assert.equal(accepted.config.path, nested);
    await assert.rejects(sourceService().validateSource('folder', { path: nested, token: 'secret' }), (error) => code(error) === 'CONFIG_SECRET_FORBIDDEN');
  } finally {
    if (previous === undefined) delete process.env.QITU_KNOWLEDGE_FOLDER_ROOTS;
    else process.env.QITU_KNOWLEDGE_FOLDER_ROOTS = previous;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});


test('folder reads enforce a hard directory-entry budget before traversing large trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qitu-source-entry-budget-'));
  const previous = process.env.QITU_KNOWLEDGE_FOLDER_ROOTS;
  process.env.QITU_KNOWLEDGE_FOLDER_ROOTS = root;
  try {
    await Promise.all(Array.from({ length: 1001 }, (_, index) => writeFile(join(root, `entry-${index}.txt`), '')));
    await assert.rejects(
      sourceService().prepare({ kind: 'folder', source_config: { path: root } }),
      (error) => error instanceof Error && error.message === 'SOURCE_SYNC_BUDGET_EXCEEDED',
    );
  } finally {
    if (previous === undefined) delete process.env.QITU_KNOWLEDGE_FOLDER_ROOTS;
    else process.env.QITU_KNOWLEDGE_FOLDER_ROOTS = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('same source payload and idempotency key replay without duplicate source or audit', async () => {
  process.env.QITU_KNOWLEDGE_GITHUB_REPOS = 'trusted/docs';
  let inserted = false;
  const auditEntries: Record<string, unknown>[] = [];
  const tx = {
    execute: async (query: unknown) => {
      const text = JSON.stringify(query);
      if (text.includes('SELECT detail FROM audit_logs'))
        return { rows: auditEntries.length ? [{ detail: auditEntries[0]!.detail }] : [] };
      if (text.includes('SELECT id,source_fingerprint FROM knowledge_sources'))
        return { rows: inserted ? [{ id: 'existing', source_fingerprint: 'same' }] : [] };
      if (text.includes('INSERT INTO knowledge_sources')) {
        if (inserted) return { rows: [] };
        inserted = true;
        return { rows: [{ id: 'source-created' }] };
      }
      return { rows: [] };
    },
  };
  const center = {
    base: async () => ({ id: 'kb-a', kind: 'platform', lifecycle: 'active' }),
    database: () => ({ transaction: async (fn: (executor: typeof tx) => Promise<unknown>) => fn(tx) }),
  } as unknown as KnowledgeCenterService;
  const audit = {
    write: async (entry: Record<string, unknown>) => { auditEntries.push(entry); return 'audit-id'; },
  } as unknown as AuditWriter;
  const service = new KnowledgeSourceSyncService(center, audit);
  try {
    await service.create({ id: 'admin', role: 'admin' } as never, 'kb-a', { kind: 'github', sourceConfig: { repo: 'trusted/docs' } }, 'source-key');
    await service.create({ id: 'admin', role: 'admin' } as never, 'kb-a', { kind: 'github', sourceConfig: { repo: 'trusted/docs' } }, 'source-key');
    assert.equal(inserted, true);
    assert.equal(auditEntries.length, 1);
    assert.equal(JSON.stringify(auditEntries).includes('secret'), false);
  } finally {
    delete process.env.QITU_KNOWLEDGE_GITHUB_REPOS;
  }
});

test('GitHub repo allowlist and web host/depth/page budgets fail closed', async () => {
  const previousRepos = process.env.QITU_KNOWLEDGE_GITHUB_REPOS;
  const previousHosts = process.env.QITU_KNOWLEDGE_WEB_HOSTS;
  process.env.QITU_KNOWLEDGE_GITHUB_REPOS = 'trusted/docs';
  process.env.QITU_KNOWLEDGE_WEB_HOSTS = 'docs.example.org';
  try {
    const service = sourceService();
    assert.equal((await service.validateSource('github', { repo: 'trusted/docs' })).config.repo, 'trusted/docs');
    await assert.rejects(service.validateSource('github', { repo: 'other/private' }), (error) => code(error) === 'SOURCE_REPOSITORY_NOT_ALLOWED');
    await assert.rejects(service.validateSource('web', { url: 'https://docs.example.org/', maxPages: 201 }), (error) => code(error) === 'SOURCE_CONFIG_INVALID');
    await assert.rejects(service.validateSource('web', { url: 'https://not-allowlisted.example/' }), (error) => code(error) === 'SOURCE_HOST_NOT_ALLOWED');
  } finally {
    if (previousRepos === undefined) delete process.env.QITU_KNOWLEDGE_GITHUB_REPOS;
    else process.env.QITU_KNOWLEDGE_GITHUB_REPOS = previousRepos;
    if (previousHosts === undefined) delete process.env.QITU_KNOWLEDGE_WEB_HOSTS;
    else process.env.QITU_KNOWLEDGE_WEB_HOSTS = previousHosts;
  }
});

test('source write controller denies non-admin before source service invocation', async () => {
  let called = false;
  const controller = new KnowledgeCenterController(
    {} as KnowledgeCenterService,
    {} as never,
    { getSession: (id: string) => ({ user: { id, role: id } }) } as unknown as AuthService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { create: async () => { called = true; return {}; } } as never,
  );
  await assert.rejects(controller.createSource('qitu_session=student', 'key', 'kb', {}), { status: 403 });
  assert.equal(called, false);
});

test('repeated unchanged source sync keeps the document active and readable', async () => {
  type Member = {
    id: string;
    kb_id: string;
    title: string;
    content: string;
    checksum: string;
    source_revision: string;
    origin: Record<string, unknown>;
    visibility: string;
  };
  const members: Member[] = [];
  const jobs = [1, 2].map((attempt) => ({
    id: `sync-${attempt}`,
    kb_id: 'kb',
    state: 'queued',
    input_revision: 2,
    fencing_token: 1,
    attempts: 1,
    operation: 'sync',
    source_id: 'source-1',
  }));
  const base = {
    id: 'kb', name: '资料库', kind: 'platform', project_id: null, school_id: null,
    owner_user_id: null, engine_instance_id: 'engine', lifecycle: 'active',
    build_state: 'queued', active_index_version_id: null, revision: 2, updated_at: '',
  };
  let jobIndex = 0;
  let activeJob = jobs[0]!;
  const source = {
    id: 'source-1', kind: 'folder', source_config: { path: '/allowlisted' }, status: 'syncing',
    source_fingerprint: 'fingerprint', last_source_revision: null,
  };
  const db = {
    execute: async (query: unknown) => {
      const text = JSON.stringify(query);
      if (text.includes('UPDATE knowledge_jobs SET state=\'discovering\'') && text.includes('RETURNING *')) {
        activeJob = jobs[jobIndex++]!;
        return { rows: [activeJob] };
      }
      if (text.includes('SELECT k.*,coalesce(u.school_id')) return { rows: [base] };
      if (text.includes('SELECT id,kind,source_config,status,source_fingerprint,last_source_revision')) return { rows: [source] };
      if (text.includes('SELECT k.*, (SELECT count(*)::int')) {
        return { rows: [{ ...base, document_count: members.filter((member) => member.visibility === 'active').length }] };
      }
      if (text.includes('SELECT flavour,provider,external_ref')) return { rows: [] };
      if (text.includes('SELECT id,kind,status,source_config,last_error_code')) return { rows: [] };
      if (text.includes('SELECT agent_kind as')) return { rows: [] };
      if (text.includes('SELECT id,kb_id,title,checksum,document_id,source_revision,origin,visibility')) {
        return { rows: members.filter((member) => member.visibility === 'active') };
      }
      if (text.includes('SELECT id,status,manifest,created_at FROM knowledge_index_versions')) return { rows: [] };
      if (text.includes('SELECT * FROM knowledge_jobs WHERE kb_id=')) return { rows: [] };
      if (text.includes('SELECT m.* FROM knowledge_base_members')) {
        return { rows: members.filter((member) => member.visibility === 'active') };
      }
      if (text.includes('SELECT * FROM knowledge_base_members WHERE kb_id=')) {
        return { rows: members.filter((member) => member.visibility === 'active' || (member.visibility === 'candidate' && member.origin.syncJobId === activeJob.id)) };
      }
      return { rows: [] };
    },
    transaction: async (run: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) =>
      run({
        execute: async (query: unknown) => {
          const text = JSON.stringify(query);
          if (text.includes('SELECT j.id FROM knowledge_jobs')) return { rows: [{ id: activeJob.id }] };
          if (text.includes("SELECT id FROM knowledge_jobs WHERE id=") && text.includes("state<>'cancelled'")) return { rows: [{ id: activeJob.id }] };
          if (text.includes("lease_until>now()") && text.includes("state='validating'")) return { rows: [{ id: activeJob.id }] };
          if (text.includes('SELECT revision FROM platform_configuration_revisions')) return { rows: [{ revision: 1 }] };
          if (text.includes('SELECT revision FROM knowledge_bases')) return { rows: [{ revision: 2 }] };
          if (text.includes('SELECT id FROM knowledge_sources WHERE id=')) return { rows: [{ id: source.id }] };
          if (text.includes('SELECT p.id FROM knowledge_base_members')) return { rows: [] };
          if (text.includes('INSERT INTO knowledge_base_members')) {
            const existing = members.find((member) => member.kb_id === 'kb' && member.checksum === checksum('正文'));
            if (!existing) {
              members.push({
                id: `member-${members.length + 1}`,
                kb_id: 'kb', title: 'doc', content: '正文', checksum: checksum('正文'), source_revision: 'rev',
                origin: { kind: 'managed-source', sourceId: source.id, syncJobId: activeJob.id },
                visibility: 'candidate',
              });
            } else if (text.includes('DO UPDATE') && existing.origin.sourceId === source.id) {
              existing.origin = { ...existing.origin, syncJobId: activeJob.id };
              existing.source_revision = 'rev';
              existing.visibility = 'candidate';
            }
            return { rows: [] };
          }
          if (text.includes("UPDATE knowledge_base_members SET visibility='superseded'") && text.includes("visibility='active'")) {
            const guarded = text.includes('EXISTS');
            for (const member of members) {
              if (member.visibility === 'active' && member.origin.sourceId === source.id) {
                const replacement = members.some((candidate) => candidate.visibility === 'candidate' && candidate.origin.syncJobId === activeJob.id && candidate.title === member.title);
                if (!guarded || replacement) member.visibility = 'superseded';
              }
            }
            return { rows: [] };
          }
          if (text.includes("UPDATE knowledge_base_members SET visibility='active'")) {
            for (const member of members) {
              if (member.visibility === 'candidate' && member.origin.syncJobId === activeJob.id) member.visibility = 'active';
            }
            return { rows: [] };
          }
          return { rows: [] };
        },
      }),
  };
  const center = new KnowledgeCenterService(db as never, {} as never);
  center.configuration = async () => ({ revision: 1, config: { knowledgeEngines: { engine: { provider: 'llamaindex', enabled: true, config: {} } } } } as never);
  const worker = new KnowledgeBuildWorker(
    center,
    { check: async () => ({ ok: true }), execute: async () => ({ ok: true, manifest: {} }) } as never,
    {} as never,
    { prepare: async () => ({ documents: [{ title: 'doc', content: '正文', revision: 'rev' }], discovered: 1, accepted: 1, rejected: 0, bytesRead: 6, pagesRead: 0, sourceRevision: 'source-rev' }) } as never,
  );

  await worker.tick();
  await worker.tick();

  assert.equal(members.length, 1, 'UNIQUE(kb_id,checksum) 应保持单一成员行');
  assert.equal(members[0]!.visibility, 'active');
  assert.equal((await center.bases())[0]!.document_count, 1);
  const file = await center.file('kb', members[0]!.id);
  assert.equal(file.content, '正文');
});
test('worker lease loss/cancellation fence blocks publication before index writes', async () => {
  const statements: string[] = [];
  const center = {
    database: () => ({
      transaction: async (fn: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => fn({
        execute: async (query: unknown) => { statements.push(JSON.stringify(query)); return { rows: [] }; },
      }),
    }),
  } as unknown as KnowledgeCenterService;
  const worker = new KnowledgeBuildWorker(center, {} as never, {} as never, {} as never);
  await assert.rejects(worker.event({ id: 'sync-job', kb_id: 'kb', state: 'cancelled', input_revision: 2, fencing_token: 3, attempts: 1, operation: 'sync' }, 'validating'), /JOB_LEASE_LOST/);
  assert.equal(statements.some((statement) => statement.includes('knowledge_index_versions')), false);
});


test('sync cancellation/revocation boundaries never leave readable members or publish a version', async () => {
  type Boundary = 'fetch' | 'parse' | 'upsert' | 'publish' | 'build';
  const boundaries: Boundary[] = ['fetch', 'parse', 'upsert', 'publish', 'build'];
  for (const boundary of boundaries) {
    const statements: string[] = [];
    let candidateRows = 0;
    let published = false;
    let queryCount = 0;
    const job = { id: `sync-${boundary}`, kb_id: 'kb', state: 'queued', input_revision: 2, fencing_token: 1, attempts: 1, operation: 'sync', source_id: 'source-1' };
    const source = { id: 'source-1', kind: 'folder', source_config: { path: '/allowlisted' }, status: boundary === 'fetch' ? 'revoked' : 'syncing', source_fingerprint: 'fingerprint', last_source_revision: null };
    const tx = {
      execute: async (query: unknown) => {
        const text = JSON.stringify(query);
        if (text.includes("UPDATE knowledge_base_members SET visibility='superseded'")) candidateRows = 0;
        if (text.includes('INSERT INTO knowledge_base_members')) candidateRows = 1;
        if (text.includes('INSERT INTO knowledge_index_versions')) published = true;
        statements.push(text);
        if (text.includes('SELECT j.id')) return { rows: boundary === 'publish' || boundary === 'build' ? [{ id: job.id }] : [] };
        if (text.includes("lease_until>now()") && text.includes("state='validating'")) return { rows: [] };
        if (text.includes('SELECT revision FROM platform_configuration_revisions')) return { rows: [{ revision: 1 }] };
        if (text.includes('SELECT revision FROM knowledge_bases')) return { rows: [{ revision: 2 }] };
        if (text.includes('SELECT id FROM knowledge_jobs')) return { rows: [] };
        return { rows: [] };
      },
    };
    const center = {
      query: async () => {
        queryCount += 1;
        if (queryCount === 1) return [job];
        if (queryCount === 2) return [{ id: 'kb', revision: 2, kind: 'platform', engine_instance_id: 'engine' }];
        if (queryCount === 3) return [source];
        return [{ id: 'candidate-1', kb_id: 'kb', title: 'doc', content: '正文', checksum: 'hash', source_revision: 'rev', origin: { kind: 'managed-source', sourceId: 'source-1', syncJobId: job.id }, visibility: 'candidate' }];
      },
      configuration: async () => ({ revision: 1, config: { knowledgeEngines: { engine: { provider: 'llamaindex', enabled: true, config: {} } } } }),
      database: () => ({
        execute: async (query: unknown) => {
          const text = JSON.stringify(query);
          if (text.includes("UPDATE knowledge_base_members SET visibility='superseded'")) candidateRows = 0;
          statements.push(text);
          return { rows: [] };
        },
        transaction: async (fn: (executor: typeof tx) => Promise<unknown>) => fn(tx),
      }),
    } as unknown as KnowledgeCenterService;
    const sourceSync = {
      prepare: async () => {
        if (boundary === 'parse') throw new KnowledgeSourceReadError('SYNC_CANCELLED');
        return { documents: [{ title: 'doc', content: '正文', revision: 'rev' }], discovered: 1, accepted: 1, rejected: 0, bytesRead: 6, pagesRead: 0, sourceRevision: 'source-rev' };
      },
    };
    const worker = new KnowledgeBuildWorker(
      center,
      { check: async () => ({ ok: true, status: 'ready' }), execute: async () => boundary === 'build' ? ({ ok: false, errorCode: 'INDEX_BUILD_FAILED' }) : ({ ok: true, manifest: {} }) } as never,
      {} as never,
      sourceSync as never,
    );
    await worker.tick();
    assert.equal(statements.some((statement) => statement.includes('INSERT INTO knowledge_base_members')), boundary === 'publish' || boundary === 'build', boundary);
    assert.equal(statements.some((statement) => statement.includes('INSERT INTO knowledge_index_versions')), false, boundary);
    assert.equal(candidateRows, 0, boundary);
    assert.equal(published, false, boundary);
  }
});

/**
 * C9 回归：`sync()` 曾用 `${actor.id}:${key}` 查库、却用 `${sourceId}:${actor.id}:${key}`
 * 写库，导致查找永不命中 —— 重放走到 INSERT 撞确定性 jobId 主键变成 500，
 * 且 `IDEMPOTENCY_CONFLICT`（同键异 payload → 409）永不可达。
 * 这里把「查找键 == 写入键」这条不变量本身钉住。
 */
test('sync replay uses one idempotency scope: lookup key equals stored key, no duplicate run, 409 on changed payload', async () => {
  process.env.QITU_KNOWLEDGE_GITHUB_REPOS = 'trusted/docs';
  const inserts: string[] = [];
  const selects: string[] = [];
  let priorHash: string | null = null;
  const tx = {
    execute: async (query: unknown) => {
      const text = JSON.stringify(query);
      if (text.includes('SELECT request_hash FROM knowledge_sync_runs')) {
        selects.push(text);
        return { rows: priorHash === null ? [] : [{ request_hash: priorHash }] };
      }
      if (text.includes('SELECT revision FROM knowledge_bases')) return { rows: [{ revision: 7 }] };
      if (text.includes('INSERT INTO knowledge_sync_runs')) {
        inserts.push(text);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const center = {
    base: async () => ({ id: 'kb-a', kind: 'platform', lifecycle: 'active' }),
    query: async () => [{ id: 'src-1', source_config: { repo: 'trusted/docs' }, kind: 'github', status: 'ready', last_source_revision: null }],
    database: () => ({ transaction: async (fn: (executor: typeof tx) => Promise<unknown>) => fn(tx) }),
  } as unknown as KnowledgeCenterService;
  const audit = { write: async () => 'audit-id' } as unknown as AuditWriter;
  const service = new KnowledgeSourceSyncService(center, audit);
  const admin = { id: 'admin', role: 'admin' } as never;
  /** 作用域幂等键：形如 `src-1:admin:<key>`。 */
  const scopedKeyOf = (text: string) => text.match(/src-1:admin:[A-Za-z0-9._-]+/)?.[0] ?? null;
  /** requestHash：INSERT 参数里不带 `sync-` 前缀的那段长十六进制（jobId 带前缀）。 */
  const hashOf = (text: string) =>
    (text.match(/[0-9a-f]{32,}/g) ?? []).find((token, _, all) => !text.includes(`sync-${token}`) || all.filter((t) => t === token).length > 1) ?? null;
  try {
    await service.sync(admin, 'kb-a', 'src-1', { reason: 'manual' }, 'sync-key');
    assert.equal(inserts.length, 1, '首次同步应写入一个 run');
    const storedKey = scopedKeyOf(inserts[0]!);
    assert.ok(storedKey, 'INSERT 必须写入作用域幂等键');
    assert.equal(selects.length, 1);
    assert.ok(
      selects[0]!.includes(storedKey!),
      `查找键必须与写入键一致（写入=${storedKey}，查找=${scopedKeyOf(selects[0]!) ?? '不一致'}）`,
    );

    // 同键同 payload 重放：必须命中既有 run，不新增、不抛 500。
    priorHash = hashOf(inserts[0]!);
    assert.ok(priorHash, '应能从 INSERT 参数中取出 requestHash 以模拟重放');
    await service.sync(admin, 'kb-a', 'src-1', { reason: 'manual' }, 'sync-key');
    assert.equal(inserts.length, 1, '同键同 payload 重放不得新增 run');

    // 同键异 payload：必须 409，而不是静默重放或 500。
    priorHash = 'deadbeef'.repeat(8);
    await assert.rejects(
      service.sync(admin, 'kb-a', 'src-1', { reason: 'manual', expectedSourceRevision: 'rev-2' }, 'sync-key'),
      (error) => code(error) === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(inserts.length, 1, '冲突请求不得写入 run');
  } finally {
    delete process.env.QITU_KNOWLEDGE_GITHUB_REPOS;
  }
});
