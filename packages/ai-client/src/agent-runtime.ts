import type {
  TutorAgentCapability,
  TutorAgentContext,
  TutorAgentOutput,
  TutorAgentSdk,
} from '@qitu/contracts';

export interface TutorAgentPorts {
  run<TPayload = unknown>(input: {
    context: TutorAgentContext;
    capability: TutorAgentCapability;
  }): Promise<TutorAgentOutput<TPayload>>;
}

/** Thin SDK facade: orchestration stays server-owned; clients receive projections only. */
export function createTutorAgentSdk(ports: TutorAgentPorts): TutorAgentSdk {
  return Object.freeze({
    run<TPayload = unknown>(input: {
      context: TutorAgentContext;
      capability: TutorAgentCapability;
    }): Promise<TutorAgentOutput<TPayload>> {
      return ports.run<TPayload>(input);
    },
  });
}
