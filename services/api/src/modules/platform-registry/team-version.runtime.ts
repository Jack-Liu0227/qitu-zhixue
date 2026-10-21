import { and, eq, inArray } from 'drizzle-orm';
import {
  agentConfigs,
  agentMcpBindings,
  agentRoutes,
  agentSkillBindings,
  agentToolBindings,
  type Database,
} from '@qitu/database';
import { PBL_PLAN_OUTPUT_SCHEMA, type CurrentUser } from '@qitu/contracts';
import { createHash } from 'node:crypto';
import type { EffectiveAgentRuntime } from './platform-registry.service';
import {
  publishedRuntimeSource,
  type PublishedAssistantSnapshot,
} from './team-version.snapshot';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PublishedRuntimeMember {
  assistantId: string;
  displayName: string;
  role: string;
  roleLabel: string;
  snapshot: PublishedAssistantSnapshot;
  live: EffectiveAgentRuntime;
}

export interface PublishedRuntimeVersion {
  id: string;
  teamId: string;
  leaderAssistantId: string;
  members: unknown[];
}

export interface RuntimeProjectionResult {
  teamVersionId: string;
  assistantIds: string[];
  created: string[];
  updated: string[];
  unchanged: string[];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/**
 * Project an immutable published team snapshot into the runtime registry.
 *
 * Team publication, teaching bundles and runtime agents are separate facts.
 * This is the only bridge from a published team member to agent_configs; the
 * projection is idempotent and never infers identity from display names.
 */
export async function projectPublishedTeamRuntime(
  tx: Transaction,
  version: PublishedRuntimeVersion,
  members: readonly PublishedRuntimeMember[],
  actor: CurrentUser,
  now = new Date(),
): Promise<RuntimeProjectionResult> {
  if (members.length === 0) throw new Error('TEAM_RUNTIME_PROJECTION_EMPTY');

  const assistantIds = members.map((member) => member.assistantId).sort();
  if (new Set(assistantIds).size !== assistantIds.length) {
    throw new Error('TEAM_RUNTIME_PROJECTION_DUPLICATE_ASSISTANT');
  }
  if (!assistantIds.includes(version.leaderAssistantId)) {
    throw new Error('TEAM_RUNTIME_PROJECTION_LEADER_MISSING');
  }

  const existingConfigs = await tx
    .select()
    .from(agentConfigs)
    .where(inArray(agentConfigs.id, assistantIds));
  const existingById = new Map(existingConfigs.map((row) => [row.id, row]));
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const member of members) {
    // A published snapshot remains authoritative for prompts/models, while
    // current grants must still allow every frozen skill/tool/MCP pin.
    const granted = publishedRuntimeSource(member.snapshot, member.live);
    if (!granted.enabled) throw new Error('TEAM_RUNTIME_PROJECTION_DISABLED');

    const existing = existingById.get(member.assistantId);
    const parentAgentId = member.assistantId === version.leaderAssistantId ? null : version.leaderAssistantId;
    const capabilities = [...new Set([...(existing?.capabilities ?? []), 'teach'])];
    const next = {
      displayName: member.displayName || member.roleLabel || member.assistantId,
      role: member.role || existing?.role || 'custom',
      roleDefinition: member.snapshot.roleDefinition,
      agentDefinition: member.snapshot.agentDefinition,
      modelProviderId: member.snapshot.model.modelProviderId,
      modelId: member.snapshot.model.modelId,
      modelUsage: 'tutor.chat',
      capabilities,
      parentAgentId,
      enabled: true,
      updatedBy: actor.id,
      updatedAt: now,
    };
    const changed = !existing || existing.displayName !== next.displayName
      || existing.role !== next.role
      || existing.roleDefinition !== next.roleDefinition
      || existing.agentDefinition !== next.agentDefinition
      || existing.modelProviderId !== next.modelProviderId
      || existing.modelId !== next.modelId
      || existing.modelUsage !== next.modelUsage
      || !sameStringSet(existing.capabilities, next.capabilities)
      || existing.parentAgentId !== next.parentAgentId
      || existing.enabled !== true;

    if (!existing) {
      await tx.insert(agentConfigs).values({
        id: member.assistantId,
        ...next,
        configVersion: 1,
        createdAt: now,
      });
      created.push(member.assistantId);
    } else if (changed) {
      await tx.update(agentConfigs).set({
        ...next,
        configVersion: existing.configVersion + 1,
      }).where(eq(agentConfigs.id, member.assistantId));
      updated.push(member.assistantId);
    } else {
      unchanged.push(member.assistantId);
    }

    await syncSkills(tx, member.assistantId, member.snapshot.skills.map((skill) => skill.canonicalId), now);
    await syncTools(tx, member.assistantId, member.snapshot.tools.map((tool) => tool.toolId), now);
    await syncMcp(tx, member.assistantId, member.snapshot.mcpPermissions, now);
  }

  await syncDelegationRoutes(tx, version, actor.id, now);

  return {
    teamVersionId: version.id,
    assistantIds,
    created: created.sort(),
    updated: updated.sort(),
    unchanged: unchanged.sort(),
  };
}

/**
 * The Tutor delegates project turns to the actual lesson member. Without this
 * allow-list the run can be created but no mailbox task is ever produced,
 * which looks like "the team was not summoned" in the student UI.
 */
