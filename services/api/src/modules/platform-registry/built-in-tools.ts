import type {
  AdminRuntimeBuiltinTool,
  TutorAgentCapability,
  TutorAgentToolDescriptor,
  TutorAgentToolRegistry,
} from '@qitu/contracts';
import { createTutorAgentToolRegistry } from '@qitu/contracts';

/**
 * Server-owned metadata for built-in tutor tools.
 *
 * The registry contains descriptors only. Tool execution, credentials and
 * student data remain behind the owning domain services.
 */
const BUILTIN_TOOL_DESCRIPTORS: readonly TutorAgentToolDescriptor[] = [
  {
    id: 'tutor.context_packet',
    version: 'tutor.context_packet.v1',
    capabilities: ['explore', 'plan', 'teach', 'review', 'reflect', 'summarize'],
    execution: 'server_owned',
    riskLevel: 'medium',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.pedagogy_move',
    version: 'tutor.pedagogy_move.v1',
    capabilities: ['explore', 'plan', 'teach', 'review', 'reflect'],
    execution: 'server_owned',
    riskLevel: 'medium',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.mastery_gate',
    version: 'tutor.mastery_gate.v1',
    capabilities: ['plan', 'teach', 'review'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'tutor.escalation',
    version: 'tutor.escalation.v1',
    capabilities: ['teach', 'review', 'reflect'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'agent-memory.index',
    version: 'agent-memory.index.v1',
    capabilities: ['reflect', 'summarize'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: false,
  },
  {
    id: 'project.next_step',
    version: 'project.next_step.v1',
    capabilities: ['plan', 'teach', 'review'],
    execution: 'server_owned',
    riskLevel: 'high',
    requiresTheoryMastered: true,
  },
];

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

  asAgentRegistry(): TutorAgentToolRegistry {
    return createTutorAgentToolRegistry(BUILTIN_TOOL_DESCRIPTORS);
  }

  listForCapability(capability: TutorAgentCapability): readonly TutorAgentToolDescriptor[] {
    return this.asAgentRegistry().list({ capability });
  }
}

export const builtinToolRegistry = new BuiltinToolRegistry();
