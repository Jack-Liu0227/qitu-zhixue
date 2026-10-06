import type {
  TeamActivityItem,
  TeamEdgeKind,
  TeamGraphEdge,
  TeamGraphNode,
  TeamRunNode,
} from '@qitu/ui';

export interface AdminStaticAgentGraphProjection {
  generatedAt: string;
  nodes: TeamGraphNode[];
  edges: TeamGraphEdge[];
}

export interface AdminAgentRoute {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  trigger: 'delegate' | 'event' | 'schedule';
  taskType: string;
  enabled: boolean;
}

/** Browser projection for the optional Team Runtime run endpoint. */
export interface AdminAgentRunProjection {
  runId: string;
  status: TeamRunNode['status'];
  nodes: TeamRunNode[];
  activity: TeamActivityItem[];
  generatedAt: string | null;
}

export class AgentRunUnavailableError extends Error {
  constructor() {
    super('Agent 执行图接口尚未在该环境启用');
    this.name = 'AgentRunUnavailableError';
  }
}

export class AgentRunPermissionError extends Error {
  constructor() {
    super('你没有查看 Agent 执行记录的权限');
    this.name = 'AgentRunPermissionError';
  }
}

export class AgentRunOfflineError extends Error {
  constructor() {
    super('当前网络不可用，无法加载 Agent 执行记录');
    this.name = 'AgentRunOfflineError';
  }
}

/**
 * The endpoint is server-owned. A missing endpoint is surfaced as an
 * unavailable state; no fixture is returned because a fabricated graph would
 * be misleading to operators.
 */
export async function fetchStaticAgentGraph(): Promise<AdminStaticAgentGraphProjection> {
  const value = await fetchJson('/api/v1/admin/agent-graph');
  if (!isStaticGraph(value)) throw new Error('Agent 拓扑数据格式不正确');
  return normalizeStaticGraph(value);
}

export async function fetchAgentRoutes(): Promise<AdminAgentRoute[]> {
  const value = await fetchJson('/api/v1/admin/ai-runtime/routes');
  if (!Array.isArray(value)) throw new Error('Agent 路由数据格式不正确');
  return value.filter(isAgentRoute);
}

export async function createAgentRoute(input: Omit<AdminAgentRoute, 'id'>): Promise<AdminAgentRoute> {
  return mutateRoute('/api/v1/admin/ai-runtime/routes', 'POST', input);
}

export async function updateAgentRoute(routeId: string, input: Pick<AdminAgentRoute, 'enabled'>): Promise<AdminAgentRoute> {
  return mutateRoute(`/api/v1/admin/ai-runtime/routes/${encodeURIComponent(routeId)}`, 'PATCH', input);
}

async function mutateRoute(path: string, method: 'POST' | 'PATCH', input: unknown): Promise<AdminAgentRoute> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AgentRunOfflineError();
  }
  if (response.status === 404) throw new AgentRunUnavailableError();
  if (response.status === 401 || response.status === 403) throw new AgentRunPermissionError();
  if (!response.ok) throw new Error(`Agent 路由保存失败（${response.status}）`);
  const value = unwrapData(await response.json());
  if (!isAgentRoute(value)) throw new Error('Agent 路由返回数据格式不正确');
  return value;
}

export async function fetchAgentRunGraph(runId: string): Promise<AdminAgentRunProjection | null> {
  const value = await fetchJson(`/api/v1/admin/agent-graphs/${encodeURIComponent(runId)}`);
  if (value === null) return null;
  if (!isRunGraph(value)) throw new Error('Agent 执行图数据格式不正确');
  return normalizeRunGraph(value);
}

export async function startAgentTestRun(leaderAgentId: string): Promise<string> {
  let response: Response;
  const idempotencyKey = crypto.randomUUID();
  try {
    response = await fetch('/api/v1/tutor/team-runs', {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ leaderAgentId, trigger: 'admin.test-run', idempotencyKey }),
    });
  } catch {
    throw new AgentRunOfflineError();
  }
  if (response.status === 404) throw new AgentRunUnavailableError();
  if (response.status === 401 || response.status === 403) throw new AgentRunPermissionError();
  if (!response.ok) throw new Error(`测试 Run 创建失败（${response.status}）`);
  const value = unwrapData(await response.json());
  if (typeof value !== 'object' || value === null || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('测试 Run 返回数据格式不正确');
  }
  return (value as { id: string }).id;
}

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new AgentRunOfflineError();
  }
  if (response.status === 404) throw new AgentRunUnavailableError();
  if (response.status === 401 || response.status === 403) throw new AgentRunPermissionError();
  if (!response.ok) throw new Error(`执行图加载失败（${response.status}）`);

  const body: unknown = await response.json();
  return unwrapData(body);
}

function unwrapData(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'data' in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

function isStaticGraph(value: unknown): value is { generatedAt: string; nodes: unknown[]; edges: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { generatedAt?: unknown; nodes?: unknown; edges?: unknown };
  return typeof candidate.generatedAt === 'string' && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}

function isRunGraph(value: unknown): value is { run: unknown; tasks: unknown[]; messages: unknown[]; events: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { run?: unknown; tasks?: unknown; messages?: unknown; events?: unknown };
  return typeof candidate.run === 'object' && candidate.run !== null
    && Array.isArray(candidate.tasks) && Array.isArray(candidate.messages) && Array.isArray(candidate.events);
}

function normalizeStaticGraph(value: { generatedAt: string; nodes: unknown[]; edges: unknown[] }): AdminStaticAgentGraphProjection {
  const rawNodes = value.nodes.filter(isRawGraphNode);
  const root = rawNodes.find((node) => node.isLeader || node.id === 'qitu-learning-partner') ?? rawNodes.find((node) => node.parentAgentId === null);
  return {
    generatedAt: value.generatedAt,
    nodes: rawNodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.id === root?.id ? 'leader' : 'teammate',
      status: node.enabled ? normalizeNodeStatus(node.status) : 'disabled',
      description: node.roleDefinition,
      modelLabel: node.modelLabel ?? node.modelId,
      capabilities: Array.isArray(node.capabilities) ? node.capabilities.filter((item): item is string => typeof item === 'string') : [],
      meta: node.parentAgentId ? `上级：${node.parentAgentId}` : undefined,
    })),
    edges: value.edges.filter(isRawGraphEdge).map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      kind: normalizeEdgeKind(edge.trigger),
      label: edge.taskType ?? edge.trigger,
    })),
  };
}

