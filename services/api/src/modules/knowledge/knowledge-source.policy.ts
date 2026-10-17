import type { PlatformKnowledgeConfig } from './knowledge-center.config';

export interface SourcePolicy {
  kind: string;
  lifecycle: string;
  owner_user_id: string | null;
  school_id: string | null;
  engine_instance_id: string | null;
  visibility: string;
  origin: Record<string, unknown>;
}
/** Null has no implicit global grant. Project libraries can never become sources. */
export function materializationAllowed(
  source: SourcePolicy,
  target: { owner_user_id: string | null; school_id: string | null },
  config: PlatformKnowledgeConfig,
) {
  if (
    source.lifecycle !== 'active' ||
    source.visibility !== 'active' ||
    source.kind === 'project' ||
    source.origin.canMaterialize !== true
  )
    return false;
  if (source.kind === 'school' && (!target.school_id || source.school_id !== target.school_id))
    return false;
  if (
    source.kind === 'student' &&
    (!target.owner_user_id || source.owner_user_id !== target.owner_user_id)
  )
    return false;
  if (!['platform', 'school', 'student'].includes(source.kind)) return false;
  if (source.engine_instance_id && !config.knowledgeEngines[source.engine_instance_id]?.enabled)
    return false;
  if (source.origin.kind === 'ima') {
    const engine = config.knowledgeEngines[String(source.origin.engineInstanceId)];
    return (
      !!engine?.enabled &&
      engine.provider === 'ima' &&
      engine.config.allowMaterialize === true &&
      engine.config.connectionRef === source.origin.connectionRef &&
      Array.isArray(engine.config.allowedKnowledgeBaseIds) &&
      engine.config.allowedKnowledgeBaseIds.includes(source.origin.remoteKnowledgeBaseId)
    );
  }
  return true;
}
