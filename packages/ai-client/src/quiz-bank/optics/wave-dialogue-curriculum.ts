import { derivePhasesFromPolicyAndSessions, findGovernancePolicy, parseProjectTemplateSpec, type PblTemplateSession } from '@qitu/contracts';
import { WAVE_TEACHING_TEMPLATE_SPEC, WAVE_TEACHING_ROLE_REQUIREMENTS } from './wave-teaching-curriculum.js';

export const WAVE_DIALOGUE_PROFILE_ID = 'wave-optics-8x60-dialogue-v1';
const sessions: PblTemplateSession[] = WAVE_TEACHING_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions.map((source, index) => {
  const number = index + 1, final = number === 8;
  const observation = number >= 3 && number <= 6;
  const session: PblTemplateSession = { ...structuredClone(source), id: `wave-dialogue-session-${number}`, progression: 'dialogue.v1',
    activityRequirements: final ? [{ activity: 'check', evidence: 'submitted_artifact' }, { activity: 'reflect', evidence: 'session_response' }]
      : number === 2 ? [{ activity: 'check', evidence: 'mastery' }]
        : observation ? [{ activity: 'practice', evidence: 'experiment_observation' }] : [{ activity: 'check', evidence: 'session_response' }],
    completionSpec: { version: 'learning-session-completion.v2',
      requiredMasteryObjectiveIds: source.completionSpec!.requiredMasteryObjectiveIds,
      requiredEvidence: number === 2 ? [] : final ? [
        { kind: 'approved_artifact', scope: 'session', minimumCount: 1 },
        { kind: 'session_response', scope: 'session', minimumCount: 1 },
      ] : [{ kind: observation ? 'experiment_observation' : 'session_response', scope: 'session', minimumCount: number === 4 || number === 6 ? 2 : 1 }],
      qualityReview: { version: 'lesson-quality.v1', reviewer: 'autonomous-learning.v1',
        criteria: [
          { id: `wave-dialogue-${number}-necessary`, description: final
            ? '用自己的话说明探究中改变的一项认识及支持它的已保存观察，能说明一处不确定性。'
            : number === 7 ? '结合已保存的单缝和双缝观察，解释一个共同点或差异，并说明模型的适用边界。'
              : source.learningGoal!, required: true },
          { id: `wave-dialogue-${number}-extension`, description: '尝试另一种表示或提出一个后续探究问题；此项仅作提升建议。', required: false },
        ],
        ...(final ? { artifactCriteria: [
          { id: 'wave-dialogue-final-evidence', description: '探究档案包含单缝和双缝已保存的参数与模拟观察，结论和依据相符，可追溯到真实观察记录；模型结果不冒充真实测量。', required: true },
          { id: 'wave-dialogue-final-explanation', description: '能解释两类图样的联系或差异，说明受控变量、一次修订和适用边界。', required: true },
          { id: 'wave-dialogue-final-presentation', description: '图表、排版或进一步拓展有助于展示；此项仅作提升建议。', required: false },
        ] } : {}),
      },
    },
    ...(source.collaborators ? { collaborators: source.collaborators.map(role => ({ ...role, activity: final ? 'check' as const : observation ? 'practice' as const : 'check' as const, trigger: 'on_request' as const })) } : {}),
  };
  if (number === 7) {
    session.learningGoal = '用已保存的观察形成比较草稿，为最后一课的正式交付作准备。';
    session.evidenceRequirements = ['依据已保存观察，用自己的话解释两类现象的联系或差异。'];
    session.checkpoint = { requiredGate: 'practice_evidence_ready' };
    session.activityGuidance = { ...session.activityGuidance, check: '直接在对话中给出比较解释，系统自动保存为过程草稿；最后一课再整理并正式交付。' };
  }
  if (final) session.activityGuidance = { ...session.activityGuidance,
    check: '参考已保存的过程草稿与观察，在对话区整理最终档案并确认交付；站内正文无需导出再上传。',
    reflect: '作品通过后，直接说说一次认识变化、相应依据和仍不确定的地方。' };
  return session;
});
const policy = findGovernancePolicy('wave-optics-dialogue:v1')!;
export const WAVE_DIALOGUE_TEMPLATE_SPEC = parseProjectTemplateSpec({
  ...structuredClone(WAVE_TEACHING_TEMPLATE_SPEC), id: 'pbl-wave-dialogue-inquiry', version: 'v1-8s-dialogue',
  teamId: 'team-wave-optics-dialogue',
  title: '光为什么会出现明暗条纹？问答探究', lessonPolicy: 'lesson-dialogue.v1', governancePolicyId: policy.id,
  phases: derivePhasesFromPolicyAndSessions(policy, sessions, { assignedAssistants: Object.fromEntries(WAVE_TEACHING_TEMPLATE_SPEC.phases.map(phase => [phase.phase, phase.assignedAssistantId])) }),
  curriculum: { profiles: [{ id: WAVE_DIALOGUE_PROFILE_ID, schedule: { lessonCount: 8, lessonMinutes: 60 }, sessions }] },
});
export const WAVE_DIALOGUE_ROLE_REQUIREMENTS = WAVE_TEACHING_ROLE_REQUIREMENTS;
