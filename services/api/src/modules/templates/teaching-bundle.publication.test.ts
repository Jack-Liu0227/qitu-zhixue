import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPTICS_16_VERSION_INPUT } from './content/optics';
import { opticsTeachingFixture } from './teaching-bundle.test-fixture';
import { freezeTeamAssistant, TEAM_PUBLICATION_SCHEMA } from '../platform-registry/team-version.snapshot';
import { teamVersionContentDigest } from '../platform-registry/team-version.service';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import type { EffectiveAgentRuntime, PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { TeamVersionRecord } from './templates-binding.types';
import type { ProjectTemplateVersionRecord } from './templates.types';

function fixture() {
  const live = opticsTeachingFixture();
  const runtime = (id: string): EffectiveAgentRuntime => ({ agent: { id, label: id, description: '', role: 'coach',
    roleDefinition: id, agentDefinition: 'Published teaching policy', parentAgentId: null, enabled: true, status: 'enabled',
    modelProviderId: 'isolated-provider', modelId: 'isolated-model', modelLabel: 'Model', modelAvailable: true, promptVersion: 'v1',
    capabilities: ['teach'], skillIds: [], toolIds: [], mcpServerIds: [], mcpToolIds: {} }, policy: loadTutorRuntimeSource().policy,
    skills: [], tools: [], mcpServers: [] });
  const team: TeamVersionRecord = { id: 'team-version', teamId: live.teamId, version: 1, name: 'Published team', description: '',
    workspaceMode: 'shared', sessionMode: 'supervised', leaderAssistantId: live.leaderAssistantId,
    members: live.members.map(member => ({ ...member, runtimeSnapshot: freezeTeamAssistant(runtime(member.assistantId)) })),
    pblSpec: { theoryMasteredGate: true, allowAutonomousAdvance: false }, enabled: true, createdBy: 'admin', createdAt: new Date() };
  team.pblSpec.teamVersionPublication = { schemaVersion: TEAM_PUBLICATION_SCHEMA, digest: teamVersionContentDigest(team) };
  const version = { id: 'version', content: OPTICS_16_VERSION_INPUT.content } as ProjectTemplateVersionRecord;
  const draft = { ...live.draft, templateVersionId: version.id, teamVersionId: team.id };
  const registry = (live.catalog as unknown as { registry: PlatformRegistryService }).registry;
  registry.getAssistantRuntime = async id => runtime(id);
  return { live, team, version, draft, registry, runtime };
}

test('bundle compilation consumes the published team prompts despite later live edits', async () => {
  const h = fixture();
  h.registry.getAssistantRuntime = async id => { const value = h.runtime(id); value.agent.agentDefinition = 'Changed live policy'; value.agent.modelId = 'changed-live-model'; return value; };
  const compiled = await h.live.catalog.compile(h.version, h.team, h.draft);
  assert.ok(compiled.payload.roles.every(role => role.instructions.agentDefinition === 'Published teaching policy'));
  assert.ok(compiled.payload.roles.every(role => role.modelByPurpose.dialogue?.modelId === 'isolated-model'));
});

test('published team compilation rejects model replacement, revoked members and incomplete snapshots', async () => {
  const h = fixture();
  const modelByPurpose = structuredClone(h.draft.modelByPurpose);
  const firstRole = Object.keys(modelByPurpose)[0]!;
  const changedDraft = { ...h.draft, modelByPurpose: { ...modelByPurpose, [firstRole]: { dialogue: { modelProviderId: 'isolated-provider', modelId: 'replacement' } } } };
  await assert.rejects(h.live.catalog.compile(h.version, h.team, changedDraft));
  h.registry.getAssistantRuntime = async id => { const value = h.runtime(id); value.agent.enabled = false; return value; };
  await assert.rejects(h.live.catalog.compile(h.version, h.team, h.draft));
  delete (h.team.members[0] as Record<string, unknown>).runtimeSnapshot;
  await assert.rejects(h.live.catalog.compile(h.version, h.team, h.draft));
});
