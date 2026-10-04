import type { AdminRuntimeBuiltinTool } from '@qitu/contracts';

/**
 * Server-owned metadata for built-in tutor tools.
 *
 * This registry describes the bounded capabilities that may be composed by the
 * tutor pipeline. It deliberately contains no function references, credentials,
 * prompt bodies, or student data; execution remains behind the owning service.
 */
const BUILTIN_TOOL_REGISTRY: readonly AdminRuntimeBuiltinTool[] = [
  {
    id: 'tutor.context_packet',
    label: 'Tutor context packet',
    description: 'Assemble bounded, permission-filtered context for one tutor turn.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: false,
    riskLevel: 'medium',
  },
  {
    id: 'tutor.pedagogy_move',
    label: 'Socratic pedagogy move',
    description: 'Select a hint-ladder move without releasing the expected answer.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: false,
    riskLevel: 'medium',
  },
  {
    id: 'tutor.mastery_gate',
    label: 'Theory mastery gate',
    description: 'Check the server-owned TheoryMastered prerequisite before practice.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: false,
    riskLevel: 'high',
  },
  {
    id: 'tutor.escalation',
    label: 'Teacher escalation',
    description: 'Create one idempotent teacher follow-up after a deterministic stall.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: false,
    riskLevel: 'high',
  },
  {
    id: 'agent-memory.index',
    label: 'Agent memory index outbox',
    description: 'Process approved memory index events without exposing raw conversations.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: false,
    riskLevel: 'high',
  },
  {
    id: 'project.next_step',
    label: 'Project next-step selector',
    description: 'Select the next theory or practice objective from server-owned progress.',
    status: 'enabled',
    agentIds: ['qitu-learning-partner'],
    requiresTheoryMastered: true,
    riskLevel: 'high',
  },
];

export class BuiltinToolRegistry {
  list(): AdminRuntimeBuiltinTool[] {
    return BUILTIN_TOOL_REGISTRY.map((tool) => ({ ...tool, agentIds: [...tool.agentIds] }));
  }
}

export const builtinToolRegistry = new BuiltinToolRegistry();
