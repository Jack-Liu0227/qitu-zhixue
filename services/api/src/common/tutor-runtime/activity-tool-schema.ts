import { LESSON_ACTIVITY_SCHEMA } from './lesson-activity.schema';
import { WAVE_ACTIVITY_SCHEMA } from './wave-activity.schema';

// Model-facing projection only; registered capability digests remain immutable.
export const BOARD_STEPS_SCHEMA = { ...LESSON_ACTIVITY_SCHEMA.properties.steps,
  description: 'Include at least one visual step (tex or nodes plus edges). Other steps may contain only a caption for prediction, reflection or a short explanation. Omit unused fields; never send null.',
  contains: { type: 'object', anyOf: [{ required: ['tex'] }, { required: ['nodes', 'edges'] }] }, items: {
  ...LESSON_ACTIVITY_SCHEMA.properties.steps.items,
  properties: { ...LESSON_ACTIVITY_SCHEMA.properties.steps.items.properties,
    caption: { type: 'string', minLength: 1, maxLength: 300 }, tex: { type: 'string', minLength: 1, maxLength: 500 },
    nodes: { ...LESSON_ACTIVITY_SCHEMA.properties.steps.items.properties.nodes, minItems: 1,
      items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
        id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*$', minLength: 1, maxLength: 40 },
        label: { type: 'string', minLength: 1, maxLength: 100 },
      } } },
  },
} };

export function lessonActivityToolSchema(wave: boolean, kinds: readonly string[]): Record<string, unknown> {
  const base = wave ? WAVE_ACTIVITY_SCHEMA : LESSON_ACTIVITY_SCHEMA;
  const fields: Record<string, string[]> = {
    board: ['title', 'steps', ...(wave ? ['origin', 'sourceRefs'] : [])],
    optics: ['title', 'summary', 'mode', 'parameters'], choice_question: ['question'],
    wave_preview: ['title', 'summary'], recommendation: ['title', 'summary', 'sourceRefs'],
  };
  const required: Record<string, string[]> = { board: ['title', 'steps'], optics: fields.optics!,
    choice_question: ['question'], wave_preview: ['title'], recommendation: fields.recommendation! };
  const branches = kinds.filter(kind => fields[kind]).map(kind => ({ type: 'object', additionalProperties: false,
    properties: Object.fromEntries(['kind', ...fields[kind]!].map(name => [name, name === 'kind' ? { const: kind }
      : name === 'steps' ? BOARD_STEPS_SCHEMA : Reflect.get(base.properties, name)])), required: ['kind', ...required[kind]!] }));
  return branches.length === 1 ? branches[0]! : { type: 'object', oneOf: branches };
}
