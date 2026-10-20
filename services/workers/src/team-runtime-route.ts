import { agentRoutes, type Database } from '@qitu/database';
import { and, eq } from 'drizzle-orm';
import type { TeamMailboxJob } from './team-runtime-mailbox-source';

export class TeamAgentExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'TeamAgentExecutionError';
    this.code = code;
  }
}

export interface TeamTaskAuthorization {
  routeId: string;
  trigger: 'event' | 'delegate';
  fromAgentId: string;
  toAgentId: string;
  taskType: string;
}

/** Only enqueue owners construct this metadata; message/model payloads cannot grant a route. */
export function teamTaskAuthorization(
  routeId: string,
  trigger: TeamTaskAuthorization['trigger'],
  fromAgentId: string,
  toAgentId: string,
  taskType: string,
): TeamTaskAuthorization {
  return { routeId, trigger, fromAgentId, toAgentId, taskType };
}

export async function resolveAuthorizedTeamRoute(db: Database, job: TeamMailboxJob) {
  const { task, message } = job;
  if (!task) throw new TeamAgentExecutionError('TEAM_TASK_NOT_FOUND');
  if (task.id !== message.taskId || task.runId !== message.runId
    || task.agentId !== message.recipientAgentId || message.mailboxAgentId !== message.recipientAgentId) {
    throw new TeamAgentExecutionError('TEAM_TASK_SCOPE_INVALID');
  }
  const raw = task.input.authorization;
  let authorization: TeamTaskAuthorization | null = null;
  if (raw !== undefined) {
    if (!isAuthorization(raw)) throw new TeamAgentExecutionError('TEAM_TASK_AUTHORIZATION_INVALID');
    authorization = raw;
    if (raw.fromAgentId !== message.senderAgentId || raw.toAgentId !== message.recipientAgentId
      || raw.taskType !== task.taskType) throw new TeamAgentExecutionError('TEAM_TASK_AUTHORIZATION_INVALID');
  }
  const trigger = authorization?.trigger ?? 'delegate';
  const permittedMessage = trigger === 'event'
    ? message.messageType === 'projection.request' && authorization !== null
    : ['task.request', 'delegate.request'].includes(message.messageType);
  if (!permittedMessage) throw new TeamAgentExecutionError('TEAM_TASK_AUTHORIZATION_INVALID');
  const [route] = await db.select().from(agentRoutes).where(and(
    ...(authorization ? [eq(agentRoutes.id, authorization.routeId)] : []),
    eq(agentRoutes.fromAgentId, message.senderAgentId),
    eq(agentRoutes.toAgentId, message.recipientAgentId),
    eq(agentRoutes.trigger, trigger),
    eq(agentRoutes.taskType, task.taskType),
    eq(agentRoutes.enabled, true),
  )).limit(1);
  if (!route || !route.enabled || route.fromAgentId !== message.senderAgentId
    || route.toAgentId !== message.recipientAgentId || route.trigger !== trigger
    || route.taskType !== task.taskType || (authorization && route.id !== authorization.routeId)) {
    throw new TeamAgentExecutionError('TEAM_AGENT_ROUTE_NOT_FOUND');
  }
  return route;
}

function isAuthorization(value: unknown): value is TeamTaskAuthorization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['event', 'delegate'].includes(String(item.trigger))
    && ['routeId', 'fromAgentId', 'toAgentId', 'taskType'].every((key) =>
      typeof item[key] === 'string' && item[key].length > 0 && item[key].length <= 180);
}
