import { WAVE_OPTICS_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { CreateTemplateInput, CreateTemplateVersionInput } from '../templates.types';

export const WAVE_OPTICS_TEMPLATE_SLUG = 'wave-interference-diffraction-8s';
export const WAVE_OPTICS_BOOTSTRAP_KEY = 'wave-interference-diffraction:8s-v1';
export const WAVE_OPTICS_TEMPLATE_INPUT: CreateTemplateInput = {
  schoolId: null, slug: WAVE_OPTICS_TEMPLATE_SLUG, title: WAVE_OPTICS_TEMPLATE_SPEC.title,
  summary: WAVE_OPTICS_TEMPLATE_SPEC.description, domain: 'physics', ageRange: '13–15', difficulty: 'introductory',
  estimatedDurationMinutes: 480, requiredMaterials: [...WAVE_OPTICS_TEMPLATE_SPEC.materials],
  learningObjectives: WAVE_OPTICS_TEMPLATE_SPEC.objectives.map(objective => objective.description),
  outcomeForm: '明暗条纹探究档案',
  safetyNotes: WAVE_OPTICS_TEMPLATE_SPEC.safetyRequirements.join('\n'),
};
export const WAVE_OPTICS_VERSION_INPUT: CreateTemplateVersionInput = {
  stages: WAVE_OPTICS_TEMPLATE_SPEC.phases.map(phase => ({ id: phase.phase, label: phase.title })),
  content: { bootstrapKey: WAVE_OPTICS_BOOTSTRAP_KEY, pbl: WAVE_OPTICS_TEMPLATE_SPEC },
  rubric: [
    { id: 'wave-observation', label: '观察与比较', description: '参数、单位和模拟观察可追溯，比较只改变目标变量。' },
    { id: 'wave-explanation', label: '证据与解释', description: '分别解释双缝干涉、单缝衍射及两者联系，说明模型边界。' },
    { id: 'wave-revision', label: '修订与反思', description: '回应质疑，依据证据修订，并记录自己的理解变化。' },
  ],
};
