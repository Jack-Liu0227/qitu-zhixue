import { adminAssistants, agentConfigs, modelModels, type Database } from '@qitu/database';
import { and, eq } from 'drizzle-orm';
import { TeamAgentExecutionError } from './team-runtime-route';

/** Runtime descriptors restrict execution; Admin owns every mutable assistant input. */
export async function resolveProjectionExecutionConfig(db: Database, descriptor: typeof agentConfigs.$inferSelect) {
  const [assistant] = await db.select().from(adminAssistants).where(eq(adminAssistants.id, descriptor.id)).limit(1);
  if (!assistant?.enabled || !descriptor.enabled) throw new TeamAgentExecutionError('PROJECTION_ASSISTANT_UNAVAILABLE');
  if (!assistant.modelProviderId?.trim() || !assistant.modelId?.trim()) {
    throw new TeamAgentExecutionError('TEAM_AGENT_MODEL_NOT_CONFIGURED');
  }
  const [model] = await db.select().from(modelModels).where(and(
    eq(modelModels.providerId, assistant.modelProviderId), eq(modelModels.modelId, assistant.modelId),
  )).limit(1);
  if (!model?.enabled || !Array.isArray(model.inputModalities) || !model.inputModalities.includes('text')
    || !Array.isArray(model.outputModalities) || !model.outputModalities.includes('text')) {
    throw new TeamAgentExecutionError('TEAM_AGENT_MODEL_CAPABILITY_MISMATCH');
  }
  return {
    agent: { ...descriptor, displayName: assistant.name, role: assistant.role,
      roleDefinition: assistant.role, agentDefinition: assistant.instructions },
    model: { providerId: assistant.modelProviderId, modelId: assistant.modelId },
    skillIds: [...assistant.enabledSkills],
    temperature: assistant.temperature ?? undefined,
  };
}
