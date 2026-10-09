import type {
  AdminRuntimeAgent,
  AdminRuntimeSnapshot,
  AdminTeamConfig,
  AdminTeamCreateInput,
  AdminTeamUpdateInput,
} from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, adminEnvelopeRequest, type DataEnvelope } from './types';
import { newIdempotencyKey } from './modelRegistry';
import { fetchRuntimeSnapshot } from './runtime';

export interface AgentGraphEdge {
  id: string;
  source: string;
  target: string;
  trigger: string;
  taskType: string;
  enabled: boolean;
}

export interface AgentGraphData {
  generatedAt: string;
  nodes: Array<AdminRuntimeAgent & { role: string | null }>;
  edges: AgentGraphEdge[];
}

export interface TeamRuntimeSnapshot {
  runtime: AdminRuntimeSnapshot;
  graph: AgentGraphData;
  routes: AgentGraphEdge[];
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include' });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  if (!response.ok) throw new Error(`协作运行时请求失败（HTTP ${response.status}）`);
  const payload = await response.json() as DataEnvelope<T>;
  return payload.data;
}

export async function fetchAdminTeams(): Promise<TeamRuntimeSnapshot> {
  const [runtime, graph, rawRoutes] = await Promise.all([
    fetchRuntimeSnapshot(),
    get<AgentGraphData>('/api/v1/admin/agent-graph'),
    get<Array<AgentGraphEdge & { fromAgentId?: string; toAgentId?: string }>>('/api/v1/admin/ai-runtime/routes'),
  ]);
  const runtimeById = new Map(runtime.agents.map((agent) => [agent.id, agent]));
  const routes = rawRoutes.map((route) => ({
    id: route.id,
    source: route.source ?? route.fromAgentId ?? '',
    target: route.target ?? route.toAgentId ?? '',
    trigger: route.trigger,
    taskType: route.taskType,
    enabled: route.enabled,
  }));
  return {
    runtime,
    graph: {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...runtimeById.get(node.id), ...node })),
    },
    routes,
  };
}

const ADMIN_TEAMS_PATH = '/api/v1/admin/ai-runtime/teams';
const ADMIN_TEAM_ITEM_PATH = (id: string) => `${ADMIN_TEAMS_PATH}/${encodeURIComponent(id)}`;

/** Persisted team CRUD used by the SDK-compatible settings surfaces. */
export function fetchAdminTeamConfigs(): Promise<AdminTeamConfig[]> {
  return adminEnvelopeRequest<AdminTeamConfig[]>({ path: ADMIN_TEAMS_PATH, method: 'GET' });
}

export function createPersistedTeam(
  input: AdminTeamCreateInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<AdminTeamConfig> {
  return adminEnvelopeRequest<AdminTeamConfig>({
    path: ADMIN_TEAMS_PATH,
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export function updatePersistedTeam(
  id: string,
  patch: AdminTeamUpdateInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<AdminTeamConfig> {
  return adminEnvelopeRequest<AdminTeamConfig>({
    path: ADMIN_TEAM_ITEM_PATH(id),
    method: 'PATCH',
    body: patch,
    idempotencyKey,
  });
}

export async function updateAgentRoute(
  routeId: string,
  patch: Partial<Pick<AgentGraphEdge, 'enabled' | 'taskType' | 'trigger'>>,
  idempotencyKey = newIdempotencyKey(),
): Promise<AgentGraphEdge> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/ai-runtime/routes/${encodeURIComponent(routeId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  const payload = await response.json().catch(() => null) as DataEnvelope<AgentGraphEdge & { fromAgentId?: string; toAgentId?: string }> & { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? `路由更新失败（HTTP ${response.status}）`);
  if (!payload?.data) throw new Error('服务端未返回路由配置');
  return {
    id: payload.data.id,
    source: payload.data.source ?? payload.data.fromAgentId ?? '',
    target: payload.data.target ?? payload.data.toAgentId ?? '',
    trigger: payload.data.trigger,
    taskType: payload.data.taskType,
    enabled: payload.data.enabled,
  };
}

export async function startTeamRun(leaderAgentId: string): Promise<{ id: string; leaderAgentId: string; status: string }> {
  const key = newIdempotencyKey();
  let response: Response;
  try {
    response = await fetch('/api/v1/tutor/team-runs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ leaderAgentId, trigger: 'admin.team.test', context: { source: 'admin-console' } }),
    });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  const payload = await response.json().catch(() => null) as DataEnvelope<{ id: string; leaderAgentId: string; status: string }> & { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? `Team Run 创建失败（HTTP ${response.status}）`);
  if (!payload?.data) throw new Error('服务端未返回 Team Run');
  return payload.data;
}

export async function delegateTeamTask(input: {
  runId: string;
  senderAgentId: string;
  recipientAgentId: string;
  taskType: string;
}): Promise<{ id: string; status: string; taskType: string }> {
  const key = newIdempotencyKey();
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/agent-runs/${encodeURIComponent(input.runId)}/delegate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        senderAgentId: input.senderAgentId,
        recipientAgentId: input.recipientAgentId,
        taskType: input.taskType,
        input: { source: 'admin-console', test: true },
      }),
    });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  const payload = await response.json().catch(() => null) as DataEnvelope<{ id: string; status: string; taskType: string }> & { message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? `Agent 委派失败（HTTP ${response.status}）`);
  if (!payload?.data) throw new Error('服务端未返回 Team Task');
  return payload.data;
}

export async function fetchTeamRun(runId: string): Promise<unknown> {
  return get(`/api/v1/admin/agent-graphs/${encodeURIComponent(runId)}`);
}
