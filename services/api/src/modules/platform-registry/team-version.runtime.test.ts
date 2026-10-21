import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentConfigs,
  agentMcpBindings,
  agentRoutes,
  agentSkillBindings,
  agentToolBindings,
} from '@qitu/database';
import { PBL_PLAN_OUTPUT_SCHEMA, type CurrentUser } from '@qitu/contracts';
import { builtinToolRegistry } from './built-in-tools';
import type { EffectiveAgentRuntime } from './platform-registry.service';
import { freezeTeamAssistant } from './team-version.snapshot';
import {
  projectPublishedTeamRuntime,
  type PublishedRuntimeMember,
} from './team-version.runtime';

const admin: CurrentUser = {
  id: 'admin-runtime-test',
  role: 'admin',
  displayName: 'Admin',
  email: 'admin@example.invalid',
};

function runtime(id: string): EffectiveAgentRuntime {
  return {
    agent: {
      id,
      label: id,
      description: '',
      role: 'coach',
      roleDefinition: `Role ${id}`,
      agentDefinition: `Definition ${id}`,
      parentAgentId: null,
      enabled: true,
      status: 'enabled',
      modelProviderId: 'provider',
      modelId: 'model',
      modelLabel: 'Model',
      modelAvailable: true,
      promptVersion: 'v1',
      capabilities: ['teach'],
      skillIds: ['published-skill'],
      toolIds: ['tutor.context_packet'],
      mcpServerIds: [],
      mcpToolIds: {},
    },
    policy: {
      id: 'AGENTS.md',
      version: 'policy-v1',
      contentHash: 'a'.repeat(64),
      status: 'ready',
      content: 'Policy',
    },
    skills: [{
      id: 'published-skill',
      label: 'Skill',
      description: '',
      version: '1.0.0',
      contentHash: 'b'.repeat(64),
      status: 'ready',
      content: 'Teach',
      runtime: 'teaching',
      publicationStatus: 'published',
    }],
    tools: builtinToolRegistry.listForAgentIds(['tutor.context_packet']),
    mcpServers: [],
  };
}

function fixture() {
  const rows = new Map<unknown, unknown[]>([
    [agentConfigs, []],
    [agentSkillBindings, []],
    [agentToolBindings, []],
    [agentMcpBindings, []],
    [agentRoutes, []],
  ]);
  const chain = (table: unknown) => ({
    where: () => chain(table),
    limit: () => chain(table),
    then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(rows.get(table) ?? []).then(resolve, reject),
  });
  const tx = {
    select: () => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: async (row: unknown) => {
        const current = rows.get(table) ?? [];
        current.push(structuredClone(row));
        rows.set(table, current);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          const current = rows.get(table) ?? [];
          if (current[0]) Object.assign(current[0], patch);
        },
      }),
    }),
  };
  return { tx, rows };
}

function members(): PublishedRuntimeMember[] {
  return [
    {
      assistantId: 'team-leader',
      displayName: 'Leader',
      role: 'leader',
      roleLabel: 'Leader',
      snapshot: freezeTeamAssistant(runtime('team-leader')),
      live: runtime('team-leader'),
    },
    {
      assistantId: 'lesson-coach',
      displayName: 'Lesson coach',
      role: 'coach',
      roleLabel: 'Coach',
      snapshot: freezeTeamAssistant(runtime('lesson-coach')),
      live: runtime('lesson-coach'),
    },
  ];
}

test('published team projection creates the exact leader-to-lesson-member delegation route idempotently', async () => {
  const h = fixture();
  const version = {
    id: 'team-version-1',
    teamId: 'team-1',
    leaderAssistantId: 'team-leader',
    members: members().map((member) => ({ assistantId: member.assistantId })),
  };

  await projectPublishedTeamRuntime(h.tx as never, version, members(), admin);
  await projectPublishedTeamRuntime(h.tx as never, version, members(), admin);

  const routes = (h.rows.get(agentRoutes) ?? []) as Array<Record<string, unknown>>;
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.fromAgentId, 'team-leader');
  assert.equal(routes[0]?.toAgentId, 'lesson-coach');
  assert.equal(routes[0]?.trigger, 'delegate');
  assert.equal(routes[0]?.taskType, 'pbl.plan');
  assert.equal(routes[0]?.enabled, true);
  assert.deepEqual(routes[0]?.outputSchema, PBL_PLAN_OUTPUT_SCHEMA);
});
