import { WAVE_TEACHING_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { WAVE_OPTICS_TEMPLATE_INPUT, WAVE_OPTICS_VERSION_INPUT } from './wave-optics';
import type { CreateTemplateInput, CreateTemplateVersionInput } from '../templates.types';

export const WAVE_TEACHING_TEMPLATE_SLUG = 'wave-interference-diffraction-8s-zero-base';
export const WAVE_TEACHING_BOOTSTRAP_KEY = 'wave-interference-diffraction:8s-zero-base-v2';
export const WAVE_TEACHING_TEMPLATE_INPUT: CreateTemplateInput = { ...WAVE_OPTICS_TEMPLATE_INPUT,
  slug: WAVE_TEACHING_TEMPLATE_SLUG, title: `${WAVE_TEACHING_TEMPLATE_SPEC.title} · 从基础开始`,
  summary: '依据授权知识库逐步讲解、展示分步课件，再通过检查、探究与反思完成八课时。' };
export const WAVE_TEACHING_VERSION_INPUT: CreateTemplateVersionInput = { ...WAVE_OPTICS_VERSION_INPUT,
  content: { bootstrapKey: WAVE_TEACHING_BOOTSTRAP_KEY, pbl: WAVE_TEACHING_TEMPLATE_SPEC } };
