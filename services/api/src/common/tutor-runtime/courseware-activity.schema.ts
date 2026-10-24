import { WAVE_ACTIVITY_SCHEMA } from './wave-activity.schema';

/** New capability: published legacy schemas and their pins remain byte-for-byte stable. */
export const COURSEWARE_ACTIVITY_SCHEMA = {
  ...WAVE_ACTIVITY_SCHEMA,
  properties: {
    ...WAVE_ACTIVITY_SCHEMA.properties,
    kind: { type: 'string', enum: [...WAVE_ACTIVITY_SCHEMA.properties.kind.enum, 'find_courseware', 'reuse_courseware'] },
    origin: { type: 'string', enum: ['generated', 'adapted'] },
    objectiveRefs: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', maxLength: 160 } },
    assetVersionId: { type: 'string', maxLength: 160 },
    parentVersionId: { type: 'string', maxLength: 160 },
    use: { type: 'string', enum: ['explain', 'demonstrate', 'remediate', 'review'] },
  },
};
