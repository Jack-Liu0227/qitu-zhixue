import type {
  TutorAgentContext,
  TutorAgentContextInput,
  TutorAgentOutput,
  TutorAgentPayload,
  TutorAgentReadPorts,
  TutorAgentCapability,
  TutorAgentBoundReadPorts,
  TutorAgentModelPurpose,
  TutorDatabaseProjectionName,
  TutorAgentRuntimeRunInput,
  TutorAgentRunRequest,
  TutorAgentScope,
  TutorAgentToolRegistry,
  TUTOR_AGENT_RUNTIME_VERSION,
} from '@qitu/contracts';

export interface TutorAgentContextBuilder<TData = Record<string, never>> {
  build(input: {
    scope: TutorAgentScope;
    request: TutorAgentContextInput;
  }): Promise<TutorAgentContext<TData>>;
}

export interface TutorAgentExecutor<
  TData = Record<string, never>,
  TPayload extends TutorAgentPayload = TutorAgentPayload,
> {
  run(input: TutorAgentRunRequest<TData>): Promise<TutorAgentOutput<TPayload>>;
}

export interface TutorAgentModelPurposePort {
  resolve(input: {
    scope: TutorAgentScope;
    capability: TutorAgentCapability;
  }): Promise<TutorAgentModelPurpose>;
}

export interface TutorAgentRuntimePorts<
  TData = Record<string, never>,
  TPayload extends TutorAgentPayload = TutorAgentPayload,
> {
  context: TutorAgentContextBuilder<TData>;
  executor: TutorAgentExecutor<TData, TPayload>;
  modelPurpose: TutorAgentModelPurposePort;
  read: TutorAgentReadPorts;
  tools: TutorAgentToolRegistry;
}

export interface TutorAgentRuntime<
  TData = Record<string, never>,
  TPayload extends TutorAgentPayload = TutorAgentPayload,
> {
  readonly scope: Readonly<TutorAgentScope>;

  readonly read: TutorAgentBoundReadPorts;

  readonly tools: TutorAgentToolRegistry;
  buildContext(input: TutorAgentContextInput): Promise<TutorAgentContext<TData>>;
  run(input: TutorAgentRuntimeRunInput): Promise<TutorAgentOutput<TPayload>>;
}

/**
 * Bind an authorized scope once and reject every attempt to replace it later.
 * This is the only generic SDK composition primitive; domain services still
 * own all writes, authorization checks, idempotency and audit records.
 */
export function createTutorAgentRuntime<
  TData = Record<string, never>,
  TPayload extends TutorAgentPayload = TutorAgentPayload,
>(
  scope: TutorAgentScope,
  ports: TutorAgentRuntimePorts<TData, TPayload>,
): TutorAgentRuntime<TData, TPayload> {
  assertScope(scope);
  if (!ports.context?.build || !ports.executor?.run || !ports.modelPurpose?.resolve || !ports.read || !ports.tools) {
    throw new Error('AGENT_RUNTIME_PORT_NOT_CONFIGURED');
  }

  const bound = Object.freeze({ ...scope });
  const boundRead: TutorAgentBoundReadPorts = {
    knowledge: {
      search: (input) => ports.read.knowledge.search({ scope: bound, ...input }),
    },
    templates: {
      listPublished: (input) => ports.read.templates.listPublished({ scope: bound, ...input }),
    },
    database: {
      readProjection: <K extends TutorDatabaseProjectionName>(input: { projection: K }) =>
        ports.read.database.readProjection({ scope: bound, projection: input.projection }),
    },
  };

  const buildContext = async (input: TutorAgentContextInput) => {
    assertRequest(input);
    const purpose = await ports.modelPurpose.resolve({ scope: bound, capability: input.capability });
    if (!purpose.usageId || !purpose.available) throw new Error('AGENT_MODEL_PURPOSE_UNAVAILABLE');
    const context = await ports.context.build({ scope: bound, request: { ...input, modelUsage: purpose.usageId } });
    assertContextScope(context, bound);
    if (context.runtimeVersion !== 'qitu.agent-runtime.v1') {
      throw new Error('AGENT_RUNTIME_VERSION_MISMATCH');
    }
    return context;
  };

  return Object.freeze({
    scope: bound,
    read: boundRead,
    tools: ports.tools,
    buildContext,
    async run(input: TutorAgentRuntimeRunInput): Promise<TutorAgentOutput<TPayload>> {
      if (!input.idempotencyKey?.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
      const context = await buildContext({
        requestId: input.requestId,
        capability: input.capability,
        query: input.query,
        projectStage: input.projectStage,
        goal: input.goal,
        evidenceRefs: input.evidenceRefs,
      });
      const output = await ports.executor.run({
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        capability: input.capability,
        context,
      });
      assertOutput(output, bound, input);
      return output;
    },
  });
}

export function assertScope(scope: TutorAgentScope): void {
  for (const value of [scope.actorId, scope.studentId, scope.partnerId]) {
    if (!value?.trim()) throw new Error('AGENT_SCOPE_INVALID');
  }
  if (scope.projectId !== null && !scope.projectId.trim()) throw new Error('AGENT_SCOPE_INVALID');
  if (scope.sessionId !== null && !scope.sessionId.trim()) throw new Error('AGENT_SCOPE_INVALID');
}

function assertRequest(input: TutorAgentContextInput): void {
  if (!input.requestId?.trim() || !input.query?.trim()) throw new Error('AGENT_CONTEXT_INPUT_INVALID');
  if (input.query.length > 4000) throw new Error('AGENT_CONTEXT_INPUT_TOO_LARGE');
}

function assertContextScope<TData>(context: TutorAgentContext<TData>, scope: TutorAgentScope): void {
  if (
    context.scope.actorId !== scope.actorId ||
    context.scope.studentId !== scope.studentId ||
    context.scope.partnerId !== scope.partnerId ||
    context.scope.projectId !== scope.projectId ||
    context.scope.sessionId !== scope.sessionId ||
    context.scope.schoolId !== scope.schoolId ||
    context.scope.actorRole !== scope.actorRole
  ) {
    throw new Error('AGENT_CONTEXT_SCOPE_MISMATCH');
  }
}

function assertOutput<TPayload extends TutorAgentPayload>(
  output: TutorAgentOutput<TPayload>,
  scope: TutorAgentScope,
  input: TutorAgentRuntimeRunInput,
): void {
  if (!output?.id || !output.runId || output.requestId !== input.requestId) {
    throw new Error('AGENT_OUTPUT_INVALID');
  }
  if (output.runtimeVersion !== 'qitu.agent-runtime.v1') {
    throw new Error('AGENT_RUNTIME_VERSION_MISMATCH');
  }
  if (output.agentId !== scope.partnerId) {
    throw new Error('AGENT_OUTPUT_AGENT_MISMATCH');
  }
}

export type TutorAgentRuntimeVersion = typeof TUTOR_AGENT_RUNTIME_VERSION;
