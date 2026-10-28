import { WAVE_DIALOGUE_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { WAVE_TEACHING_TEMPLATE_INPUT, WAVE_TEACHING_VERSION_INPUT } from './wave-teaching';
import type { CreateTemplateInput, CreateTemplateVersionInput } from '../templates.types';

export const WAVE_DIALOGUE_TEMPLATE_SLUG = 'wave-interference-diffraction-8s-dialogue';
export const WAVE_DIALOGUE_BOOTSTRAP_KEY = 'wave-interference-diffraction:8s-dialogue-v1';
export const WAVE_DIALOGUE_TEMPLATE_INPUT: CreateTemplateInput = { ...WAVE_TEACHING_TEMPLATE_INPUT,
  slug: WAVE_DIALOGUE_TEMPLATE_SLUG, title: WAVE_DIALOGUE_TEMPLATE_SPEC.title,
  summary: '问答自动留证，保留理论检查与模拟观察，在最后一课整理并交付探究档案。' };
export const WAVE_DIALOGUE_VERSION_INPUT: CreateTemplateVersionInput = { ...WAVE_TEACHING_VERSION_INPUT,
  content: { bootstrapKey: WAVE_DIALOGUE_BOOTSTRAP_KEY, pbl: WAVE_DIALOGUE_TEMPLATE_SPEC } };
