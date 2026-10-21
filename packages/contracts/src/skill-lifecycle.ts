/** Recommendations only. Explicit Admin assignments, publication and frozen grants remain authoritative. */
export const QITU_SKILL_LIFECYCLE_VERSION = 'qitu.skill-lifecycle.v1';

export const QITU_SKILL_ROLE_PRESETS = {
  guide: {
    skillIds: ['tutor-guided-learning', 'pbl-understanding-coach', 'pbl-concept-probe', 'pbl-reflection-coach'],
    requiredToolIds: [],
    outputOwner: 'ai-tutor',
  },
  inquiry: {
    skillIds: ['tutor-guided-learning', 'pbl-source-literacy', 'pbl-data-literacy', 'pbl-dynamic-lesson'],
    requiredToolIds: ['tutor.propose_lesson_activity'],
    outputOwner: 'works/learning-plan',
  },
  artifact: {
    skillIds: ['tutor-guided-learning', 'pbl-artifact-revision', 'pbl-dynamic-lesson', 'pbl-cer-coach', 'pbl-defense-coach'],
    requiredToolIds: ['tutor.propose_lesson_activity'],
    outputOwner: 'works',
  },
  profile: {
    skillIds: ['qitu-learner-profile'], requiredToolIds: [], outputOwner: 'growth-projection-owner',
  },
  growth: {
    skillIds: ['qitu-growth-trajectory'], requiredToolIds: [], outputOwner: 'growth-projection-owner',
  },
} as const;
export type QituSkillLifecycleRole = keyof typeof QITU_SKILL_ROLE_PRESETS;

export const QITU_AUTHORING_SKILL_IDS = [
  'qitu-openmaic', 'qitu-skill-creator', 'qitu-build-personal-skill', 'qitu-curriculum-planner',
  'qitu-understanding-by-design', 'qitu-k12-core-literacy-planning', 'qitu-spiral-curriculum',
  'qitu-stage-design', 'qitu-stage-dsl', 'qitu-slide-dsl', 'qitu-page-clone', 'qitu-pptx-import',
  'qitu-pro-editing', 'qitu-style-clone', 'qitu-teacher-style-clone',
] as const;
