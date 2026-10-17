import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { CurrentUser } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { KnowledgeCenterService, checksum, rows } from './knowledge-center.service';
import { record } from './knowledge-center.config';

const SECRET_KEY = /token|password|secret|api[-_]?key|cookie|authorization|credential/i;
const ROOT_KEYS = ['QITU_KNOWLEDGE_FOLDER_ROOTS'];
const FOLDER_BUDGET = { files: 20, entries: 1000, bytes: 7 * 1024 * 1024, fileBytes: 5 * 1024 * 1024, timeoutMs: 60_000 };
const WEB_BUDGET = { bytes: 7 * 1024 * 1024, timeoutMs: 60_000 };
const GITHUB_BUDGET = { files: 20, bytes: 7 * 1024 * 1024, fileBytes: 5 * 1024 * 1024, timeoutMs: 60_000 };
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.rst', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml']);

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new KnowledgeSourceReadError('SOURCE_REMOTE_INVALID');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

function globMatcher(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') { source += '.*'; index++; }
    else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += /[\\^$+.|()[\]{}]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`);
}

function configuredList(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}
function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0));
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return value !== '::1' && value !== '::' && !value.startsWith('fc') && !value.startsWith('fd') && !value.startsWith('fe80:') && !value.startsWith('::ffff:');
  }
  return false;
}
export interface PreparedSourceDocument { title: string; content: string; revision: string; }
export interface PreparedSourceBatch {
  documents: PreparedSourceDocument[];
  discovered: number;
  accepted: number;
  rejected: number;
  bytesRead: number;
  pagesRead: number;
  sourceRevision: string;
}
export class KnowledgeSourceReadError extends Error {
  constructor(readonly code: string) { super(code); }
}

@Injectable()
export class KnowledgeSourceSyncService {
  constructor(private readonly center: KnowledgeCenterService, private readonly audit: AuditWriter) {}

  private async folderPath(path: string): Promise<string> {
    const roots = ROOT_KEYS.flatMap(configuredList).map((root) => resolve(root));
    if (!roots.length) throw new BadRequestException({ code: 'SOURCE_PATH_NOT_ALLOWED', message: '服务端未配置 folder 根目录' });
    let actual: string;
    try { actual = await realpath(path); } catch { throw new BadRequestException({ code: 'SOURCE_PATH_NOT_ALLOWED', message: 'folder 路径不可用' }); }
    const allowed = await Promise.all(roots.map(async (root) => {
      try {
        const canonicalRoot = await realpath(root);
        const rel = relative(canonicalRoot, actual);
        return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.includes('\\'));
      } catch { return false; }
    }));
    if (!allowed.some(Boolean)) throw new BadRequestException({ code: 'SOURCE_PATH_NOT_ALLOWED', message: 'folder 路径超出服务端 allowlist' });
    return actual;
  }

  async validateSource(kind: string, raw: unknown): Promise<{ config: Record<string, unknown>; budget: Record<string, number> }> {
    if (!['folder', 'github', 'web'].includes(kind)) throw new BadRequestException({ code: 'SOURCE_KIND_INVALID', message: '来源类型无效' });
    const config = record(raw);
    if (Object.keys(config).some((key) => SECRET_KEY.test(key)))
      throw new BadRequestException({ code: 'CONFIG_SECRET_FORBIDDEN', message: '来源配置不得包含凭证' });
    if (kind === 'folder') {
      if (Object.keys(config).some((key) => key !== 'path') || typeof config.path !== 'string' || !config.path.trim())
        throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: 'folder 来源需要 path' });
      return { config: { path: await this.folderPath(config.path) }, budget: FOLDER_BUDGET };
    }
    if (kind === 'github') {
      if (Object.keys(config).some((key) => !['repo', 'branch', 'path', 'glob'].includes(key)) || typeof config.repo !== 'string')
        throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: 'GitHub 来源字段无效' });
      const repo = config.repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !configuredList('QITU_KNOWLEDGE_GITHUB_REPOS').includes(repo))
        throw new BadRequestException({ code: 'SOURCE_REPOSITORY_NOT_ALLOWED', message: 'GitHub repo 不在服务端 allowlist' });
      for (const field of ['branch', 'path', 'glob']) if (config[field] !== undefined && (typeof config[field] !== 'string' || (config[field] as string).length > 500))
        throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: `GitHub ${field} 无效` });
      const path = String(config.path ?? '').replace(/^\/+|\/+$/g, '');
      if (path.split('/').some((part) => part === '..')) throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: 'GitHub path 不得越界' });
      return { config: { repo, branch: config.branch ?? 'HEAD', path, glob: config.glob ?? '**/*' }, budget: GITHUB_BUDGET };
    }
    if (Object.keys(config).some((key) => !['url', 'crawlMode'].includes(key)) || typeof config.url !== 'string' || (config.crawlMode !== undefined && config.crawlMode !== 'single_page'))
      throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: 'Web 来源当前仅支持单页读取，字段无效' });
    let url: URL;
    try { url = new URL(config.url); } catch { throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: 'Web URL 无效' }); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new BadRequestException({ code: 'SOURCE_URL_NOT_ALLOWED', message: 'Web URL scheme 或凭证不允许' });
    const hosts = configuredList('QITU_KNOWLEDGE_WEB_HOSTS').map((host) => host.toLowerCase());
    if (!hosts.includes(url.hostname.toLowerCase())) throw new BadRequestException({ code: 'SOURCE_HOST_NOT_ALLOWED', message: 'Web host 不在服务端 allowlist' });
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      throw new BadRequestException({ code: 'SOURCE_URL_NOT_ALLOWED', message: 'Web host 解析到非公网地址或不可达' });
    return { config: { url: url.toString(), crawlMode: 'single_page' }, budget: WEB_BUDGET };
  }

  async prepare(source: { kind: string; source_config: Record<string, unknown> }): Promise<PreparedSourceBatch> {
    const validated = await this.validateSource(source.kind, source.source_config);
    if (source.kind === 'folder') return this.readFolder(validated.config.path as string);
    if (source.kind === 'github') return this.readGitHub(validated.config);
    return this.readWeb(validated.config);
  }

  private async readFolder(rootPath: string): Promise<PreparedSourceBatch> {
    const documents: PreparedSourceDocument[] = [];
    let bytes = 0;
    let entriesSeen = 0;
    const controller = new AbortController();
    const checkBudget = () => {
      if (controller.signal.aborted) throw new KnowledgeSourceReadError('SOURCE_SYNC_TIMEOUT');
    };
    const visit = async (directory: string): Promise<void> => {
      checkBudget();
      const entries = await readdir(directory, { withFileTypes: true });
      entriesSeen += entries.length;
      if (entriesSeen > FOLDER_BUDGET.entries)
        throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
      for (const entry of entries) {
        checkBudget();
        const absolute = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await visit(absolute); continue; }
        if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        if (documents.length >= FOLDER_BUDGET.files) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
        const canonical = await realpath(absolute);
        const rel = relative(rootPath, canonical);
        if (rel.startsWith('..') || rel.startsWith('/')) throw new KnowledgeSourceReadError('SOURCE_PATH_NOT_ALLOWED');
        const size = (await stat(canonical)).size;
        if (size > FOLDER_BUDGET.fileBytes || bytes + size > FOLDER_BUDGET.bytes) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
        const content = await readFile(canonical, { encoding: 'utf8', signal: controller.signal });
        checkBudget();
        if (!content.trim()) continue;
        bytes += size;
        documents.push({ title: basename(entry.name).slice(0, 160), content, revision: checksum(content) });
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new KnowledgeSourceReadError('SOURCE_SYNC_TIMEOUT'));
      }, FOLDER_BUDGET.timeoutMs);
    });
    try {
      await Promise.race([visit(rootPath), timeout]);
    } catch (error) {
      if (error instanceof KnowledgeSourceReadError) throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new KnowledgeSourceReadError('SOURCE_SYNC_TIMEOUT');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
    if (!documents.length) throw new KnowledgeSourceReadError('SOURCE_NO_DOCUMENTS');
    return { documents, discovered: documents.length, accepted: documents.length, rejected: 0, bytesRead: bytes, pagesRead: 0, sourceRevision: checksum(documents.map((item) => item.revision).sort().join(':')) };
  }

  private async readGitHub(config: Record<string, unknown>): Promise<PreparedSourceBatch> {
    const repo = config.repo as string;
    const branch = encodeURIComponent(String(config.branch));
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'qitu-knowledge-center' };
    const treeResponse = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { redirect: 'error', signal: AbortSignal.timeout(GITHUB_BUDGET.timeoutMs), headers }).catch(() => null);
    if (!treeResponse?.ok) throw new KnowledgeSourceReadError('SOURCE_REMOTE_UNAVAILABLE');
    const treeText = await boundedText(treeResponse, 5 * 1024 * 1024);
    if (Buffer.byteLength(treeText) > 5 * 1024 * 1024) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
    const tree = JSON.parse(treeText) as { sha?: string; truncated?: boolean; tree?: { path: string; type: string; sha: string; size?: number }[] };
    if (tree.truncated) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
    const prefix = String(config.path ?? '');
    const glob = String(config.glob ?? '**/*');
    const matcher = globMatcher(glob);
    const eligible = (tree.tree ?? []).filter((item) => item.type === 'blob' && TEXT_EXTENSIONS.has(extname(item.path).toLowerCase()) && (!prefix || item.path.startsWith(`${prefix}/`)) && matcher.test(item.path));
    if (eligible.length > GITHUB_BUDGET.files) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
    const selected = eligible;
    if (!selected.length) throw new KnowledgeSourceReadError('SOURCE_NO_DOCUMENTS');
    const documents: PreparedSourceDocument[] = [];
    let bytes = 0;
    for (const item of selected) {
      if ((item.size ?? 0) > GITHUB_BUDGET.fileBytes || bytes + (item.size ?? 0) > GITHUB_BUDGET.bytes) throw new KnowledgeSourceReadError('SOURCE_SYNC_BUDGET_EXCEEDED');
      const blob = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${encodeURIComponent(item.sha)}`, { redirect: 'error', signal: AbortSignal.timeout(GITHUB_BUDGET.timeoutMs), headers }).catch(() => null);
      if (!blob?.ok) throw new KnowledgeSourceReadError('SOURCE_REMOTE_UNAVAILABLE');
      const payload = JSON.parse(await boundedText(blob, 8 * 1024 * 1024)) as { encoding?: string; content?: string };
      if (payload.encoding !== 'base64' || typeof payload.content !== 'string') throw new KnowledgeSourceReadError('SOURCE_REMOTE_INVALID');
      const content = Buffer.from(payload.content, 'base64').toString('utf8');
      bytes += Buffer.byteLength(content);
      documents.push({ title: basename(item.path).slice(0, 160), content, revision: item.sha });
    }
    return { documents, discovered: (tree.tree ?? []).filter((item) => item.type === 'blob').length, accepted: documents.length, rejected: Math.max(0, (tree.tree ?? []).length - documents.length), bytesRead: bytes, pagesRead: 0, sourceRevision: tree.sha ?? checksum(documents.map((item) => item.revision).join(':')) };
  }

  private async readWeb(config: Record<string, unknown>): Promise<PreparedSourceBatch> {
    const url = config.url as string;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(WEB_BUDGET.timeoutMs), headers: { accept: 'text/plain,text/markdown' } }).catch(() => null);
    if (!response?.ok) throw new KnowledgeSourceReadError('SOURCE_REMOTE_UNAVAILABLE');
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!['text/plain', 'text/markdown'].includes(type ?? '')) throw new KnowledgeSourceReadError('SOURCE_CONTENT_TYPE_UNSUPPORTED');
    const body = await boundedText(response, WEB_BUDGET.bytes);
    const bytes = Buffer.byteLength(body);
    if (!body.trim()) throw new KnowledgeSourceReadError('SOURCE_NO_DOCUMENTS');
    const sourceRevision = response.headers.get('etag') ?? response.headers.get('last-modified') ?? checksum(body);
    const parsed = new URL(url);
    return { documents: [{ title: parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname, content: body, revision: sourceRevision }], discovered: 1, accepted: 1, rejected: 0, bytesRead: bytes, pagesRead: 1, sourceRevision };
  }

  async create(actor: CurrentUser, baseId: string, body: unknown, key: string) {
    const input = record(body);
    if (Object.keys(input).some((field) => !['kind', 'sourceConfig', 'credentialRef'].includes(field)) || typeof input.kind !== 'string')
      throw new BadRequestException({ code: 'SOURCE_CONFIG_INVALID', message: '来源创建请求无效' });
    if (input.credentialRef !== undefined)
      throw new BadRequestException({ code: 'CONFIG_REFERENCE_INVALID', message: '本服务未登记可用于知识来源的 credentialRef' });
    const validated = await this.validateSource(input.kind, input.sourceConfig);
    const base = await this.center.base(baseId);
    if (base.kind === 'project' || base.lifecycle !== 'active') throw new BadRequestException({ code: 'SOURCE_BASE_NOT_ALLOWED', message: '该知识库不能添加来源' });
    const fingerprint = checksum(JSON.stringify({ kind: input.kind, config: validated.config }));
    const sourceId = `source-${checksum(`${baseId}:${fingerprint}`).slice(0, 40)}`;
    const requestHash = fingerprint;
    await this.center.database().transaction(async (tx) => {
      const auditKey = `knowledge.source.create.${actor.id}.${baseId}.${key}`;
      const [sameKey] = rows<{ detail: { requestHash?: string } }>(await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`));
      if (sameKey && sameKey.detail?.requestHash !== requestHash)
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于其他来源请求' });
      const [existing] = rows<{ id: string }>(await tx.execute(sql`SELECT id FROM knowledge_sources WHERE kb_id=${baseId} AND kind=${input.kind} AND source_fingerprint=${fingerprint} FOR UPDATE`));
      if (existing) return;
      const inserted = rows<{ id: string }>(await tx.execute(sql`INSERT INTO knowledge_sources(id,kb_id,kind,source_config,credential_ref,status,created_by,source_fingerprint) VALUES(${sourceId},${baseId},${input.kind},${JSON.stringify(validated.config)}::jsonb,NULL,'active',${actor.id},${fingerprint}) ON CONFLICT(kb_id,kind,source_fingerprint) DO NOTHING RETURNING id`));
      if (!inserted.length) return;
      await tx.execute(sql`UPDATE knowledge_bases SET revision=revision+1,updated_at=now() WHERE id=${baseId}`);
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'knowledge.source.create', targetType: 'knowledge_source', targetId: sourceId, idempotencyKey: auditKey, detail: { sourceId, baseId, kind: input.kind, fingerprint, requestHash } }, tx);
    });
    return this.center.base(baseId);
  }

  async sync(actor: CurrentUser, baseId: string, sourceId: string, body: unknown, key: string) {
    const input = record(body);
    if (Object.keys(input).some((field) => !['reason', 'expectedSourceRevision'].includes(field)) || (input.reason !== undefined && input.reason !== 'manual'))
      throw new BadRequestException({ code: 'SOURCE_SYNC_REQUEST_INVALID', message: '仅支持手动同步请求' });
    const base = await this.center.base(baseId);
    const idempotencyKey = `${actor.id}:${key}`;
    // 存储与查找必须用**同一个**作用域键：否则重放时查不到既有 run，
    // 会走到 INSERT 撞确定性 jobId 主键 → 500，而不是幂等重放；
    // 且 IDEMPOTENCY_CONFLICT（同键异 payload → 409）永远不可达。
    const scopedKey = `${sourceId}:${idempotencyKey}`;
    const [source] = await this.center.query<{ id: string; source_config: Record<string, unknown>; kind: string; status: string; last_source_revision: string | null }>(sql`SELECT id,source_config,kind,status,last_source_revision FROM knowledge_sources WHERE id=${sourceId} AND kb_id=${baseId}`);
    if (!source || source.status === 'revoked') throw new NotFoundException('来源不可用');
    const budget = source.kind === 'web' ? WEB_BUDGET : source.kind === 'github' ? GITHUB_BUDGET : FOLDER_BUDGET;
    const requestHash = checksum(JSON.stringify({ baseId, sourceId, sourceRevision: input.expectedSourceRevision ?? null, reason: 'manual' }));
    const jobId = `sync-${checksum(scopedKey).slice(0, 40)}`;
    await this.center.database().transaction(async (tx) => {
      const [prior] = rows<{ request_hash: string }>(await tx.execute(sql`SELECT request_hash FROM knowledge_sync_runs WHERE source_id=${sourceId} AND idempotency_key=${scopedKey} FOR UPDATE`));
      if (prior) {
        if (prior.request_hash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于其他同步请求' });
        return;
      }
      if (input.expectedSourceRevision !== undefined && input.expectedSourceRevision !== source.last_source_revision)
        throw new ConflictException({ code: 'CONFIG_REVISION_CONFLICT', message: '来源修订已变化' });
      const [active] = rows<{ revision: number }>(await tx.execute(sql`SELECT revision FROM knowledge_bases WHERE id=${baseId} AND lifecycle='active' FOR UPDATE`));
      if (!active) throw new NotFoundException('知识库不可用');
      await tx.execute(sql`INSERT INTO knowledge_sync_runs(id,source_id,idempotency_key,request_hash,budget_snapshot,state) VALUES(${jobId},${sourceId},${scopedKey},${requestHash},${JSON.stringify(budget)}::jsonb,'queued')`);
      await tx.execute(sql`UPDATE knowledge_bases SET revision=revision+1,build_state='queued',updated_at=now() WHERE id=${baseId}`);
      await tx.execute(sql`INSERT INTO knowledge_jobs(id,kb_id,source_id,request_hash,budget_snapshot,operation,input_revision,state) VALUES(${jobId},${baseId},${sourceId},${requestHash},${JSON.stringify(budget)}::jsonb,'sync',${active.revision + 1},'queued')`);
      await tx.execute(sql`UPDATE knowledge_sources SET status='syncing',updated_at=now() WHERE id=${sourceId}`);
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'knowledge.source.sync.request', targetType: 'knowledge_source', targetId: sourceId, idempotencyKey: `knowledge.source.sync.${actor.id}.${sourceId}.${key}`, detail: { sourceId, baseId, requestHash, budgetHash: checksum(JSON.stringify(budget)) } }, tx);
    });
    return this.center.base(baseId);
  }
}
