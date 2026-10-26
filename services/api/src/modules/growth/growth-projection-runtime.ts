import { BadRequestException } from '@nestjs/common';
import type { GrowthProjectionSettings } from '@qitu/contracts';
import { adminAssistants, adminTeams, pblTemplateTeamBindings, agentConfigs, agentRoutes, projectBindingSnapshots, type Database } from '@qitu/database';
import { createHash } from 'node:crypto';
import { assistantIdsForRuntimeAgent, runtimeIdsForAssistant } from '../platform-registry/assistant-runtime-identity';

type RuntimeDatabase = Pick<Database, 'select' | 'insert'>;

/** Explicit purpose binding grants identities/routes, never model or prompt copies. */
export async function provisionGrowthProjectionRuntime(
  db: RuntimeDatabase,
  settings: GrowthProjectionSettings,
  actorId: string,
): Promise<void> {
  const targets = [
    { agentId: settings.profileAssistantId, taskType: 'profile.project' },
    { agentId: settings.growthAssistantId, taskType: 'growth.project' },
  ].filter((target): target is { agentId: string; taskType: string } => target.agentId !== null);
  if (!targets.length) return;
  const assistants = await db.select().from(adminAssistants);
  const configs = await db.select().from(agentConfigs);
  for (const id of new Set(targets.map((target) => target.agentId))) {
    const assistant = assistants.find((row) => row.id === id && row.enabled);
    const config = configs.find((row) => row.id === id);
    if (!assistant || config?.enabled === false) throw new BadRequestException('GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE');
    // An existing runtime switch is an independent revocation boundary.
    await db.insert(agentConfigs).values({ id, displayName: assistant.name, role: assistant.role,
      roleDefinition: '', capabilities: ['reflect'], enabled: true, updatedBy: actorId,
    }).onConflictDoNothing({ target: agentConfigs.id });
  }
  const [teams, bindings, snapshots] = await Promise.all([
    db.select().from(adminTeams), db.select().from(pblTemplateTeamBindings), db.select().from(projectBindingSnapshots),
  ]);
  const versions = snapshots.flatMap(snapshot => {
    const team = bindings.find(binding => binding.id === snapshot.bindingId)?.teamSnapshots?.[snapshot.teamVersionId];
    return team ? [team] : [];
  });
  const assistantEnabled = (id: string) => assistants.some((row) => row.id === id && row.enabled);
  const leaders = new Set([
    'qitu-learning-partner',
    // Free exploration is explicitly owned by this server-registered intake assistant.
    ...(assistantEnabled('qitu-intake-assistant') ? ['qitu-intake-assistant'] : []),
    ...teams.filter((row) => row.enabled && assistantEnabled(row.leaderAssistantId)).map((row) => row.leaderAssistantId),
    ...versions.filter((row) => row.enabled && assistantEnabled(row.leaderAssistantId))
      .map((row) => row.leaderAssistantId),
  ].flatMap((id) => [...runtimeIdsForAssistant(id)]));
  const sourcePermitted = (id: string) => {
    const identities = assistantIdsForRuntimeAgent(id);
    const runtimeIds = new Set(identities.flatMap((identity) => [...runtimeIdsForAssistant(identity)]));
    return !assistants.some((row) => identities.includes(row.id) && !row.enabled)
      && !configs.some((row) => runtimeIds.has(row.id) && !row.enabled);
  };
  for (const id of leaders) {
    if (configs.some((row) => row.id === id) || !sourcePermitted(id)) continue;
    const identities = assistantIdsForRuntimeAgent(id);
    const assistant = assistants.find((row) => identities.includes(row.id) && row.enabled);
    if (!assistant) continue;
    // Only registered teaching leaders gain a missing identity; configuration stays Admin-owned.
    await db.insert(agentConfigs).values({ id,
      displayName: id === assistant.id ? assistant.name : `${assistant.name} (${id})`, role: assistant.role,
      roleDefinition: '', capabilities: ['teach'], enabled: true, updatedBy: actorId,
    }).onConflictDoNothing({ target: agentConfigs.id });
  }
  const availableConfigs = await db.select().from(agentConfigs);
  const sources = availableConfigs.filter((row) => row.enabled && leaders.has(row.id) && sourcePermitted(row.id));
  for (const source of sources) for (const target of targets) {
    const id = `growth-route:${createHash('sha256').update(`${source.id}:${target.agentId}:${target.taskType}`).digest('hex').slice(0, 32)}`;
    await db.insert(agentRoutes).values({ id, fromAgentId: source.id, toAgentId: target.agentId,
      trigger: 'event', taskType: target.taskType, enabled: true, updatedBy: actorId,
    }).onConflictDoNothing({ target: [agentRoutes.fromAgentId, agentRoutes.toAgentId, agentRoutes.trigger, agentRoutes.taskType] });
  }
}
