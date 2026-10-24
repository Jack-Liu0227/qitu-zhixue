import { parseProjectTemplateSpec, type LessonActivity, type PblTemplateObjective, type PblTemplateSession } from '@qitu/contracts';
import type { CreateTemplateInput, CreateTemplateVersionInput } from '../../templates.types';

type Concept = readonly [key: string, title: string, explanation: string];
type Lesson = readonly [title: string, prompt: string, evidence: string];
interface CourseInput {
  slug: string; title: string; domain: string; question: string; summary: string;
  teamName: string; roles: readonly [string, string, string]; outcome: string;
  concepts: readonly [Concept, Concept, Concept, Concept];
  lessons: readonly [Lesson, Lesson, Lesson, Lesson, Lesson, Lesson, Lesson, Lesson];
  rubric: readonly { id: string; label: string; description: string }[];
  materials: readonly string[]; requiredMaterials?: readonly string[]; safety: readonly string[]; skills?: readonly string[];
}

export const INSPIRATION_BASE_SKILLS = ['tutor-guided-learning', 'pbl-dynamic-lesson', 'pbl-understanding-coach',
  'pbl-visual-explainer', 'pbl-concept-probe', 'pbl-artifact-revision', 'pbl-reflection-coach'] as const;

/** Authoring helper only. All runtime curriculum data is the canonical ProjectTemplateSpec. */
export function defineRubricCourse(input: CourseInput) {
  const prefix = input.slug;
  const assistantIds = [`${prefix}-concept`, `${prefix}-practice`, `${prefix}-review`] as const;
  const teamId = `team-${prefix}`, profileId = `${prefix}-8x60-v1`;
  const skills = [...new Set([...INSPIRATION_BASE_SKILLS, ...(input.skills ?? [])])];
  const concepts: PblTemplateObjective[] = input.concepts.map(([key, title, description]) => ({
    id: `${prefix}-${key}`, title, description, kind: 'concept', conceptId: `${prefix}.${key}`, prerequisiteIds: [],
  }));
  const start: PblTemplateObjective = { id: `${prefix}-goal`, title: input.lessons[0][0],
    description: input.lessons[0][1], kind: 'design', prerequisiteIds: [] };
  const practice: PblTemplateObjective[] = input.lessons.slice(3, 7).map(([title, description], index) => ({
    id: `${prefix}-task-${index + 4}`, title, description, kind: 'design',
    prerequisiteIds: index === 0 ? [concepts[0]!.id, concepts[1]!.id]
      : index < 3 ? [`${prefix}-task-${index + 3}`, concepts[index + 1]!.id] : [`${prefix}-task-6`, concepts[3]!.id],
  }));
  const reflection: PblTemplateObjective = { id: `${prefix}-reflection`, title: input.lessons[7][0],
    description: input.lessons[7][1], kind: 'reflection', prerequisiteIds: [`${prefix}-task-7`] };
  const objectives = [start, ...concepts, ...practice, reflection];
  const activities: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];
  const sessions: PblTemplateSession[] = input.lessons.map(([title, prompt, evidence], index) => {
    const n = index + 1, practical = n >= 4 && n <= 7;
    const phase = n === 1 ? 'exploration' : n <= 3 ? 'concept_mastery' : practical ? 'guided_practice' : 'deliverable_review';
    const ids = n === 1 ? [start.id] : n === 2 ? concepts.slice(0, 2).map(item => item.id)
      : n === 3 ? concepts.slice(2).map(item => item.id) : practical ? [practice[n - 4]!.id] : [reflection.id];
    const mastery = phase === 'concept_mastery' ? ids : [];
    const blocks = practical ? { review: 5, theory: 10, check: 10, practice: 25, reflect: 10 }
      : n === 8 ? { review: 10, theory: 10, check: 10, practice: 0, reflect: 30 }
        : { review: 5, theory: 25, check: 20, practice: 0, reflect: 10 };
    return {
      id: `${prefix}-session-${n}`, sessionIndex: n, title, phase,
      sessionType: practical ? 'practice' : n === 8 ? 'review' : 'theory', durationMinutes: 60,
      objectiveIds: ids, blocks, learningGoal: prompt, contentStrategy: 'adaptive.v1',
      leadAssistantId: n <= 3 ? assistantIds[0] : n <= 7 ? assistantIds[1] : assistantIds[2],
      opening: { version: 'lesson-opening.v1', scenario: title, prompt, options: [
        { id: 'start', label: '开始这一课', text: prompt },
        { id: 'example', label: '先看一个例子', text: '请先解释一个概念，再用图示和例子带我尝试。' },
        { id: 'help', label: '说说我的疑问', text: '我想先说清楚自己卡住的地方。' },
      ] },
      requiredSkillIds: skills, requiredToolIds: ['tutor.propose_lesson_activity'], teachingRequirements: ['dynamic_lesson'],
      activityGuidance: {
        review: n === 1 ? `了解学生已有经验，以“${input.question}”开场；尚未确认时仅使用探索草稿。` : '回看上一课保存的证据，请学生说出与本课有关的一点，不重复全部新授。',
        theory: `${prompt}\n使用注册 BoardBlock、Mermaid 或适用的 KaTeX 分步展示，再请学生预测、解释或比较。${n === 2 || n === 3 ? concepts.slice(n === 2 ? 0 : 2, n === 2 ? 2 : 4).map(c => c.description).join('\n') : ''}`,
        check: mastery.length ? '先讲解和展示本课概念，再调用正式检查；使用本课稳定题实例，答错给同目标补救，求助保留待答题。'
          : `请学生结合自己的材料回答一个有界问题。${evidence}`,
        ...(practical ? { practice: `TheoryMastered 后进行当前任务。${prompt}\n${evidence}\n原始观察、模拟情境和教学示例分别标识，不替学生编造操作或测量结果。` } : {}),
        reflect: n === 8 ? `结合已发布的本项目作品解释一个选择、一次修改与一个限制，保存最终反思并等待服务端归档回执。${evidence}`
          : `保存学生自己的解释和证据，并说出下一次可检验的改进。${evidence}`,
      },
      evidenceRequirements: [evidence, '说明本人完成的部分；标记教学示例、模拟数据和外部来源，不把 AI 文本当作自己的实际观察。'],
      activityRequirements: activities.filter(activity => blocks[activity] > 0).map(activity => ({ activity,
        evidence: activity === 'check' && mastery.length ? 'mastery'
          : n === 7 && activity === 'practice' ? 'submitted_artifact' : 'session_response' })),
      completionSpec: { version: 'learning-session-completion.v2', requiredMasteryObjectiveIds: mastery,
        requiredEvidence: [{ kind: 'session_response', scope: 'session', minimumCount: 1 },
          ...(n === 7 || n === 8 ? [{ kind: 'approved_artifact' as const, scope: n === 7 ? 'session' as const : 'project' as const, minimumCount: 1 }] : [])],
        qualityReview: { version: 'lesson-quality.v1', reviewer: 'autonomous-learning.v1', criteria: [
          { id: `${prefix}-${n}-explanation`, description: `围绕本课“${title}”回答当前活动的问题，用自己的话说明理由；允许在概念活动中讨论示例。` },
          { id: `${prefix}-${n}-integrity`, description: '回应与本课任务相符，说明哪些内容是本人尝试、材料提供或尚未核验，不伪造来源和实践结果。' },
        ], ...(n === 7 ? { artifactCriteria: input.rubric.map(item => ({ id: item.id, description: item.description })) } : {}) },
      },
      ...(n === 3 ? { checkpoint: { requiredGate: 'TheoryMastered' } }
        : n === 7 ? { checkpoint: { requiredGate: 'rubric_artifact_validated' } }
          : n === 8 ? { checkpoint: { requiredGate: 'review_completed_and_archived' } } : {}),
    };
  });
  const spec = parseProjectTemplateSpec({
    contractVersion: 'qitu.pbl-learning.v1', id: `pbl-${prefix}`, version: 'v1-8x60', status: 'draft', lessonPolicy: 'lesson-guided.v1',
    title: input.title, description: input.summary, targetDomain: input.domain, ageRange: { min: 11, max: 15 },
    prerequisites: ['从基础开始，不要求已有领域经验；正式实践前完成当前项目理论检查。'],
    materials: input.materials, safetyRequirements: input.safety, objectives,
    phases: [
      { phase: 'exploration', title: '问题与任务', objectiveIds: [start.id], gateCondition: 'student_confirmed_intent', deliverableType: null, assignedAssistantId: assistantIds[0] },
      { phase: 'concept_mastery', title: '概念与方法', objectiveIds: concepts.map(item => item.id), gateCondition: 'TheoryMastered', deliverableType: null, assignedAssistantId: assistantIds[0] },
      { phase: 'guided_practice', title: '实践与作品修订', objectiveIds: practice.map(item => item.id), gateCondition: 'rubric_artifact_validated',
        deliverableType: `${prefix}_portfolio`, evidenceProfile: 'rubric_artifact', assignedAssistantId: assistantIds[1] },
      { phase: 'deliverable_review', title: '解释、反思与归档', objectiveIds: [reflection.id], gateCondition: 'review_completed_and_archived', deliverableType: null, assignedAssistantId: assistantIds[2] },
    ], schedules: [{ lessonCount: 8, lessonMinutes: 60 }], finalDeliverableType: `${prefix}_portfolio`,
    rubricId: `${prefix}-rubric-v1`, teamId, governancePolicyId: 'rubric-pbl:v1', theme: { drivingQuestion: input.question },
    curriculum: { profiles: [{ id: profileId, schedule: { lessonCount: 8, lessonMinutes: 60 }, sessions }] },
  });
  const templateInput: CreateTemplateInput = { schoolId: null, slug: prefix, title: input.title, summary: input.summary,
    domain: input.domain, ageRange: '11–15', difficulty: 'introductory', estimatedDurationMinutes: 480,
    requiredMaterials: [...(input.requiredMaterials ?? input.materials)], learningObjectives: objectives.map(item => item.title),
    outcomeForm: input.outcome, safetyNotes: input.safety.join('\n') };
  const bootstrapKey = `inspiration:${prefix}:8x60-v1`;
  const versionInput: CreateTemplateVersionInput = { stages: spec.phases.map(phase => ({ id: phase.phase, label: phase.title })),
    content: { bootstrapKey, pbl: spec, linkedTeamId: teamId }, rubric: input.rubric.map(item => ({ ...item })) };
  return { slug: prefix, bootstrapKey, profileId, teamId, teamName: input.teamName, roles: input.roles,
    assistantIds, skills, spec, rubric: input.rubric, templateInput, versionInput };
}
export type InspirationCourse = ReturnType<typeof defineRubricCourse>;