async function syncDelegationRoutes(
  tx: Transaction,
  version: PublishedRuntimeVersion,
  actorId: string,
  now: Date,
): Promise<void> {
  const recipients = [...new Set(
    version.members
      .map((member) => member && typeof member === 'object'
        ? (member as { assistantId?: unknown }).assistantId
        : undefined)
      .filter((assistantId): assistantId is string =>
        typeof assistantId === 'string'
        && assistantId.length > 0
        && assistantId !== version.leaderAssistantId),
  )].sort();

  for (const toAgentId of recipients) {
    const taskType = 'pbl.plan';
    const [existing] = await tx.select().from(agentRoutes).where(and(
      eq(agentRoutes.fromAgentId, version.leaderAssistantId),
      eq(agentRoutes.toAgentId, toAgentId),
      eq(agentRoutes.trigger, 'delegate'),
      eq(agentRoutes.taskType, taskType),
    )).limit(1);
    if (existing) {
      if (!existing.enabled || JSON.stringify(existing.outputSchema) !== JSON.stringify(PBL_PLAN_OUTPUT_SCHEMA)) {
        await tx.update(agentRoutes).set({
          enabled: true,
          outputSchema: PBL_PLAN_OUTPUT_SCHEMA,
          updatedBy: actorId,
          updatedAt: now,
        }).where(eq(agentRoutes.id, existing.id));
      }
      continue;
    }
    const routeId = `route-team-${createHash('sha256')
      .update(`${version.leaderAssistantId}:${toAgentId}:${taskType}`)
      .digest('hex')
      .slice(0, 24)}`;
    await tx.insert(agentRoutes).values({
      id: routeId,
      fromAgentId: version.leaderAssistantId,
      toAgentId,
      trigger: 'delegate',
      taskType,
      enabled: true,
      outputSchema: PBL_PLAN_OUTPUT_SCHEMA,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function syncSkills(
  tx: Transaction,
  agentId: string,
  desiredIds: readonly string[],
  now: Date,
): Promise<void> {
  const desired = [...new Set(desiredIds)];
  const current = await tx.select().from(agentSkillBindings).where(eq(agentSkillBindings.agentId, agentId));
  const currentById = new Map(current.map((row) => [row.skillId, row]));
  const staleIds = current.filter((row) => !desired.includes(row.skillId)).map((row) => row.skillId);
  if (staleIds.length > 0) {
    await tx.delete(agentSkillBindings).where(and(
      eq(agentSkillBindings.agentId, agentId),
      inArray(agentSkillBindings.skillId, staleIds),
    ));
  }
  for (const skillId of desired) {
    const existing = currentById.get(skillId);
    if (!existing) {
      await tx.insert(agentSkillBindings).values({
        agentId,
        skillId,
        enabled: true,
        inheritToChildren: false,
        updatedAt: now,
      });
    } else if (!existing.enabled || existing.inheritToChildren) {
      await tx.update(agentSkillBindings).set({
        enabled: true,
        inheritToChildren: false,
        updatedAt: now,
      }).where(and(
        eq(agentSkillBindings.agentId, agentId),
        eq(agentSkillBindings.skillId, skillId),
      ));
    }
  }
}

async function syncTools(
  tx: Transaction,
  agentId: string,
  desiredIds: readonly string[],
  now: Date,
): Promise<void> {
  const desired = [...new Set(desiredIds)];
  const current = await tx.select().from(agentToolBindings).where(eq(agentToolBindings.agentId, agentId));
  const currentById = new Map(current.map((row) => [row.toolId, row]));
  const staleIds = current.filter((row) => !desired.includes(row.toolId)).map((row) => row.toolId);
  if (staleIds.length > 0) {
    await tx.delete(agentToolBindings).where(and(
      eq(agentToolBindings.agentId, agentId),
      inArray(agentToolBindings.toolId, staleIds),
    ));
  }
  for (const toolId of desired) {
    const existing = currentById.get(toolId);
    if (!existing) {
      await tx.insert(agentToolBindings).values({ agentId, toolId, enabled: true, updatedAt: now });
    } else if (!existing.enabled) {
      await tx.update(agentToolBindings).set({ enabled: true, updatedAt: now }).where(and(
        eq(agentToolBindings.agentId, agentId),
        eq(agentToolBindings.toolId, toolId),
      ));
    }
  }
}

async function syncMcp(
  tx: Transaction,
  agentId: string,
  permissions: readonly { serverId: string; toolIds: string[] }[],
  now: Date,
): Promise<void> {
  const desired = new Map(permissions.map((permission) => [
    permission.serverId,
    [...new Set(permission.toolIds)].sort(),
  ]));
  const current = await tx.select().from(agentMcpBindings).where(eq(agentMcpBindings.agentId, agentId));
  const currentByServer = new Map(current.map((row) => [row.mcpServerId, row]));
  const staleIds = current.filter((row) => !desired.has(row.mcpServerId)).map((row) => row.mcpServerId);
  if (staleIds.length > 0) {
    await tx.delete(agentMcpBindings).where(and(
      eq(agentMcpBindings.agentId, agentId),
      inArray(agentMcpBindings.mcpServerId, staleIds),
    ));
  }
  for (const [serverId, toolIds] of desired) {
    const existing = currentByServer.get(serverId);
    if (!existing) {
      await tx.insert(agentMcpBindings).values({
        agentId,
        mcpServerId: serverId,
        allowedToolIds: toolIds,
        enabled: true,
        updatedAt: now,
      });
    } else if (!existing.enabled || !sameStringSet(existing.allowedToolIds, toolIds)) {
      await tx.update(agentMcpBindings).set({
        allowedToolIds: toolIds,
        enabled: true,
        updatedAt: now,
      }).where(and(
        eq(agentMcpBindings.agentId, agentId),
        eq(agentMcpBindings.mcpServerId, serverId),
      ));
    }
  }
}
