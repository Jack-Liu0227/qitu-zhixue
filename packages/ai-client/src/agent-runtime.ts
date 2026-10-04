import type {
  TutorAgentCapability,
  TutorAgentContext,
  TutorAgentOutput,
  TutorAgentSdk,
} from '@qitu/contracts';

export interface TutorAgentPorts {
  run(input: {
    context: TutorAgentContext;
    capability: TutorAgentCapability;
  }): Promise<TutorAgentOutput>;
}

/** Thin SDK facade: orchestration stays server-owned; clients receive projections only. */
export function createTutorAgentSdk(ports: TutorAgentPorts): TutorAgentSdk {
  return Object.freeze({
    run: (input) => ports.run(input),
  });
}
