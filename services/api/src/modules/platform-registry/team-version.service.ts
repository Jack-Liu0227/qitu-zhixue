import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { adminAssistants, adminTeamMembers, adminTeams, adminTeamVersions, agentConfigs, agentMcpBindings, runtimeMcpServers, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { PlatformRegistryService } from './platform-registry.service';
import { runtimeIdsForAssistant } from './assistant-runtime-identity';
import { TEAM_PUBLICATION_SCHEMA, freezeTeamAssistant, readPublishedAssistant } from './team-version.snapshot';
import {
  projectPublishedTeamRuntime,
  type PublishedRuntimeMember,
  type RuntimeProjectionResult,
} from './team-version.runtime';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

type VersionRow = typeof adminTeamVersions.$inferSelect;
export function parseTeamVersionPublish(body: unknown): { expectedUpdatedAt: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('发布请求必须为对象');
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some(key => key !== 'expectedUpdatedAt') || typeof row.expectedUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.expectedUpdatedAt))) throw new BadRequestException({ code: 'TEAM_VERSION_INPUT_INVALID', message: '仅接受当前团队的 expectedUpdatedAt；快照由服务端生成。' });
  return { expectedUpdatedAt: row.expectedUpdatedAt };
}
function requireAdmin(actor: CurrentUser) {
  if (actor.role !== 'admin') throw new ForbiddenException('团队版本发布仅管理员可用');
}
function semanticContent(row: Pick<VersionRow, 'id' | 'teamId' | 'version' | 'name' | 'description' | 'workspaceMode' | 'sessionMode' | 'leaderAssistantId' | 'enabled' | 'members' | 'pblSpec'>) {
  const { teamVersionPublication: _publication, ...pblSpec } = row.pblSpec;
  return { id: row.id, teamId: row.teamId, version: row.version, name: row.name, description: row.description,
    workspaceMode: row.workspaceMode, sessionMode: row.sessionMode, leaderAssistantId: row.leaderAssistantId,
    enabled: row.enabled, members: row.members, pblSpec };
}
export function teamVersionContentDigest(row: Parameters<typeof semanticContent>[0]) {
  return teachingValueDigest(semanticContent(row));
}
export function teamVersionView(row: VersionRow) {
  const publication = row.pblSpec.teamVersionPublication as Record<string, unknown> | undefined;
  if (publication && (publication.schemaVersion !== TEAM_PUBLICATION_SCHEMA || publication.digest !== teamVersionContentDigest(row))) {
    throw new ConflictException({ code: 'TEAM_VERSION_DIGEST_MISMATCH', message: '团队版本摘要不一致，已停止使用。' });
  }
  if (publication) for (const raw of row.members) {
    const member = raw as Record<string, unknown>;
    readPublishedAssistant(member.runtimeSnapshot, String(member.assistantId));
  }
  return { id: row.id, teamId: row.teamId, version: row.version, name: row.name, leaderAssistantId: row.leaderAssistantId,
    members: row.members, snapshotDigest: publication?.digest ?? null,
    runtimeSnapshotStatus: publication ? 'published' as const : 'legacy_unpinned' as const,
    sourceUpdatedAt: publication?.sourceUpdatedAt ?? null, createdAt: row.createdAt.toISOString() };
}

