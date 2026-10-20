import type { KnowledgeType, PblPhase } from '@qitu/contracts';
import {
  assertOpticsObjectiveTypePolicy,
  OPTICS_GATED_OBJECTIVE_IDS,
  OPTICS_16_SESSION_TEMPLATE_SPEC,
  OPTICS_16_COMPLETION_TEMPLATE_SPEC,
  OPTICS_OBJECTIVES,
  OPTICS_PHASES,
  OPTICS_WAVE_MODULES,
  OPTICS_WAVE_INQUIRY_STEPS,
} from '@qitu/ai-client/quiz-bank';
import type {
  CreateTemplateInput,
  CreateTemplateVersionInput,
  TemplateStage,
} from '../templates.types';

export const OPTICS_16_TEMPLATE_SLUG = 'optics-physical-inquiry-16s';
export const OPTICS_16_BOOTSTRAP_KEY = 'optics-physical-inquiry:16s-v2';

export const OPTICS_TEMPLATE_STAGES: TemplateStage[] = [
  { id: 'exploration', label: '生活情境启发与探究课题确认' },
  { id: 'concept_mastery', label: '光学核心定律探索与概念掌握' },
  { id: 'guided_practice', label: '光路搭建、数据采集与规律拟合' },
  { id: 'deliverable_review', label: '答辩评审与反思成长归档' },
];

export const OPTICS_RUBRIC: unknown[] = [
  { id: 'r1', criterion: '定律陈述与公式准确（反射/折射/全反射/透镜）', weight: 30 },
  { id: 'r2', criterion: '光路搭建与数据采集规范、真实', weight: 40 },
  { id: 'r3', criterion: '拟合与误差分析深入，结论边界清楚', weight: 30 },
];

export interface OpticsSessionModule {
  id: string;
  lessonIndex: number;
  title: string;
  phase: PblPhase;
  objectiveIds: readonly string[];
  minutes: number;
}

const opticsProfile = OPTICS_16_SESSION_TEMPLATE_SPEC.curriculum?.profiles[0];
if (!opticsProfile) throw new Error('OPTICS_16_SESSION_TEMPLATE_SPEC is missing its lesson profile');
// Keep the narrowed profile data in a local constant; TypeScript does not
// preserve optional-property narrowing across the object initializer below.
const opticsSchedule = opticsProfile.schedule;

export const OPTICS_16_SESSION_MODULES: readonly OpticsSessionModule[] = opticsProfile.sessions.map((session) => ({
  id: `m${session.sessionIndex}`,
  lessonIndex: session.sessionIndex,
  title: session.title,
  phase: session.phase,
  objectiveIds: session.objectiveIds,
  minutes: session.durationMinutes,
}));

export const OPTICS_KNOWLEDGE_TYPES: Readonly<Record<string, KnowledgeType | null>> =
  Object.fromEntries(OPTICS_OBJECTIVES.map((objective) => [objective.id, objective.knowledgeType]));

const opticsVersionContent: Record<string, unknown> = {
  bootstrapKey: OPTICS_16_BOOTSTRAP_KEY,
  pbl: OPTICS_16_SESSION_TEMPLATE_SPEC,
  modules: OPTICS_16_SESSION_MODULES,
  knowledgeTypes: OPTICS_KNOWLEDGE_TYPES,
  waveModules: OPTICS_WAVE_MODULES.map((module) => ({
    moduleId: module.moduleId,
    conceptId: module.conceptId,
    knowledgeType: module.knowledgeType,
    title: module.title,
    description: module.description,
  })),
  waveInquirySteps: OPTICS_WAVE_INQUIRY_STEPS,
};

export const OPTICS_16_VERSION_INPUT: CreateTemplateVersionInput = {
  stages: OPTICS_TEMPLATE_STAGES,
  content: opticsVersionContent,
  rubric: OPTICS_RUBRIC,
};

