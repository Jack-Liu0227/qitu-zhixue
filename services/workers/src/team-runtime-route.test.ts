import assert from 'node:assert/strict';
import test from 'node:test';
import { type Database } from '@qitu/database';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TeamMailboxJob } from './team-runtime-mailbox-source';
import { resolveAuthorizedTeamRoute, teamTaskAuthorization } from './team-runtime-route';

const route = {
  id: 'route-event', trigger: 'event', fromAgentId: 'leader', toAgentId: 'profile',
  taskType: 'profile.project', enabled: true, outputSchema: { type: 'object' },
};

function job(): TeamMailboxJob {
  return {
    message: {
      taskId: 'task', runId: 'run', mailboxAgentId: 'profile', senderAgentId: 'leader',
      recipientAgentId: 'profile', messageType: 'projection.request', payload: {},
    },
    task: {
      id: 'task', runId: 'run', agentId: 'profile', taskType: 'profile.project',
      input: { authorization: teamTaskAuthorization(route.id, 'event', 'leader', 'profile', 'profile.project') },
    },
  } as unknown as TeamMailboxJob;
}

function database(value: unknown, inspect?: (query: SQL) => void): Database {
  return { select: () => ({ from: () => ({ where: (query: SQL) => {
    inspect?.(query);
    return { limit: async () => value ? [value] : [] };
  } }) }) } as unknown as Database;
}

test('event task uses its persisted exact route, including event trigger, at execution', async () => {
  const result = await resolveAuthorizedTeamRoute(database(route, (query) => {
    const compiled = new PgDialect().sqlToQuery(query);
    assert.deepEqual(compiled.params, ['route-event', 'leader', 'profile', 'event', 'profile.project', true]);
  }), job());
  assert.equal(result.id, 'route-event');
});

test('route removal, disablement and all route identity changes revoke queued tasks', async () => {
  for (const changed of [null, { enabled: false }, { id: 'replacement-route' }, { trigger: 'delegate' },
    { fromAgentId: 'other' }, { toAgentId: 'other' }, { taskType: 'growth.project' }]) {
    await assert.rejects(resolveAuthorizedTeamRoute(database(changed && { ...route, ...changed }), job()), /TEAM_AGENT_ROUTE_NOT_FOUND/);
  }
});

test('task metadata is bound to recipient, sender, task type, message kind and task/run scope', async () => {
  for (const changed of [{ fromAgentId: 'other' }, { toAgentId: 'other' }, { taskType: 'other' }, { trigger: 'delegate' }, { routeId: '' }]) {
    const input = job();
    input.task!.input.authorization = { ...(input.task!.input.authorization as object), ...changed };
    await assert.rejects(resolveAuthorizedTeamRoute(database(route), input), /TEAM_TASK_AUTHORIZATION_INVALID/);
  }
  for (const changed of [{ taskId: 'other' }, { runId: 'other' }, { mailboxAgentId: 'other' }]) {
    const input = job();
    Object.assign(input.message, changed);
    await assert.rejects(resolveAuthorizedTeamRoute(database(route), input), /TEAM_TASK_SCOPE_INVALID/);
  }
});

test('message payload cannot introduce authorization absent from the persisted task', async () => {
  const input = job();
  input.message.payload = input.task!.input;
  input.task!.input = {};
  await assert.rejects(resolveAuthorizedTeamRoute(database(route), input), /TEAM_TASK_AUTHORIZATION_INVALID/);
});

test('legacy delegate tasks remain supported and cannot select an event route', async () => {
  const input = job();
  input.task!.input = {};
  input.message.messageType = 'task.request';
  const delegate = { ...route, trigger: 'delegate' };
  assert.equal((await resolveAuthorizedTeamRoute(database(delegate), input)).trigger, 'delegate');
  await assert.rejects(resolveAuthorizedTeamRoute(database(route), input), /TEAM_AGENT_ROUTE_NOT_FOUND/);
  input.message.messageType = 'projection.request';
  await assert.rejects(resolveAuthorizedTeamRoute(database(delegate), input), /TEAM_TASK_AUTHORIZATION_INVALID/);
});
