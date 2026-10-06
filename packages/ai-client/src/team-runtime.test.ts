import type {
  AgentConfig,
  AgentDelegateRequest,
  AgentDelegateResult,
  TypedAgentTaskKind,
} from '@qitu/contracts';
import {
  buildStaticAgentGraph,
  createTypedAgentDelegate,
  type AgentDelegateTransport,
} from './team-runtime.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Team runtime assertion failed: ${message}`);
}

const policy = { id: 'root-agents', version: '1', contentHash: null } as const;

function config(id: string, parentAgentId: string | null, isLeader: boolean): AgentConfig {
  return {
    id,
    version: '1',
    label: id,
    enabled: true,
    parentAgentId,
    isLeader,
    mission: id,
    constraints: [],
    capabilities: ['orchestrate'],
    dataScopes: [],
    skillIds: [],
    toolIds: [],
    routes: [],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    model: { providerId: 'test', modelId: 'test' },
    globalPolicy: policy,
  };
}

export async function runTeamRuntimeAssertions(): Promise<void> {
  const transport: AgentDelegateTransport = {
    async send<K extends TypedAgentTaskKind>(
      request: AgentDelegateRequest<K>,
    ): Promise<AgentDelegateResult<K>> {
      return {
        contractVersion: 'qitu.team-runtime.v1',
        messageType: 'delegate.result',
        runId: request.runId,
        taskId: request.taskId,
        senderAgentId: request.recipientAgentId,
        recipientAgentId: request.senderAgentId,
        taskKind: request.taskKind,
        status: 'succeeded',
        output: {
          confirmed: true,
          confidence: 'high',
          interests: ['plants'],
          followUpQuestions: [],
          evidenceRefs: [],
        } as never,
        errorCode: null,
        correlationId: request.correlationId,
        causationId: request.taskId,
      };
    },
  };
  const delegate = createTypedAgentDelegate(transport, {
    leaderAgentId: 'tutor',
    allowedRecipients: ['interest'],
  });
  const output = await delegate.delegate({
    runId: 'run-1',
    taskId: 'task-1',
    senderAgentId: 'tutor',
    recipientAgentId: 'interest',
    taskKind: 'interest.confirmation',
    input: {
      studentId: 'student-1',
      sessionId: 'session-1',
      conversationSummary: 'plants',
      evidenceRefs: [],
    },
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1',
  });
  assert(output.confirmed, 'typed delegate must return child output');
  let routeRejected = false;
  try {
    await delegate.delegate({
      runId: 'run-1',
      taskId: 'task-2',
      senderAgentId: 'tutor',
      recipientAgentId: 'unknown',
      taskKind: 'interest.confirmation',
      input: {
        studentId: 'student-1',
        sessionId: null,
        conversationSummary: 'x',
        evidenceRefs: [],
      },
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
    });
  } catch (error) {
    routeRejected = error instanceof Error && error.message === 'TEAM_DELEGATE_ROUTE_NOT_ALLOWED';
  }
  assert(routeRejected, 'unknown recipient must be rejected');

  const tutor: AgentConfig = {
    ...config('tutor', null, true),
    routes: [
      {
        id: 'tutor->interest',
        kind: 'delegate',
        direction: 'outbound',
        messageType: 'delegate.request',
        agentId: 'interest',
        enabled: true,
      },
    ],
  };
  const graph = buildStaticAgentGraph([tutor, config('interest', 'tutor', false)], {
    leaderAgentId: 'tutor',
  });
  assert(graph.nodes.length === 2, 'static graph must include agents');
  assert(
    graph.edges.length === 1 && graph.edges[0]?.fromAgentId === 'tutor',
    'static graph must include routes',
  );
}
