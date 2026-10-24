import { parseProjectTemplateSpec } from '@qitu/contracts';
import { WAVE_OPTICS_TEMPLATE_SPEC, WAVE_OPTICS_ROLE_REQUIREMENTS } from './wave-curriculum.js';

export const WAVE_TEACHING_PROFILE_ID = 'wave-optics-8x60-zero-base-v1';
export const WAVE_TEACHING_TEMPLATE_SPEC = parseProjectTemplateSpec({
  ...structuredClone(WAVE_OPTICS_TEMPLATE_SPEC), version: 'v2.1-8s-zero-base', teamId: 'team-wave-optics-zero-base',
  prerequisites: ['从读图、波动和比较开始学习；不预设学生已经掌握波动光学。'],
  curriculum: { profiles: WAVE_OPTICS_TEMPLATE_SPEC.curriculum!.profiles.map(profile => ({
    ...profile, id: WAVE_TEACHING_PROFILE_ID,
    sessions: profile.sessions.map(session => ({
      ...session,
      requiredSkillIds: [...session.requiredSkillIds!, 'pbl-courseware-guidance'],
      requiredToolIds: [...session.requiredToolIds!, 'tutor.propose_courseware_activity', 'knowledge_search', 'knowledge_read'],
      teachingSpec: {
        version: 'zero-base.v1', sourceRequired: true, courseware: 'reviewed-with-project-generation.v1',
        concepts: session.objectiveIds.map(objectiveId => ({ objectiveId,
          introduction: WAVE_OPTICS_TEMPLATE_SPEC.objectives.find(objective => objective.id === objectiveId)!.description })),
      },
      activityRequirements: session.activityRequirements!.map(requirement => ({ ...requirement,
        evidence: ['review', 'theory'].includes(requirement.activity) ? 'teaching_delivery' : requirement.evidence })),
      activityGuidance: { ...session.activityGuidance,
        review: '从已保存的课件和上一课证据衔接；首次学习先解释观察对象，不把不会视为答错。',
        theory: '依据本课授权知识库，逐个解释概念与符号，展示有来源的交互板书。先查找已审核课件，适配不够时生成本项目课件。讲解与演示后让学生选择继续、再解释或看例子；继续只记录教学展示，不代表掌握。',
      },
    })),
  })) },
});
export const WAVE_TEACHING_ROLE_REQUIREMENTS = WAVE_OPTICS_ROLE_REQUIREMENTS.map(role => ({ ...role,
  requiredSkillIds: [...role.requiredSkillIds, 'pbl-courseware-guidance'],
  requiredToolIds: [...role.requiredToolIds, 'tutor.propose_courseware_activity', 'knowledge_search', 'knowledge_read'] }));