export const OPTICS_16_TEMPLATE_INPUT: CreateTemplateInput = {
  schoolId: null,
  slug: OPTICS_16_TEMPLATE_SLUG,
  title: OPTICS_16_SESSION_TEMPLATE_SPEC.title,
  summary: OPTICS_16_SESSION_TEMPLATE_SPEC.description,
  domain: OPTICS_16_SESSION_TEMPLATE_SPEC.targetDomain,
  ageRange: `${OPTICS_16_SESSION_TEMPLATE_SPEC.ageRange.min}-${OPTICS_16_SESSION_TEMPLATE_SPEC.ageRange.max}`,
  difficulty: 'medium',
  estimatedDurationMinutes: opticsSchedule.lessonCount * opticsSchedule.lessonMinutes,
  requiredMaterials: [...OPTICS_16_SESSION_TEMPLATE_SPEC.materials],
  learningObjectives: OPTICS_16_SESSION_TEMPLATE_SPEC.objectives.map((objective) => objective.title),
  outcomeForm: '探究实验报告',
  safetyNotes: OPTICS_16_SESSION_TEMPLATE_SPEC.safetyRequirements.join('; '),
};

export function assertOpticsTemplateStructure(): void {
  assertOpticsObjectiveTypePolicy();
  if (opticsSchedule.lessonCount !== 16 || OPTICS_16_SESSION_MODULES.length !== 16) {
    throw new Error('Optics template must contain exactly 16 lessons');
  }
  const objectiveIds = new Set(OPTICS_OBJECTIVES.map((objective) => objective.id));
  for (const phase of OPTICS_PHASES) {
    for (const id of phase.objectiveIds) {
      if (!objectiveIds.has(id)) throw new Error(`Phase ${phase.phase} references unknown objective ${id}`);
    }
  }
  const gated = OPTICS_PHASES.find((phase) => phase.phase === 'concept_mastery')?.objectiveIds ?? [];
  if ([...gated].sort().join('|') !== [...OPTICS_GATED_OBJECTIVE_IDS].sort().join('|')) {
    throw new Error('Theory-gate objective set does not match the registered set');
  }
  const covered = new Set(OPTICS_16_SESSION_MODULES.flatMap((module) => [...module.objectiveIds]));
  for (const id of objectiveIds) {
    if (!covered.has(id)) throw new Error(`Objective ${id} is not assigned to a lesson`);
  }
  for (const [index, module] of OPTICS_16_SESSION_MODULES.entries()) {
    if (module.lessonIndex !== index + 1) throw new Error('Lesson order must be contiguous and one-based');
    const phase = OPTICS_PHASES.find((item) => item.phase === module.phase);
    if (phase === undefined || module.objectiveIds.some((id) => !phase.objectiveIds.includes(id))) {
      throw new Error(`Lesson ${module.lessonIndex} has an objective outside its phase`);
    }
  }
  if (OPTICS_RUBRIC.length === 0 || typeof opticsVersionContent.bootstrapKey !== 'string') {
    throw new Error('Optics template is missing its rubric or bootstrap identity');
  }
}

export const OPTICS_16_COMPLETION_TEMPLATE_SLUG = 'optics-physical-inquiry-16s-completion';
export const OPTICS_16_COMPLETION_BOOTSTRAP_KEY = 'optics-physical-inquiry:16s-v3-completion';
const completionSessions = OPTICS_16_COMPLETION_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions;
export const OPTICS_16_COMPLETION_VERSION_INPUT: CreateTemplateVersionInput = {
  ...OPTICS_16_VERSION_INPUT,
  content: { ...opticsVersionContent, bootstrapKey: OPTICS_16_COMPLETION_BOOTSTRAP_KEY,
    pbl: OPTICS_16_COMPLETION_TEMPLATE_SPEC,
    modules: completionSessions.map((session) => ({ id: `m${session.sessionIndex}`, lessonIndex: session.sessionIndex,
      title: session.title, phase: session.phase, objectiveIds: session.objectiveIds, minutes: session.durationMinutes })),
  },
};
export const OPTICS_16_COMPLETION_TEMPLATE_INPUT: CreateTemplateInput = {
  ...OPTICS_16_TEMPLATE_INPUT,
  slug: OPTICS_16_COMPLETION_TEMPLATE_SLUG,
};