function normalizeRunGraph(value: { run: unknown; tasks: unknown[]; messages: unknown[]; events: unknown[] }): AdminAgentRunProjection {
  const run = value.run as { id?: unknown; status?: unknown; createdAt?: unknown; updatedAt?: unknown };
  const tasks = value.tasks.filter(isRawTask);
  const activity: TeamActivityItem[] = [
    ...value.messages.filter(isRawMessage).map((message) => ({
      id: message.id,
      timestamp: message.createdAt,
      actorId: message.senderAgentId,
      actorLabel: message.senderAgentId,
      type: message.messageType,
      status: normalizeRunStatus(message.status),
      summary: `消息${message.status}`,
      detail: null,
    })),
    ...value.events.filter(isRawEvent).map((event) => ({
      id: event.id,
      timestamp: event.occurredAt,
      actorId: event.topic,
      actorLabel: event.topic,
      type: 'event',
      summary: '事件已记录',
      detail: null,
    })),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return {
    runId: typeof run.id === 'string' ? run.id : 'unknown',
    status: normalizeRunStatus(run.status),
    generatedAt: typeof run.updatedAt === 'string' ? run.updatedAt : typeof run.createdAt === 'string' ? run.createdAt : null,
    nodes: tasks.map((task) => ({
      id: task.id,
      agentId: task.agentId,
      label: task.taskType,
      status: normalizeRunStatus(task.status),
      summary: task.errorCode ? `错误：${task.errorCode}` : null,
      startedAt: task.startedAt,
      finishedAt: task.completedAt,
      durationMs: task.startedAt && task.completedAt ? Math.max(0, new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) : null,
    })),
    activity,
  };
}

interface RawGraphNode {
  id: string;
  label: string;
  parentAgentId: string | null;
  enabled: boolean;
  isLeader?: boolean;
  status?: string;
  roleDefinition?: string | null;
  modelId?: string | null;
  modelLabel?: string | null;
  capabilities?: unknown;
}

interface RawGraphEdge { id: string; source: string; target: string; trigger?: string; taskType?: string | null; }
interface RawTask { id: string; agentId: string; taskType: string; status: string; errorCode: string | null; startedAt: string | null; completedAt: string | null; }
interface RawMessage { id: string; senderAgentId: string; messageType: string; status: string; createdAt: string; }
interface RawEvent { id: string; topic: string; occurredAt: string; }

function isRawGraphNode(value: unknown): value is RawGraphNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Partial<RawGraphNode>;
  return typeof node.id === 'string' && typeof node.label === 'string' && (node.parentAgentId === null || typeof node.parentAgentId === 'string') && typeof node.enabled === 'boolean';
}

function isRawGraphEdge(value: unknown): value is RawGraphEdge {
  if (typeof value !== 'object' || value === null) return false;
  const edge = value as Partial<RawGraphEdge>;
  return typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string';
}

function isRawTask(value: unknown): value is RawTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Partial<RawTask>;
  return typeof task.id === 'string' && typeof task.agentId === 'string' && typeof task.taskType === 'string' && typeof task.status === 'string';
}

function isRawMessage(value: unknown): value is RawMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RawMessage>;
  return typeof message.id === 'string' && typeof message.senderAgentId === 'string' && typeof message.messageType === 'string' && typeof message.status === 'string' && typeof message.createdAt === 'string';
}

function isRawEvent(value: unknown): value is RawEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<RawEvent>;
  return typeof event.id === 'string' && typeof event.topic === 'string' && typeof event.occurredAt === 'string';
}

function isAgentRoute(value: unknown): value is AdminAgentRoute {
  if (typeof value !== 'object' || value === null) return false;
  const route = value as Partial<AdminAgentRoute>;
  return typeof route.id === 'string'
    && typeof route.fromAgentId === 'string'
    && typeof route.toAgentId === 'string'
    && (route.trigger === 'delegate' || route.trigger === 'event' || route.trigger === 'schedule')
    && typeof route.taskType === 'string'
    && typeof route.enabled === 'boolean';
}

function normalizeNodeStatus(status: string | undefined): TeamGraphNode['status'] {
  if (status === 'enabled' || status === 'ready') return 'ready';
  if (status === 'error') return 'failed';
  if (status === 'disabled') return 'disabled';
  return 'unknown';
}

function normalizeEdgeKind(value: string | undefined): TeamEdgeKind {
  if (value === 'event') return 'event';
  if (value === 'schedule') return 'message';
  return 'delegate';
}

function normalizeRunStatus(value: unknown): TeamRunNode['status'] {
  if (value === 'running' || value === 'processing') return 'running';
  if (value === 'queued' || value === 'created' || value === 'waiting' || value === 'retry_waiting') return 'queued';
  if (value === 'succeeded' || value === 'completed' || value === 'delivered') return 'succeeded';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'failed' || value === 'dead_letter' || value === 'timed_out') return 'failed';
  return 'unknown';
}
