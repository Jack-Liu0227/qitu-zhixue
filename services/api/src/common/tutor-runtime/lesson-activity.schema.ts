/** Closed model candidate contract; its digest is part of the frozen builtin tool descriptor. */
export const LESSON_ACTIVITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['board', 'optics', 'choice_question'] }, title: { type: 'string', maxLength: 100 }, summary: { type: 'string', maxLength: 500 },
    steps: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['caption'], properties: {
      caption: { type: 'string', maxLength: 300 }, tex: { type: 'string', maxLength: 500 },
      nodes: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' } } } },
      edges: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    } } },
    mode: { type: 'string', enum: ['diffraction', 'scattering'] },
    parameters: { type: 'object', additionalProperties: false, properties: { wavelength: { type: 'number', minimum: 400, maximum: 750 }, slitWidth: { type: 'number', minimum: 10, maximum: 200 }, screenDistance: { type: 'number', minimum: 0.5, maximum: 2 }, particleRadius: { type: 'number', minimum: 5, maximum: 300 } } },
    question: { type: 'object', additionalProperties: false, required: ['prompt', 'options', 'correctOptionIndex', 'explanation', 'difficulty', 'sourceRefs'], properties: {
      prompt: { type: 'string', maxLength: 2000 }, options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 500 } } } },
      correctOptionIndex: { type: 'integer', minimum: 0, maximum: 5 }, explanation: { type: 'string', maxLength: 3000 }, difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
    } },
  },
};
