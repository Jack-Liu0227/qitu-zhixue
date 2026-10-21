import {
  QITU_AUTHORING_SKILL_IDS, QITU_SKILL_LIFECYCLE_VERSION, QITU_SKILL_ROLE_PRESETS,
} from '@qitu/contracts';
import type { TutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';

/** Catalog recommendations cannot grant a skill, tool, model or knowledge source. */
export function skillLifecycleCatalog(source: TutorRuntimeSource) {
  return {
    version: QITU_SKILL_LIFECYCLE_VERSION,
    scope: 'recommendations_only',
    roles: Object.entries(QITU_SKILL_ROLE_PRESETS).map(([role, preset]) => ({
      role, ...preset,
      skills: preset.skillIds.map(id => {
        const skill = source.skills.find(entry => entry.id === id);
        return { id, ready: skill?.runtime === 'teaching' && skill.status === 'ready' && skill.publicationStatus === 'published',
          version: skill?.version ?? null, packageDigest: skill?.contentHash ?? null };
      }),
    })),
    authoring: QITU_AUTHORING_SKILL_IDS.map(id => {
      const skill = source.skills.find(entry => entry.id === id);
      return { id, ready: skill?.runtime === 'admin' && skill.status === 'ready' && skill.publicationStatus === 'published',
        resource: `skills/${id}/SKILL.md` };
    }),
    evidenceFlow: ['learner_response_or_action', 'domain_owner_receipt', 'server_event', 'projection_candidate', 'projection_owner_review', 'accepted_read_model'],
  };
}
