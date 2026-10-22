import { LESSON_ACTIVITY_SCHEMA } from './lesson-activity.schema';

/** A separate capability preserves the published v1 lesson-tool schema and historical pins. */
export const WAVE_ACTIVITY_SCHEMA = {
  ...LESSON_ACTIVITY_SCHEMA,
  properties: {
    ...LESSON_ACTIVITY_SCHEMA.properties,
    kind: { type: 'string', enum: ['board', 'wave_preview', 'optics', 'choice_question', 'recommendation'] },
    origin: { type: 'string', enum: ['generated', 'adapted'] },
    sourceRefs: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', maxLength: 200 } },
    mode: { type: 'string', enum: ['diffraction', 'interference'] },
    parameters: { type: 'object', additionalProperties: false, properties: {
      wavelength: { type: 'number', minimum: 400, maximum: 750 },
      slitWidth: { type: 'number', minimum: 10, maximum: 200 },
      slitSeparation: { type: 'number', minimum: 40, maximum: 400 },
      screenDistance: { type: 'number', minimum: 0.5, maximum: 2 },
    } },
  },
};
