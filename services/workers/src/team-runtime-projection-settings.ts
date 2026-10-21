import { parseGrowthProjectionSettings, type GrowthProjectionType } from '@qitu/contracts';
import { adminAssistants, agentConfigs, type Database } from '@qitu/database';
import { eq, sql } from 'drizzle-orm';
import { TeamAgentExecutionError } from './team-runtime-route';

export async function resolveProjectionAssistant(db: Database, type: GrowthProjectionType): Promise<{ agentId: string; revision: number }> {
  const result = await db.execute<{ revision: number; config: Record<string, unknown> }>(sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`);
  const current = result.rows[0];
  const settings = parseGrowthProjectionSettings(current?.config.growthProjection);
  const agentId = type === 'learner_profile' ? settings?.profileAssistantId : settings?.growthAssistantId;
  if (!agentId || !current) throw new TeamAgentExecutionError('PROJECTION_PURPOSE_UNCONFIGURED');
  const [assistants, agents] = await Promise.all([
    db.select({ enabled: adminAssistants.enabled }).from(adminAssistants).where(eq(adminAssistants.id, agentId)).limit(1),
    db.select({ enabled: agentConfigs.enabled }).from(agentConfigs).where(eq(agentConfigs.id, agentId)).limit(1),
  ]);
  if (!assistants[0]?.enabled || !agents[0]?.enabled) throw new TeamAgentExecutionError('PROJECTION_ASSISTANT_UNAVAILABLE');
  return { agentId, revision: current.revision };
}
