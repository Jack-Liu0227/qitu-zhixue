import type {
  AgentConfig,
  AgentDelegateRequest,
  AgentDelegateResult,
  AgentGraphEdge,
  AgentGraphNode,
  AgentTaskInputMap,
  AgentTaskOutputMap,
  StaticAgentGraph,
  TeamAgentId,
  TeamRunId,
  TeamTaskId,
  TypedAgentTaskKind,
  TEAM_RUNTIME_VERSION,
} from '@qitu/contracts';

export interface AgentDelegateInput<K extends TypedAgentTaskKind> {
  runId: TeamRunId;
  taskId: TeamTaskId;
  senderAgentId: TeamAgentId;
  recipientAgentId: TeamAgentId;
  taskKind: K;
  input: AgentTaskInputMap[K];
  correlationId: string;
  causationId?: string | null;
  idempotencyKey: string;
}

/** Transport boundary implemented by the server mailbox/worker layer. */
export interface AgentDelegateTransport {
  send<K extends TypedAgentTaskKind>(
    request: AgentDelegateRequest<K>,
  ): Promise<AgentDelegateResult<K>>;
}

export interface AgentDelegatePolicy {
  leaderAgentId: TeamAgentId;
  /** Server-resolved allow-list. The browser must never widen this list. */
  allowedRecipients: readonly TeamAgentId[];
}

export interface TypedAgentDelegate {
  delegate<K extends TypedAgentTaskKind>(
    input: AgentDelegateInput<K>,
  ): Promise<AgentTaskOutputMap[K]>;
}

/**
 * Build the only SDK primitive a leader needs to call a child Agent. It adds
 * the protocol version, rejects non-routable recipients and verifies that the
 * worker returned the same task/correlation pair before exposing its payload.
 */
export function createTypedAgentDelegate(
  transport: AgentDelegateTransport,
  policy: AgentDelegatePolicy,
): TypedAgentDelegate {
  if (!transport?.send) throw new Error('TEAM_DELEGATE_TRANSPORT_NOT_CONFIGURED');
  if (!policy.leaderAgentId?.trim()) throw new Error('TEAM_LEADER_ID_REQUIRED');

  const allowed = new Set(policy.allowedRecipients);
  return Object.freeze({
    async delegate<K extends TypedAgentTaskKind>(
      input: AgentDelegateInput<K>,
    ): Promise<AgentTaskOutputMap[K]> {
      assertDelegateInput(input, policy.leaderAgentId, allowed);
      const request: AgentDelegateRequest<K> = {
        contractVersion: 'qitu.team-runtime.v1',
        messageType: 'delegate.request',
        runId: input.runId,
        taskId: input.taskId,
        senderAgentId: input.senderAgentId,
        recipientAgentId: input.recipientAgentId,
        taskKind: input.taskKind,
        input: input.input,
        correlationId: input.correlationId,
        causationId: input.causationId ?? null,
        idempotencyKey: input.idempotencyKey,
      };
      const result = await transport.send(request);
      assertDelegateResult(result, request);
      if (result.status === 'failed' || result.output === null) {
        throw new Error(result.errorCode ?? 'TEAM_DELEGATE_FAILED');
      }
      return result.output;
    },
  });
}

function assertDelegateInput<K extends TypedAgentTaskKind>(
  input: AgentDelegateInput<K>,
  leaderAgentId: TeamAgentId,
  allowedRecipients: ReadonlySet<TeamAgentId>,
): void {
  for (const value of [
    input.runId,
    input.taskId,
    input.senderAgentId,
    input.recipientAgentId,
    input.taskKind,
    input.correlationId,
    input.idempotencyKey,
  ]) {
    if (!value?.trim()) throw new Error('TEAM_DELEGATE_INPUT_INVALID');
  }
  if (input.senderAgentId !== leaderAgentId) throw new Error('TEAM_DELEGATE_SENDER_NOT_LEADER');
  if (!allowedRecipients.has(input.recipientAgentId))
    throw new Error('TEAM_DELEGATE_ROUTE_NOT_ALLOWED');
  if (input.recipientAgentId === leaderAgentId) throw new Error('TEAM_DELEGATE_SELF_ROUTE');
  if (input.input === undefined || input.input === null)
    throw new Error('TEAM_DELEGATE_PAYLOAD_REQUIRED');
}

function assertDelegateResult<K extends TypedAgentTaskKind>(
  result: AgentDelegateResult<K>,
  request: AgentDelegateRequest<K>,
): void {
  if (
    !result ||
    result.contractVersion !== 'qitu.team-runtime.v1' ||
    result.messageType !== 'delegate.result'
  ) {
    throw new Error('TEAM_DELEGATE_RESULT_INVALID');
  }
  if (
    result.runId !== request.runId ||
    result.taskId !== request.taskId ||
    result.taskKind !== request.taskKind ||
    result.correlationId !== request.correlationId ||
    result.recipientAgentId !== request.senderAgentId ||
    result.senderAgentId !== request.recipientAgentId
  ) {
    throw new Error('TEAM_DELEGATE_RESULT_MISMATCH');
  }
}

export interface StaticAgentGraphOptions {
  generatedAt?: string;
  leaderAgentId: TeamAgentId;
  statusByAgentId?: ReadonlyMap<TeamAgentId, AgentGraphNode['status']>;
  lastRunByAgentId?: ReadonlyMap<TeamAgentId, string | null>;
  invocationByRouteId?: ReadonlyMap<string, number>;
}

/** Build the browser-safe static graph projection from resolved Agent configs. */
export function buildStaticAgentGraph(
  configs: readonly AgentConfig[],
  options: StaticAgentGraphOptions,
): StaticAgentGraph {
  const ids = new Set(configs.map((config) => config.id));
  if (!ids.has(options.leaderAgentId)) throw new Error('TEAM_LEADER_NOT_FOUND');
  const statusByAgentId = options.statusByAgentId ?? new Map();
  const lastRunByAgentId = options.lastRunByAgentId ?? new Map();
  const invocationByRouteId = options.invocationByRouteId ?? new Map();

  const nodes: AgentGraphNode[] = configs.map((config) => ({
    agentId: config.id,
    label: config.label,
    parentAgentId: config.parentAgentId,
    isLeader: config.isLeader,
    enabled: config.enabled,
    status: statusByAgentId.get(config.id) ?? (config.enabled ? 'unknown' : 'disabled'),
    capabilities: config.capabilities,
    model: config.model,
    lastRunAt: lastRunByAgentId.get(config.id) ?? null,
  }));

  const edges: AgentGraphEdge[] = configs.flatMap((config) =>
    config.routes
      .filter((route) => route.direction === 'outbound' && ids.has(route.agentId))
      .map((route) => ({
        edgeId: route.id,
        fromAgentId: config.id,
        toAgentId: route.agentId,
        kind: route.kind,
        messageType: route.messageType,
        eventType: route.eventType ?? null,
        enabled: route.enabled,
        invocationCount: invocationByRouteId.get(route.id) ?? null,
        lastInvokedAt: null,
        lastErrorCode: null,
      })),
  );

  return {
    contractVersion: 'qitu.team-runtime.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    leaderAgentId: options.leaderAgentId,
    nodes,
    edges,
  };
}

export type TeamRuntimeVersion = typeof TEAM_RUNTIME_VERSION;
