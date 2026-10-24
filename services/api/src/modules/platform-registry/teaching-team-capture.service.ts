import { assertDomainLeader } from '../../common/intake-boundary';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { adminAssistants, adminTeamMembers, adminTeams, agentConfigs, agentMcpBindings, runtimeMcpServers, type Database } from '@qitu/database';
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
} from './team-version.runtime';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

import type { TeamVersionRecord as VersionRow } from '../templates/templates-binding.types';
export function parseTeamVersionPublish(body: unknown): { expectedUpdatedAt: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('教学配置请求必须为对象');
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some(key => key !== 'expectedUpdatedAt') || typeof row.expectedUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.expectedUpdatedAt))) throw new BadRequestException({ code: 'TEAM_VERSION_INPUT_INVALID', message: '仅接受当前团队的 expectedUpdatedAt；快照由服务端生成。' });
  return { expectedUpdatedAt: row.expectedUpdatedAt };
}
function requireAdmin(actor: CurrentUser) {
  if (actor.role !== 'admin') throw new ForbiddenException('教学安排配置仅管理员可用');
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
    throw new ConflictException({ code: 'TEAM_VERSION_DIGEST_MISMATCH', message: '教学配置摘要不一致，已停止使用。' });
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

/** Captures configuration only for a server-owned teaching arrangement. No public endpoint. */
@Injectable()
export class TeachingTeamCaptureService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly registry: PlatformRegistryService, private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter) {}

  async capture(actor: CurrentUser, teamId: string, body: unknown, key: string): Promise<VersionRow> {
    requireAdmin(actor);
    if (!key?.trim() || key.length > 160) throw new BadRequestException('Idempotency-Key invalid');
    const input = parseTeamVersionPublish(body);
    const db = this.database();
    const scope = `admin.teaching.team-capture:${actor.id}:${teamId}`;
    const requestHash = hashIdempotentInput(scope, { teamId }, input);
    const versionId = `teaching-team-${createHash('sha256').update(`${scope}:${key}`).digest('hex').slice(0, 32)}`;
    const captured = await this.idempotency.execute(scope, key, requestHash, async () => {
      return db.transaction(async tx => {
        const [team] = await tx.select().from(adminTeams).where(eq(adminTeams.id, teamId)).for('update');
        if (!team) throw new NotFoundException('Team unavailable');
        if (team.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictException({ code: 'TEAM_VERSION_SOURCE_CHANGED', message: '团队已被修改，请回读后重新保存教学安排。' });
        const hasWorkflow = team.pblSpec && Object.keys(team.pblSpec).length > 0;
        if (!team.enabled || hasWorkflow
          && (!team.pblSpec || team.pblSpec.theoryMasteredGate !== true || team.pblSpec.allowAutonomousAdvance !== false)) {
          throw new BadRequestException({ code: 'TEAM_VERSION_WORKFLOW_INVALID', message: '保存教学安排需要启用团队并配置保留理论门禁的 PBL 工作流。' });
        }
        const members = await tx.select().from(adminTeamMembers).where(eq(adminTeamMembers.teamId, teamId)).orderBy(asc(adminTeamMembers.sortOrder)).for('share');
        assertDomainLeader(team.leaderAssistantId);
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
        const row: VersionRow = { id: versionId, teamId, version: 1, name: team.name,
          description: team.description, workspaceMode: team.workspaceMode, sessionMode: team.sessionMode,
          leaderAssistantId: team.leaderAssistantId, members: snapshots, pblSpec: { ...team.pblSpec },
          enabled: true, createdBy: actor.id, createdAt: new Date() };
        const digest = teamVersionContentDigest(row);
        row.pblSpec.teamVersionPublication = { schemaVersion: TEAM_PUBLICATION_SCHEMA, requestHash,
          sourceUpdatedAt: team.updatedAt.toISOString(), digest };
        await projectPublishedTeamRuntime(tx, row, runtimeMembers, actor, row.createdAt);
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'teaching.team.capture',
          targetType: 'admin_team', targetId: teamId, idempotencyKey: `${scope}:${key}`,
          detail: { snapshotId: row.id, snapshotDigest: digest, memberCount: snapshots.length } }, tx);
        return { body: { ...row, createdAt: row.createdAt.toISOString() } };
      });
    });
    return { ...captured.body, createdAt: new Date(captured.body.createdAt) };
  }

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException({ code: 'TEACHING_TEAM_STORAGE_UNAVAILABLE', message: 'Teaching configuration storage unavailable' });
    return this.db;
  }
}
