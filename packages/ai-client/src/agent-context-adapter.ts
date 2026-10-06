import type { TutorAgentContext, TutorAgentContextInput, TutorAgentScope } from '@qitu/contracts';
import type { TutorAgentContextBuilder } from './agent-runtime.js';
import type {
  TutorContextInput,
  TutorContextPacket,
  TutorContextReader,
} from './tutor-context.js';

/**
 * Adapt the existing bounded Tutor context reader to the versioned Agent
 * runtime. The adapter carries a packet as runtime data; it never exposes the
 * underlying workspace ports to the agent.
 */
export function createTutorAgentContextBuilder(
  reader: TutorContextReader,
): TutorAgentContextBuilder<TutorContextPacket> {
  return {
    async build(input: {
      scope: TutorAgentScope;
      request: TutorAgentContextInput;
    }): Promise<TutorAgentContext<TutorContextPacket>> {
      const packetInput: TutorContextInput = {
        studentId: input.scope.studentId,
        projectId: input.scope.projectId,
        projectStage: input.request.projectStage as TutorContextInput['projectStage'],
        currentGoal: input.request.goal,
        query: input.request.query,
        recentActivity: [],
      };
      const packet = await reader.buildContext(packetInput);
      return {
        contextId: input.request.requestId,
        runtimeVersion: 'qitu.agent-runtime.v1',
        builtAt: new Date().toISOString(),
        policyVersion: packet.runtime?.policyVersion ?? 'unconfigured',
        agentDefinition: packet.runtime?.agentDefinition ?? '',
        skills: packet.runtime?.skills ?? [],
        tools: packet.runtime?.tools ?? [],
        mcpServers: packet.runtime?.mcpServers ?? [],
        scope: input.scope,
        capability: input.request.capability,
        modelUsage: input.request.modelUsage ?? 'tutor.chat',
        query: input.request.query,
        projectStage: input.request.projectStage,
        goal: input.request.goal,
        evidenceRefs: input.request.evidenceRefs ?? [],
        data: packet,
      };
    },
  };
}