/** The only team publication writer. Existing versions have no update endpoint. */
@Injectable()
export class TeamVersionService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly registry: PlatformRegistryService, private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter) {}

  async publish(actor: CurrentUser, teamId: string, body: unknown, key: string) {
    requireAdmin(actor);
    if (!key?.trim() || key.length > 160) throw new BadRequestException('Idempotency-Key 无效');
    const input = parseTeamVersionPublish(body);
    const db = this.database();
    const scope = `admin.team.version:${actor.id}:${teamId}`;
    const requestHash = hashIdempotentInput(scope, { teamId }, input);
    const versionId = `team-version-${createHash('sha256').update(`${scope}:${key}`).digest('hex').slice(0, 32)}`;
    await this.idempotency.execute(scope, key, requestHash, async () => {
      await db.transaction(async tx => {
        const [team] = await tx.select().from(adminTeams).where(eq(adminTeams.id, teamId)).for('update');
        if (!team) throw new NotFoundException('团队不存在，不能发布内置目录的临时投影');
        const [existing] = await tx.select().from(adminTeamVersions).where(eq(adminTeamVersions.id, versionId));
        if (existing) {
          const published = existing.pblSpec.teamVersionPublication as Record<string, unknown> | undefined;
          if (published?.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '同一发布请求的内容已改变。' });
          teamVersionView(existing);
          return;
        }
        if (team.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictException({ code: 'TEAM_VERSION_SOURCE_CHANGED', message: '团队已被修改，请回读后重新发布。' });
        if (!team.enabled || !team.pblSpec || team.pblSpec.theoryMasteredGate !== true || team.pblSpec.allowAutonomousAdvance !== false) {
          throw new BadRequestException({ code: 'TEAM_VERSION_WORKFLOW_INVALID', message: '发布需要启用团队并配置保留理论门禁的 PBL 工作流。' });
        }
        const members = await tx.select().from(adminTeamMembers).where(eq(adminTeamMembers.teamId, teamId)).orderBy(asc(adminTeamMembers.sortOrder)).for('share');
        const ids = members.map(member => member.assistantId);
        if (!ids.length || ids.length > 24 || new Set(ids).size !== ids.length || !ids.includes(team.leaderAssistantId)) throw new BadRequestException('团队成员或负责人配置无效');
        // Hold shared source locks while the established resolver reads committed configuration.
        const assistants = await tx.select().from(adminAssistants).where(inArray(adminAssistants.id, [...ids].sort())).orderBy(asc(adminAssistants.id)).for('share');
        if (assistants.length !== ids.length || assistants.some(assistant => !assistant.enabled)) throw new BadRequestException('团队引用了不存在或停用的助手');
        const runtimeIds = [...new Set(ids.flatMap(id => runtimeIdsForAssistant(id)))].sort();
        await tx.select().from(agentConfigs).where(inArray(agentConfigs.id, runtimeIds)).orderBy(asc(agentConfigs.id)).for('share');
        await tx.select().from(agentMcpBindings).where(inArray(agentMcpBindings.agentId, runtimeIds)).for('share');
        const mcpIds = [...new Set(assistants.flatMap(assistant => assistant.mcpServerIds))];
        if (mcpIds.length) await tx.select().from(runtimeMcpServers).where(inArray(runtimeMcpServers.id, mcpIds)).for('share');
        const assistantsById = new Map(assistants.map(assistant => [assistant.id, assistant]));
        const snapshots = [];
        const runtimeMembers: PublishedRuntimeMember[] = [];
        for (const member of members) {
          const runtime = await this.registry.getAssistantRuntime(member.assistantId);
          if (runtime.agent.id !== member.assistantId) throw new ConflictException('助手运行时身份与团队成员不一致');
          const runtimeSnapshot = freezeTeamAssistant(runtime);
          snapshots.push({ slotId: member.slotId, assistantId: member.assistantId, role: member.role,
            roleLabel: member.roleLabel, pblPhase: member.pblPhase, runtimeSnapshot });
          runtimeMembers.push({
            assistantId: member.assistantId,
            displayName: assistantsById.get(member.assistantId)?.name ?? member.assistantId,
            role: member.role,
            roleLabel: member.roleLabel ?? member.role,
            snapshot: runtimeSnapshot,
            live: runtime,
          });
        }
        const [latest] = await tx.select().from(adminTeamVersions).where(eq(adminTeamVersions.teamId, teamId)).orderBy(desc(adminTeamVersions.version)).limit(1);
        const row: VersionRow = { id: versionId, teamId, version: (latest?.version ?? 0) + 1, name: team.name,
          description: team.description, workspaceMode: team.workspaceMode, sessionMode: team.sessionMode,
          leaderAssistantId: team.leaderAssistantId, members: snapshots, pblSpec: { ...team.pblSpec },
          enabled: true, createdBy: actor.id, createdAt: new Date() };
        const digest = teamVersionContentDigest(row);
        row.pblSpec.teamVersionPublication = { schemaVersion: TEAM_PUBLICATION_SCHEMA, requestHash,
          sourceUpdatedAt: team.updatedAt.toISOString(), digest };
        await tx.insert(adminTeamVersions).values(row);
        await projectPublishedTeamRuntime(tx, row, runtimeMembers, actor, row.createdAt);
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.team.version.publish',
          targetType: 'admin_team_version', targetId: versionId, idempotencyKey: `${scope}:${key}`,
          detail: { teamId, version: row.version, snapshotDigest: digest, memberCount: snapshots.length,
            runtimeProjection: runtimeMembers.map(member => member.assistantId).sort() } }, tx);
      });
      return { status: 201, body: { id: versionId } };
    });
    return this.read(actor, teamId, versionId);
  }

  /**
   * Explicit idempotent repair for versions published before runtime
   * projection was introduced. The version snapshot is never rewritten.
   */
  async projectRuntime(actor: CurrentUser, teamId: string, versionId: string, key: string): Promise<RuntimeProjectionResult> {
    requireAdmin(actor);
    if (!key?.trim() || key.length > 160) throw new BadRequestException('Idempotency-Key 无效');
    const db = this.database();
    const scope = `admin.team.version.runtime:${actor.id}:${teamId}:${versionId}`;
    const requestHash = hashIdempotentInput(scope, { teamId, versionId }, {});
    const result = await this.idempotency.execute(scope, key, requestHash, async () => {
      const [row] = await db.select().from(adminTeamVersions)
        .where(eq(adminTeamVersions.id, versionId)).limit(1);
      if (!row || row.teamId !== teamId) throw new NotFoundException('团队版本回读失败');
      teamVersionView(row);

      const memberRows = row.members as Array<Record<string, unknown>>;
      const assistantIds = memberRows.map(member => String(member.assistantId));
      const assistants = await db.select().from(adminAssistants)
        .where(inArray(adminAssistants.id, assistantIds));
      const assistantsById = new Map(assistants.map(assistant => [assistant.id, assistant]));
      const runtimeMembers: PublishedRuntimeMember[] = [];
      for (const member of memberRows) {
        const assistantId = String(member.assistantId);
        const snapshot = readPublishedAssistant(member.runtimeSnapshot, assistantId);
        const live = await this.registry.getAssistantRuntime(assistantId);
        if (live.agent.id !== assistantId) throw new ConflictException('ASSISTANT_RUNTIME_IDENTITY_MISMATCH');
        runtimeMembers.push({
          assistantId,
          displayName: assistantsById.get(assistantId)?.name ?? assistantId,
          role: String(member.role ?? 'custom'),
          roleLabel: String(member.roleLabel ?? member.role ?? assistantId),
          snapshot,
          live,
        });
      }

      let projection: RuntimeProjectionResult | null = null;
      await db.transaction(async tx => {
        const [locked] = await tx.select().from(adminTeamVersions)
          .where(eq(adminTeamVersions.id, versionId)).for('update');
        if (!locked || locked.teamId !== teamId) throw new NotFoundException('团队版本回读失败');
        teamVersionView(locked);
        projection = await projectPublishedTeamRuntime(tx, locked, runtimeMembers, actor);
        await this.audit.write({
          actorId: actor.id,
          actorRole: actor.role,
          action: 'admin.team.version.runtime_projection',
          targetType: 'admin_team_version',
          targetId: versionId,
          idempotencyKey: `${scope}:${key}`,
          detail: { teamId, ...projection },
        }, tx);
      });
      if (projection === null) throw new ServiceUnavailableException('团队运行时投影未返回结果');
      return { status: 200, body: projection };
    });
    return result.body;
  }

  async read(actor: CurrentUser, teamId: string, id: string) {
    requireAdmin(actor);
    const [row] = await this.database().select().from(adminTeamVersions).where(eq(adminTeamVersions.id, id));
    if (!row || row.teamId !== teamId) throw new NotFoundException('团队版本回读失败');
    return teamVersionView(row);
  }

  async list(actor: CurrentUser, teamId: string) {
    requireAdmin(actor);
    const rows = await this.database().select().from(adminTeamVersions).where(eq(adminTeamVersions.teamId, teamId)).orderBy(desc(adminTeamVersions.version)).limit(100);
    return rows.map(teamVersionView);
  }

  async catalog(actor: CurrentUser) {
    requireAdmin(actor);
    const rows = await this.database().select().from(adminTeamVersions).orderBy(desc(adminTeamVersions.createdAt)).limit(100);
    return rows.map(row => {
      const view = teamVersionView(row);
      return { ...view, members: row.members.map(raw => {
        const { runtimeSnapshot, ...member } = raw as Record<string, unknown>;
        if (!runtimeSnapshot) return member;
        const { roleDefinition: _role, agentDefinition: _prompt, ...pins } = readPublishedAssistant(runtimeSnapshot, String(member.assistantId));
        return { ...member, runtimeSnapshot: pins };
      }) };
    });
  }

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException({ code: 'TEAM_VERSION_STORAGE_UNAVAILABLE', message: '团队版本存储不可用，不能发布或伪造持久化结果。' });
    return this.db;
  }
}
