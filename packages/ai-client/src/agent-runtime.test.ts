import { createTutorAgentRuntime } from './agent-runtime.js';
import {
  TUTOR_AGENT_RUNTIME_VERSION,
  type TutorAgentOutput,
  type TutorAgentScope,
  type TutorDatabaseProjectionMap,
  type TutorDatabaseProjectionName,
} from '@qitu/contracts';


function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Agent runtime assertion failed: ${message}`);
}

function scope(): TutorAgentScope {
  return {
    actorId: 'student-1',
    studentId: 'student-1',
    partnerId: 'qitu-learning-partner',
    projectId: 'project-1',
    sessionId: 'session-1',
    schoolId: 'school-1',
    actorRole: 'student',
  };
}

export async function runAgentRuntimeAssertions(): Promise<void> {
  const seenScopes: TutorAgentScope[] = [];
  const read = {
    knowledge: {
      async search(input: { scope: TutorAgentScope; query: string; limit: number }) {
        seenScopes.push(input.scope);
        return [];
      },
    },
    templates: {
      async listPublished(input: { scope: TutorAgentScope; capability: 'teach' }) {
        seenScopes.push(input.scope);
        return [];
      },
    },
    database: {
      async readProjection<K extends TutorDatabaseProjectionName>(input: { scope: TutorAgentScope; projection: K }) {
        seenScopes.push(input.scope);
        return null as TutorDatabaseProjectionMap[K];
      },
    },
  };
  const tools = {
    list: () => [],
  };
  const runtime = createTutorAgentRuntime(scope(), {
    read,
    tools,
    context: {
      async build(input) {
        return {
          contextId: input.request.requestId,
          runtimeVersion: TUTOR_AGENT_RUNTIME_VERSION,
          builtAt: '2026-01-01T00:00:00.000Z',
          scope: input.scope,
          capability: input.request.capability,
          query: input.request.query,
          projectStage: input.request.projectStage,
          goal: input.request.goal,
          evidenceRefs: input.request.evidenceRefs ?? [],
          data: {},
        };
      },
    },
    executor: {
      async run(input) {
        return {
          id: 'output-1',
          runId: 'run-1',
          requestId: input.requestId,
          kind: 'reply',
          agentId: input.context.scope.partnerId,
          agentVersion: 'partner.v1',
          runtimeVersion: TUTOR_AGENT_RUNTIME_VERSION,
          generatedAt: '2026-01-01T00:00:00.000Z',
          sourceRefs: [],
          toolCalls: [],
          payload: { text: '先说说你已经确认了什么？' },
        } satisfies TutorAgentOutput;
      },
    },
  });

  const context = await runtime.buildContext({
    requestId: 'request-1', capability: 'teach', query: '如何开始', projectStage: 'theory_learning', goal: '理解变量',
  });
  assert(context.scope.studentId === 'student-1', 'context scope must be server-bound');
  await runtime.read.knowledge.search({ query: '变量', limit: 1 });
  await runtime.read.templates.listPublished({ capability: 'teach' });
  await runtime.read.database.readProjection({ projection: 'project_context' });
  assert(seenScopes.every((item) => item.studentId === 'student-1'), 'read ports must not accept a caller scope');

  const output = await runtime.run({
    requestId: 'request-2', idempotencyKey: 'turn-2', capability: 'teach', query: '继续',
    projectStage: 'theory_learning', goal: '理解变量',
  });
  assert(output.agentId === 'qitu-learning-partner', 'output agent must match bound partner');

  let failed = false;
  try {
    await runtime.run({
      requestId: 'request-3', idempotencyKey: '', capability: 'teach', query: '继续',
      projectStage: null, goal: null,
    });
  } catch (error) {
    failed = error instanceof Error && error.message === 'IDEMPOTENCY_KEY_REQUIRED';
  }
  assert(failed, 'empty idempotency keys must be rejected');
}
