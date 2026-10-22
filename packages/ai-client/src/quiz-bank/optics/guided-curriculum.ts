import { parseProjectTemplateSpec, type LessonActivity, type ProjectTemplateSpec } from '@qitu/contracts';
import { OPTICS_16_QUALITY_TEMPLATE_SPEC } from './curriculum.js';

export const OPTICS_GUIDED_PROFILE_ID = 'optics-16x60-v5-guided';
const METHODS = [
  ['pbl-data-literacy', 'pbl-understanding-coach'],
  ['pbl-driving-question', 'pbl-hypothesis-coach', 'pbl-experiment-design'],
  ['pbl-concept-probe', 'pbl-visual-explainer'],
  ['pbl-concept-probe', 'pbl-understanding-coach'],
  ['pbl-concept-probe', 'pbl-source-literacy'],
  ['pbl-understanding-coach', 'pbl-independent-transfer'],
  ['pbl-visual-explainer', 'pbl-understanding-coach'],
  ['pbl-concept-probe', 'pbl-independent-transfer'],
  ['pbl-experiment-design', 'pbl-hypothesis-coach'],
  ['pbl-data-literacy', 'pbl-experiment-design'],
  ['optics-wave-inquiry', 'pbl-hypothesis-coach', 'pbl-data-literacy'],
  ['optics-wave-inquiry', 'pbl-hypothesis-coach', 'pbl-data-literacy'],
  ['pbl-data-literacy', 'pbl-cer-coach'],
  ['pbl-artifact-revision', 'pbl-cer-coach', 'pbl-ai-output-audit'],
  ['pbl-defense-coach', 'pbl-peer-critique'],
  ['pbl-reflection-coach', 'pbl-ai-output-audit'],
] satisfies readonly (readonly string[])[];
const ACTIVITIES: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];

/** New reviewed identity; neither historical course contents nor skill packages are rewritten. */
export const OPTICS_GUIDED_TEMPLATE_SPEC: ProjectTemplateSpec = parseProjectTemplateSpec({
  ...OPTICS_16_QUALITY_TEMPLATE_SPEC,
  id: 'pbl-optics-inquiry-16s-guided', version: 'v5-16s-guided', lessonPolicy: 'lesson-guided.v1',
  curriculum: { profiles: [{ id: OPTICS_GUIDED_PROFILE_ID, schedule: { lessonCount: 16, lessonMinutes: 60 },
    sessions: OPTICS_16_QUALITY_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions.map(session => {
      const { checkpoint, ...base } = session;
      const leadAssistantId = session.sessionIndex === 1 ? 'optics-concept-coach'
        : session.sessionIndex === 2 ? 'optics-leader'
          : session.sessionIndex <= 8 ? 'optics-concept-coach'
            : session.sessionIndex <= 13 ? 'optics-experiment-guide' : 'optics-review-assessor';
      const kinds = ACTIVITIES.filter(activity => session.blocks[activity] > 0);
      return {
        ...base, id: `optics-v5-session-${session.sessionIndex}`, leadAssistantId,
        ...(session.sessionIndex === 2 ? {
          evidenceRequirements: ['可检验假设与变量设计表', '说明证据需求与安全事项的实验方案'],
          completionSpec: { ...session.completionSpec!, version: 'learning-session-completion.v2',
            qualityReview: { version: 'lesson-quality.v1', reviewer: 'current_teacher', criteria: [
              { id: 'lesson-2-hypothesis', description: '假设可检验，区分自变量、因变量和控制变量。' },
              { id: 'lesson-2-plan', description: '方案说明证据需求、比较方法和需教师审核的安全事项。' },
            ] },
          },
        } : {}),
        ...(checkpoint?.requiredGate !== 'student_confirmed_intent' && checkpoint ? { checkpoint } : {}),
        requiredSkillIds: ['tutor-guided-learning', 'pbl-dynamic-lesson', ...METHODS[session.sessionIndex - 1]!],
        activityRequirements: kinds.map(activity => ({ activity,
          evidence: activity === 'check' && session.phase === 'concept_mastery' ? 'mastery'
            : activity === 'practice' && [11, 12].includes(session.sessionIndex) ? 'experiment_observation'
              : activity === 'reflect' && session.sessionIndex === 14 ? 'submitted_artifact' : 'session_response',
        })),
        activityGuidance: Object.fromEntries(kinds.map(activity => [activity,
          session.sessionIndex === 2 && activity === 'check'
            ? '检查假设是否可检验、变量是否混杂；这是正式课程的问题设计检查，不重复创建或确认项目。'
            : session.activityGuidance?.[activity] ?? `${session.learningGoal} 用自己的话说明依据，并保存本活动的学习回应。`,
        ])),
      };
    }),
  }] },
});

/** Recommendations for Admin review, never runtime grants or name-based role selection. */
export const OPTICS_GUIDED_ROLE_REQUIREMENTS = [...new Set(
  OPTICS_GUIDED_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions.map(session => session.leadAssistantId!),
)].map(assistantId => ({ assistantId, requiredToolIds: ['tutor.propose_lesson_activity'],
  requiredSkillIds: [...new Set(OPTICS_GUIDED_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions
    .filter(session => session.leadAssistantId === assistantId).flatMap(session => session.requiredSkillIds ?? []))],
}));
