import { RUNTIME_TOOL_CATALOG, type RuntimeToolCatalogEntry } from '@qitu/contracts';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import type {
  AdminRuntimeBuiltinTool,
  TutorAgentCapability,
  TutorAgentToolDescriptor,
  TutorAgentToolRegistry,
} from '@qitu/contracts';


/** Shared canonical tools plus the server-owned dynamic lesson candidate protocol.
 * Presence does not grant access; actual assistant bindings are projected by PlatformRegistryService. */
const BUILTIN_TOOL_CATALOG: readonly RuntimeToolCatalogEntry[] = [
  ...RUNTIME_TOOL_CATALOG,
  {
    id: 'tutor.propose_lesson_activity', version: 'tutor.propose_lesson_activity.v1',
    label: '生成本课时教学活动候选', invocation: 'model_tool',
    description: 'Propose a bounded board, gated optics activity, or source-grounded formative question for owner acceptance.',
    inputSchema: LESSON_ACTIVITY_SCHEMA,
    inputSchemaDigest: teachingValueDigest(LESSON_ACTIVITY_SCHEMA),
    capabilities: ['teach'], execution: 'server_owned', riskLevel: 'medium', requiresTheoryMastered: false,
  },
];

const BUILTIN_TOOL_DESCRIPTORS: readonly RuntimeToolCatalogEntry[] = BUILTIN_TOOL_CATALOG.map(tool => ({
  ...tool,
  ...(tool.inputSchema ? { inputSchemaDigest: teachingValueDigest(tool.inputSchema) } : {}),
}));

const BUILTIN_TOOL_REGISTRY: readonly AdminRuntimeBuiltinTool[] = BUILTIN_TOOL_DESCRIPTORS.map(tool => ({
  id: tool.id, label: tool.label, description: tool.description, status: 'enabled',
  invocation: tool.invocation, agentIds: [], riskLevel: tool.riskLevel,
  requiresTheoryMastered: tool.requiresTheoryMastered,
}));

function createToolRegistry(
  descriptors: readonly TutorAgentToolDescriptor[],
): TutorAgentToolRegistry {
  const frozen = descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...descriptor.capabilities]),
  }));
  return Object.freeze({
    list(input: { capability: TutorAgentCapability }): readonly TutorAgentToolDescriptor[] {
      return frozen.filter((descriptor) => descriptor.capabilities.includes(input.capability));
    },
  });
}

export class BuiltinToolRegistry {
  list(): AdminRuntimeBuiltinTool[] {
    return BUILTIN_TOOL_REGISTRY.map((tool) => ({ ...tool, agentIds: [...tool.agentIds] }));
  }

  listForAgentIds(toolIds: readonly string[]): readonly TutorAgentToolDescriptor[] {
    const allowed = new Set(toolIds);
    return BUILTIN_TOOL_DESCRIPTORS.filter((descriptor) => allowed.has(descriptor.id)).map((descriptor) => ({
      ...descriptor,
      capabilities: [...descriptor.capabilities],
    }));
  }

  asAgentRegistry(): TutorAgentToolRegistry {
    return createToolRegistry(BUILTIN_TOOL_DESCRIPTORS);
  }

  asAgentRegistryForIds(toolIds: readonly string[]): TutorAgentToolRegistry {
    const allowed = new Set(toolIds);
    return createToolRegistry(BUILTIN_TOOL_DESCRIPTORS.filter((descriptor) => allowed.has(descriptor.id)));
  }

  listForCapability(capability: TutorAgentCapability): readonly TutorAgentToolDescriptor[] {
    return this.asAgentRegistry().list({ capability });
  }
}

export const builtinToolRegistry = new BuiltinToolRegistry();
