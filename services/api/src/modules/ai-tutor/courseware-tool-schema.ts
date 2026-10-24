import { COURSEWARE_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/courseware-activity.schema';
import { BOARD_STEPS_SCHEMA } from '../../common/tutor-runtime/activity-tool-schema';

export const COURSEWARE_TOOL_INSTRUCTIONS = 'This lesson requires source-grounded courseware, including newly generated boards. First search and read an authorized source with knowledge_read or ima_read_document in this turn. Every board MUST include sourceRefs copied from the actual verified read evidence_ref and objectiveRefs selected from the schema enum. Never use plan-prefixed objective IDs. find_courseware accepts ONLY kind,use. reuse_courseware accepts ONLY kind,assetVersionId,sourceRefs. board accepts ONLY kind,title,steps,objectiveRefs,sourceRefs and optional origin,parentVersionId; OMIT use,summary,mode,parameters,nulls and unused fields. Each step has caption and either nodes with edges (use [] if no edges) or nonempty tex. Save one coherent board per turn, then wait for the learner. A newly generated board still requires verified sources; do not apply the source-free board rule from other courses. ';

/** Narrows the model-facing proposal format; the frozen capability and owner validation stay unchanged. */
export function coursewareToolSchema(objectiveIds: readonly string[], practiceMode: 'diffraction' | 'interference' | null = null): Record<string, unknown> {
  const properties = COURSEWARE_ACTIVITY_SCHEMA.properties;
  const variants = [
    { kind: 'find_courseware', required: ['use'], optional: [] },
    { kind: 'reuse_courseware', required: ['assetVersionId', 'sourceRefs'], optional: [] },
    { kind: 'board', required: ['title', 'steps', 'objectiveRefs', 'sourceRefs'], optional: ['origin', 'parentVersionId'] },
    { kind: 'wave_preview', required: ['title'], optional: ['summary'] },
    { kind: 'recommendation', required: ['title', 'summary', 'sourceRefs'], optional: [] },
    { kind: 'optics', required: ['title', 'summary', 'mode', 'parameters'], optional: [] },
    { kind: 'choice_question', required: ['question'], optional: [] },
  ];
  const available = variants.filter(variant => practiceMode ? variant.kind === 'optics' : ['find_courseware', 'reuse_courseware', 'board'].includes(variant.kind));
  const branches = available.map(variant => ({ type: 'object', additionalProperties: false,
    properties: Object.fromEntries(['kind', ...variant.required, ...variant.optional].map(name => {
      if (name === 'kind') return [name, { const: variant.kind }];
      if (name === 'mode' && practiceMode) return [name, { const: practiceMode }];
      if (name === 'parameters' && practiceMode) {
        const names = ['wavelength', 'slitWidth', 'screenDistance', ...(practiceMode === 'interference' ? ['slitSeparation'] : [])];
        return [name, { type: 'object', additionalProperties: false, required: names,
          properties: Object.fromEntries(names.map(key => [key, Reflect.get(properties.parameters.properties, key)])) }];
      }
      if (name === 'sourceRefs') return [name, { ...properties.sourceRefs, minItems: 1 }];
      if (name === 'steps') return [name, BOARD_STEPS_SCHEMA];
      if (name === 'objectiveRefs') return [name, { ...properties.objectiveRefs, items: { type: 'string', enum: [...objectiveIds] } }];
      return [name, Reflect.get(properties, name)];
    })), required: ['kind', ...variant.required] }));
  return branches.length === 1 ? branches[0]! : { type: 'object', oneOf: branches };
}
