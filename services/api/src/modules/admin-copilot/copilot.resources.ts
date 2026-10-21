import { ForbiddenException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { runtimeMcpServers, adminTeamVersions, adminAssistants, agentMcpBindings, type Database } from '@qitu/database';
import { archiveTeachingSkill } from './copilot.skill-archive';
import { ADMIN_COPILOT_CONTRACT_VERSION, ADMIN_COPILOT_OPERATIONS, type CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { loadRuntimeSkillCatalog, loadTutorRuntimeSource, type TutorRuntimeSkill } from '../../common/tutor-runtime/runtime-source';
import { exact, invalid, text } from './copilot.protocol';

export const MANAGEMENT_SKILL_ID = 'qitu-project-configurator';
export const MANAGEMENT_OPERATIONS_DIGEST = createHash('sha256')
  .update(JSON.stringify(ADMIN_COPILOT_OPERATIONS)).digest('hex');

export function validateManagementSkill(skill: TutorRuntimeSkill | undefined) {
  if (!skill || skill.id !== MANAGEMENT_SKILL_ID || skill.runtime !== 'admin' || skill.status !== 'ready' || skill.publicationStatus !== 'published') {
    throw new ServiceUnavailableException({ code: 'COPILOT_SKILL_UNAVAILABLE', message: 'Admin 管家 Skill 未发布或不可用，请检查统一技能目录。' });
  }
  const declarations = [...skill.content.matchAll(/<!-- qitu-copilot-contract: (\{[^\n]+\}) -->/g)];
  let declaration: { version?: string; operationsDigest?: string } = {};
  try { if (declarations.length === 1) declaration = JSON.parse(declarations[0]![1]!); } catch { /* Fail closed below. */ }
  if (skill.version !== ADMIN_COPILOT_CONTRACT_VERSION || declaration.version !== ADMIN_COPILOT_CONTRACT_VERSION ||
    declaration.operationsDigest !== MANAGEMENT_OPERATIONS_DIGEST) {
    throw new ServiceUnavailableException({ code: 'COPILOT_SKILL_CONTRACT_MISMATCH', message: '管家 Skill 与服务端能力目录不一致，配置操作已停用；请同步版本与能力摘要。' });
  }
  return { id: skill.id, digest: skill.contentHash, content: skill.content, version: skill.version };
}
export async function managementSkill() {
  return validateManagementSkill(loadRuntimeSkillCatalog().skills.find(item => item.id === MANAGEMENT_SKILL_ID));
}

/** Resource registration; execution adapters and credentials remain with their existing owners. */
@Injectable()
export class CopilotResources {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
  ) {}

  async deleteSkill(actor: CurrentUser, input: Record<string, unknown>, key: string) {
    const id = await archiveTeachingSkill(actor, input, key, this.audit);
    return { ...await this.readSkill(actor, id), deleted: true, deletionMode: 'soft' };
  }

  async deleteMcp(actor: CurrentUser, id: string, key: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('Admin required');
    if (!/^[a-z][a-z0-9-]*$/.test(id) || id === 'ima-knowledge') invalid('内置 IMA 请使用停用，不允许删除');
    if (!this.db) throw new ServiceUnavailableException('MCP 存储不可用');
    await this.db.transaction(async tx => {
      const [current] = await tx.select().from(runtimeMcpServers).where(eq(runtimeMcpServers.id, id)).for('update');
      if (!current) throw new NotFoundException('MCP 不存在');
      if (current.enabled || current.secretRef) throw new ConflictException('已启用或带驱动凭据的 MCP 须由其 owner 管理');
      const assistants = await tx.select({ id: adminAssistants.id }).from(adminAssistants).where(sql`${adminAssistants.mcpServerIds} @> ${JSON.stringify([id])}::jsonb`).limit(1);
      const agents = await tx.select({ id: agentMcpBindings.agentId }).from(agentMcpBindings).where(eq(agentMcpBindings.mcpServerId, id)).limit(1);
      const versions = await tx.select({ id: adminTeamVersions.id }).from(adminTeamVersions).where(sql`${adminTeamVersions.members} @> ${JSON.stringify([{ runtimeSnapshot: { mcpPermissions: [{ serverId: id }] } }])}::jsonb`).limit(1);
      if (assistants.length || agents.length || versions.length) throw new ConflictException({ code: 'MCP_IN_USE', message: 'MCP 仍被助手、Agent 或冻结团队引用，请先解除关联' });
      await tx.delete(runtimeMcpServers).where(eq(runtimeMcpServers.id, id));
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.mcp.delete',
        targetType: 'runtime_mcp_server', targetId: id, idempotencyKey: key, detail: { deletionMode: 'registration_only' } }, tx);
    });
    return { id, deleted: true, deletionMode: 'registration_only' };
  }

  async assertMcpDeleted(id: string) {
    if (!this.db) throw new ServiceUnavailableException('MCP 存储不可用');
    const [current] = await this.db.select().from(runtimeMcpServers).where(eq(runtimeMcpServers.id, id));
    if (current) throw new ConflictException('MCP 删除尚未确认');
    return { id, deleted: true, deletionMode: 'registration_only' };
  }

  /** Current catalog facts only; prior mutation receipts are never evidence of current publication. */
  async readSkill(actor: CurrentUser, id: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('Admin required');
    if (id.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) invalid('Invalid canonical skill ID');
    const catalog = loadRuntimeSkillCatalog();
    if (catalog.skillsSource?.status !== 'ready') throw new ServiceUnavailableException('Runtime skill catalog unavailable');
    const skill = catalog.skills.find(item => item.id === id);
    if (!skill) return this.readManagedSkillDraft(catalog.root, id);
    const enabled = skill.runtime === 'teaching' && skill.status === 'ready' && skill.publicationStatus === 'published';
    const status = skill.publicationStatus === 'quarantined' ? 'draft'
      : skill.publicationStatus === 'published' && skill.status !== 'ready' ? 'unavailable' : skill.publicationStatus;
    return { id: skill.id, version: skill.version, digest: skill.contentHash, status, enabled,
      runtime: skill.runtime, publicationStatus: skill.publicationStatus };
  }

  /** Admin-only fallback for managed drafts intentionally absent from every runtime catalog. */
  private async readManagedSkillDraft(projectRoot: string, id: string) {
    try {
      const root = await realpath(join(projectRoot, '.agents', 'skills'));
      const directory = await realpath(join(root, id));
      const rel = relative(root, directory);
      if (rel !== id || isAbsolute(rel)) invalid('Skill draft path is outside its canonical directory');
      const path = join(directory, 'SKILL.md');
      if (await realpath(path) !== path) invalid('Linked skill draft files are not supported');
      const info = await stat(path);
      if (!info.isFile()) invalid('Invalid skill draft file');
      const raw = await readFile(path, 'utf8');
      if (await realpath(path) !== path) invalid('Skill draft path changed while reading');
      const header = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!header) invalid('Managed draft frontmatter is missing');
      const metadata: Record<string, string> = Object.create(null);
      for (const line of header[1]!.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const separator = line.indexOf(':');
        const field = line.slice(0, separator).trim();
        if (separator < 1 || Object.hasOwn(metadata, field)) invalid('Invalid or duplicated draft metadata');
        const value = line.slice(separator + 1).trim();
        try { metadata[field] = value.startsWith('"') ? JSON.parse(value) : value.replace(/^'(.*)'$/, '$1'); }
        catch { invalid('Invalid quoted draft metadata'); }
        if (typeof metadata[field] !== 'string') invalid('Draft metadata must contain strings');
      }
      if (metadata.name !== id || metadata['managed-by'] !== 'admin-copilot' || metadata.runtime !== 'dev-only' ||
          metadata.status !== 'quarantined' || !metadata.version?.trim() || metadata.version.length > 40 ||
          !raw.slice(header[0].length).trim()) invalid('Skill is not a managed quarantined draft');
      return { id, version: metadata.version, digest: createHash('sha256').update(raw).digest('hex'),
        status: 'draft', enabled: false, runtime: 'dev-only', publicationStatus: 'quarantined' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('Runtime skill no longer exists');
      if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EPERM') {
        throw new ServiceUnavailableException('Skill draft cannot be read');
      }
      throw error;
    }
  }

  async readTeamVersion(id: string) {
    if (!this.db) throw new ServiceUnavailableException({ code: 'COPILOT_SCOPE_UNAVAILABLE', message: '团队版本存储不可用，无法确认模板关联范围。' });
    const [team] = await this.db.select().from(adminTeamVersions).where(eq(adminTeamVersions.id, id));
    if (!team) throw new ServiceUnavailableException({ code: 'COPILOT_SCOPE_UNAVAILABLE', message: '绑定的团队版本不存在，不能改用草稿关联。' });
    return team;
  }

  async createSkill(actor: CurrentUser, input: Record<string, unknown>, key: string) {
    exact(input, ['id', 'description', 'version', 'content']);
    const id = text(input.id, 'id', 64);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) invalid('Skill ID 只能包含小写字母、数字、连字符');
    const description = text(input.description, 'description', 500);
    const version = text(input.version, 'version', 40);
    const body = text(input.content, 'content', Number.POSITIVE_INFINITY);
    if (/[\r\n]/.test(description + version)) invalid('Skill 元数据必须是单行');
    const content = `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\nversion: ${JSON.stringify(version)}\nruntime: dev-only\nstatus: quarantined\nmanaged-by: admin-copilot\n---\n\n${body}\n`;
    const root = await realpath(join(loadTutorRuntimeSource().root, '.agents', 'skills'));
    const directory = join(root, id);
    await mkdir(directory, { recursive: true });
    const actual = await realpath(directory);
    const rel = relative(root, actual);
    if (rel !== id || isAbsolute(rel)) invalid('Skill 路径越界或使用了目录链接');
    const path = join(actual, 'SKILL.md');
    const digest = createHash('sha256').update(content).digest('hex');
    await this.audit.write({
      actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.skill.register.requested',
      targetType: 'runtime_skill', targetId: id, idempotencyKey: `${key}:requested`, detail: { digest },
    });
    try { await writeFile(path, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ServiceUnavailableException('Skill 目录不可写');
      if (await realpath(path) !== path) invalid('不允许修改链接文件');
      if (await readFile(path, 'utf8') !== content) {
        throw new ConflictException('Skill 已存在且内容不同；请使用新的 canonical ID');
      }
    }
    if (await readFile(path, 'utf8') !== content) throw new ServiceUnavailableException('Skill 草稿回读失败');
    await this.audit.write({
      actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.skill.registered',
      targetType: 'runtime_skill', targetId: id, idempotencyKey: `${key}:registered`, detail: { digest },
    });
    return { id, version, digest, status: 'draft', enabled: false };
  }

  async publishSkill(actor: CurrentUser, input: Record<string, unknown>, key: string) {
    exact(input, ['id', 'digest']);
    const id = text(input.id, 'id', 64);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) invalid('Skill ID 无效');
    const digest = text(input.digest, 'digest', 64);
    if (!/^[a-f0-9]{64}$/.test(digest)) invalid('需要完整的草稿 digest');
    const root = await realpath(join(loadTutorRuntimeSource().root, '.agents', 'skills'));
    const directory = await realpath(join(root, id));
    const rel = relative(root, directory);
    if (rel !== id || isAbsolute(rel)) invalid('Skill 路径越界或使用了目录链接');
    const path = join(directory, 'SKILL.md');
    if (await realpath(path) !== path) invalid('不允许发布链接文件');
    const lock = join(directory, '.publish-lock');
    try {
      // A crashed process must not leave publication permanently locked.
      const existingLock = await stat(lock).catch(() => null);
      if (existingLock && Date.now() - existingLock.mtimeMs > 180000) await unlink(lock);
      await writeFile(lock, key, { flag: 'wx' });
    }
    catch { throw new ConflictException('Skill 正在发布，请重试'); }
    const temporary = join(directory, `.publish-${key}`);
    try {
      const raw = await readFile(path, 'utf8');
      if (!raw.includes('\nmanaged-by: admin-copilot\n')) invalid('仅发布由管家创建的 Skill 草稿');
      const draft = raw.replace('\nstatus: published\n', '\nstatus: quarantined\n').replace('\nruntime: teaching\n', '\nruntime: dev-only\n');
      if (createHash('sha256').update(draft).digest('hex') !== digest) throw new ConflictException('Skill 内容已改变，请重新核对草稿');
      const published = draft.replace('\nstatus: quarantined\n', '\nstatus: published\n').replace('\nruntime: dev-only\n', '\nruntime: teaching\n');
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.skill.publish.requested',
        targetType: 'runtime_skill', targetId: id, idempotencyKey: `${key}:publish`,
        detail: { approvedDraftDigest: digest, publishedDigest: createHash('sha256').update(published).digest('hex') },
      });
      if (raw !== published) {
        await unlink(temporary).catch(() => undefined);
        await writeFile(temporary, published, { flag: 'wx' });
        await rename(temporary, path);
      }
      const skill = loadTutorRuntimeSource().skills.find(s => s.id === id && s.status === 'ready');
      if (!skill) throw new ServiceUnavailableException('Skill 发布后目录回读失败');
      return { id, version: skill.version, digest: skill.contentHash, status: 'published' };
    } finally {
      await unlink(temporary).catch(() => undefined);
      await unlink(lock);
    }
  }

  async revokeSkill(actor: CurrentUser, input: Record<string, unknown>, key: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('Admin required');
    exact(input, ['id', 'digest']);
    const id = text(input.id, 'id', 64);
    const digest = text(input.digest, 'digest', 64);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || !/^[a-f0-9]{64}$/.test(digest)) invalid('Invalid skill ID or digest');
    const root = await realpath(join(loadRuntimeSkillCatalog().root, '.agents', 'skills'));
    const directory = await realpath(join(root, id));
    if (relative(root, directory) !== id) invalid('Skill path is outside the catalog');
    const path = join(directory, 'SKILL.md');
    if (await realpath(path) !== path) invalid('Linked skill files are not supported');
    const lock = join(directory, '.publish-lock');
    const temporary = join(directory, '.revoke-' + createHash('sha256').update(key).digest('hex'));
    try {
      const prior = await stat(lock).catch(() => null);
      if (prior && Date.now() - prior.mtimeMs > 180000) await unlink(lock);
      await writeFile(lock, key, { flag: 'wx' });
    } catch { throw new ConflictException('Skill publication is busy'); }
    try {
      const raw = await readFile(path, 'utf8');
      const catalog = loadRuntimeSkillCatalog().skills.find(skill => skill.id === id);
      const replay = catalog?.publicationStatus === 'revoked' && raw.includes(`\nrevoked-from: ${digest}\n`);
      if (!replay) {
        if (catalog?.runtime !== 'teaching' || catalog.publicationStatus !== 'published'
          || catalog.contentHash !== digest) throw new ConflictException('Skill source changed or is not a published teaching skill');
        let revoked = raw.replace(/^(status:[^\r\n]*)(\r?\n)/m, 'status: revoked$2');
        if (revoked === raw) revoked = raw.replace(/^---\r?\n/, '---\nstatus: revoked\n');
        revoked = revoked.replace(/^---\r?\n/, `---\nrevoked-from: ${digest}\n`);
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.skill.revoke.requested',
          targetType: 'runtime_skill', targetId: id, idempotencyKey: `${key}:revoke`, detail: { previousDigest: digest } });
        await writeFile(temporary, revoked, { flag: 'wx' });
        await rename(temporary, path);
      }
      const fresh = loadRuntimeSkillCatalog().skills.find(skill => skill.id === id);
      if (!fresh || fresh.publicationStatus !== 'revoked' || fresh.status !== 'unavailable') throw new ServiceUnavailableException('Revocation readback failed');
      return { id, version: fresh.version, digest: fresh.contentHash, status: 'revoked' };
    } finally {
      await unlink(temporary).catch(() => undefined);
      await unlink(lock);
    }
  }

  async saveMcp(actor: CurrentUser, input: Record<string, unknown>, create: boolean) {
    exact(input, ['id', 'label', 'description', 'endpointOrigin', 'toolIds']);
    if (!this.db) throw new ServiceUnavailableException('MCP 配置存储不可用');
    const id = text(input.id, 'id');
    if (!/^[a-z][a-z0-9-]*$/.test(id) || id === 'ima-knowledge') invalid('IMA 使用 ima.configure；自定义 MCP 使用独立 ID');
    const label = text(input.label, 'label', 120);
    const description = text(input.description, 'description', 1000);
    const endpointOrigin = text(input.endpointOrigin, 'endpointOrigin', 500);
    let url: URL;
    try { url = new URL(endpointOrigin); } catch { invalid('MCP 地址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) invalid('MCP 使用无凭据的 HTTPS 地址');
    if (!Array.isArray(input.toolIds) || input.toolIds.length > 50) invalid('toolIds 无效');
    const toolIds = [...new Set(input.toolIds.map(v => text(v, 'toolId')))];
    const db = this.db;
    await db.transaction(async tx => {
      const [existing] = await tx.select().from(runtimeMcpServers).where(eq(runtimeMcpServers.id, id)).for('update');
      if (create && existing) {
        if (existing.label === label && existing.description === description && existing.endpointOrigin === endpointOrigin &&
          JSON.stringify(existing.toolIds) === JSON.stringify(toolIds) && !existing.enabled) return;
        throw new ConflictException('MCP ID 已存在且配置不同');
      }
      if (!create && !existing) throw new NotFoundException('MCP 不存在');
      if (existing?.enabled) throw new ConflictException('已启用 MCP 的连接须由其专用驱动管理');
      const row = { label, description, endpointOrigin, toolIds, transport: 'streamable_http',
        enabled: false, status: 'not_configured', updatedAt: new Date() };
      if (create) await tx.insert(runtimeMcpServers).values({ id, ...row });
      else await tx.update(runtimeMcpServers).set(row).where(eq(runtimeMcpServers.id, id));
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.copilot.mcp.register',
        targetType: 'runtime_mcp_server', targetId: id,
        detail: { enabled: false, status: 'not_configured', toolCount: toolIds.length },
      }, tx);
    });
    return { id, status: 'not_configured', enabled: false };
  }

  async readMcp(id: string) {
    if (!this.db) throw new ServiceUnavailableException('MCP 配置存储不可用');
    const [row] = await this.db.select().from(runtimeMcpServers).where(eq(runtimeMcpServers.id, id));
    if (!row) throw new NotFoundException('MCP 回读失败');
    return { id: row.id, label: row.label, status: row.status, enabled: row.enabled,
      toolIds: row.toolIds, endpointOrigin: row.endpointOrigin };
  }
}
