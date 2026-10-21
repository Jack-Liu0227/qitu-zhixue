import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CurrentUser } from '@qitu/contracts';
import { OPTICS_16_VERSION_INPUT } from '../templates/content/optics';
import { actor, makeGovernanceHarness, VALID_CREATE_INPUT } from '../templates/templates.test-support';
import { CopilotLifecycle } from './copilot.lifecycle';
import { CopilotResources } from './copilot.resources';
import { KnowledgeLibraryService } from '../knowledge/knowledge-library.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { adminAssistants, adminTeamMembers, adminTeams, adminTeamVersions, agentConfigs, agentSkillBindings, agentToolBindings, agentMcpBindings, runtimeMcpServers } from '@qitu/database';

const admin = actor('admin', 'lifecycle-admin');
function fixture() {
  const teaching = makeGovernanceHarness();
  let modelCalls = 0; let probeOk = true; let imaCalls = 0;
  const runtime = { agent: { id: 'coach', enabled: true, modelAvailable: true, modelProviderId: 'provider', modelId: 'model',
    promptVersion: 'v1', skillIds: [], toolIds: [], mcpServerIds: [] }, skills: [], tools: [], mcpServers: [], policy: { status: 'ready', contentHash: 'policy' } };
  const registry = { getAssistantRuntime: async () => runtime, listAssistants: async () => [], listTeams: async () => [] };
  const models = { listAgentModelOptions: () => [{ providerId: 'provider', modelId: 'model', available: true }],
    listProviders: () => ({ providers: [{ id: 'provider', baseUrl: 'https://fixture.invalid', api: 'openai-completions' }] }),
    testModel: async () => { modelCalls++; return { ok: probeOk }; } };
  const resources = new CopilotResources(null, teaching.audit as never);
  const ima = { probe: async () => { imaCalls++; return { status: 'connected' }; } };
  const service = new CopilotLifecycle(registry as never, teaching.service, {} as never, models as never, resources, ima as never);
  return { service, teaching, resources, runtime, registry, models, ima, modelCalls: () => modelCalls, imaCalls: () => imaCalls,
    probeOk(value: boolean) { probeOk = value; } };
}

test('actual 16-session template can be created and inspected; missing learning evidence blocks verify/publish; archive preserves content', async () => {
  const f = fixture();
  const created = await f.teaching.service.createTemplate(admin, VALID_CREATE_INPUT, 'create');
  const version = await f.teaching.service.createVersion(admin, created.template.id, OPTICS_16_VERSION_INPUT, 'version');
  const input = { templateId: created.template.id, versionId: version.version.id };
  const tested = await f.service.execute(admin, 'template.test', input, 'test');
  const check = await f.service.readback(admin, 'template.test', tested);
  assert.ok(JSON.stringify(check).includes('16'));
  const verified = await f.service.execute(admin, 'template.verify', input, 'verify');
  await assert.rejects(f.service.readback(admin, 'template.verify', verified), /检查未通过/);
  await assert.rejects(f.service.execute(admin, 'template.publish', input, 'publish'));
  assert.equal((await f.teaching.store.findVersion(version.version.id))?.status, 'draft');
  const archived = await f.service.execute(admin, 'template.archive', { templateId: created.template.id, reason: 'Fixture retirement' }, 'archive');
  await f.service.readback(admin, 'template.archive', archived);
  assert.deepEqual((await f.teaching.store.findVersion(version.version.id))?.content, OPTICS_16_VERSION_INPUT.content);
  await assert.rejects(f.service.execute(admin, 'template.delete', { templateId: created.template.id }, 'delete'), /归档/);
});

test('unused draft deletion reads absence and is distinct from archiving a published source', async () => {
  const f = fixture();
  const created = await f.teaching.service.createTemplate(admin, VALID_CREATE_INPUT, 'draft');
  const receipt = await f.service.execute(admin, 'template.delete', { templateId: created.template.id }, 'delete');
  await f.service.readback(admin, 'template.delete', receipt);
  await f.service.readback(admin, 'template.delete', receipt);
  assert.equal(await f.teaching.store.findTemplate(created.template.id), null);
});

test('template owner retains its source if the deletion audit is unavailable', async () => {
  const f = fixture();
  const created = await f.teaching.service.createTemplate(admin, VALID_CREATE_INPUT, 'draft');
  f.teaching.audit.write = async () => { throw new Error('Synthetic audit unavailable'); };
  await assert.rejects(f.service.execute(admin, 'template.delete', { templateId: created.template.id }, 'delete'));
  assert.ok(await f.teaching.store.findTemplate(created.template.id));
});

test('real managed Skill lifecycle distinguishes draft readiness, publication, removal and retained source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-skill-lifecycle-'));
  const previous = process.env.QITU_PROJECT_ROOT; process.env.QITU_PROJECT_ROOT = root;
  mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
  try {
    const f = fixture();
    const draft = await f.resources.createSkill(admin, { id: 'fixture-inquiry', description: 'Synthetic skill', version: '1.0.0', content: 'Use bounded synthetic observations and preserve server gates.' }, 'draft');
    const inspectDraft = await f.service.execute(admin, 'skill.test', { id: draft.id }, 'draft-test');
    await assert.rejects(f.service.readback(admin, 'skill.test', inspectDraft), /检查未通过/);
    const published = await f.resources.publishSkill(admin, { id: draft.id, digest: draft.digest }, 'publish');
    await f.service.readback(admin, 'skill.test', await f.service.execute(admin, 'skill.test', { id: draft.id }, 'published-test'));
    const source = join(root, '.agents', 'skills', draft.id, 'SKILL.md');
    const before = readFileSync(source, 'utf8').split('\n---\n')[1];
    await assert.rejects(f.service.execute(admin, 'skill.delete', { id: draft.id, digest: '0'.repeat(64) }, 'bad'));
    const removed = await f.service.execute(admin, 'skill.delete', { id: draft.id, digest: published.digest }, 'remove');
    await f.service.readback(admin, 'skill.delete', removed);
    assert.equal(readFileSync(source, 'utf8').split('\n---\n')[1], before);
    assert.equal((await f.resources.readSkill(admin, draft.id)).status, 'deprecated');
    await f.service.execute(admin, 'skill.delete', { id: draft.id, digest: published.digest }, 'repeat');
    await assert.rejects(f.service.readback(admin, 'skill.test', await f.service.execute(admin, 'skill.test', { id: draft.id }, 'removed-test')));
    await assert.rejects(f.service.execute({ ...admin, role: 'student' }, 'skill.delete', { id: draft.id, digest: published.digest }, 'denied'));
  } finally {
    if (previous === undefined) delete process.env.QITU_PROJECT_ROOT; else process.env.QITU_PROJECT_ROOT = previous;
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true });
  }
});

test('configuration checks do not make network calls; real model probe fails truthfully and source edits invalidate a receipt', async () => {
  const f = fixture();
  await f.service.readback(admin, 'assistant.test', await f.service.execute(admin, 'assistant.test', { id: 'coach', mode: 'configuration' }, 'config'));
  assert.equal(f.modelCalls(), 0);
  f.probeOk(false);
  const negative = await f.service.execute(admin, 'assistant.test', { id: 'coach', mode: 'model_connection' }, 'network');
  await assert.rejects(f.service.readback(admin, 'assistant.test', negative), /检查未通过/);
  assert.equal(f.modelCalls(), 1);
  f.probeOk(true);
  const ready = await f.service.execute(admin, 'assistant.test', { id: 'coach', mode: 'model_connection' }, 'ready');
  f.runtime.agent.promptVersion = 'v2';
  await assert.rejects(f.service.readback(admin, 'assistant.test', ready), /依据已变化/);
});

test('custom MCP registration is not a connection; IMA uses its actual probe owner', async () => {
  const f = fixture();
  f.resources.readMcp = async id => ({ id, enabled: false, status: 'not_configured', label: 'Fixture', endpointOrigin: 'https://fixture.invalid', toolIds: [] });
  const config = await f.service.execute(admin, 'mcp.test', { id: 'custom', mode: 'configuration' }, 'config');
  await f.service.readback(admin, 'mcp.test', config);
  const connection = await f.service.execute(admin, 'mcp.test', { id: 'custom', mode: 'connection' }, 'connect');
  await assert.rejects(f.service.readback(admin, 'mcp.test', connection));
  assert.equal(f.imaCalls(), 0);
  await f.service.readback(admin, 'mcp.test', await f.service.execute(admin, 'mcp.test', { id: 'ima-knowledge', mode: 'connection' }, 'ima'));
  assert.equal(f.imaCalls(), 1);
});

function deletionDatabase() {
  const now = new Date('2026-10-21T00:00:00.000Z');
  const tables = new Map<unknown, unknown[]>([
    [adminAssistants, [{ id: 'coach', name: 'Coach', source: 'user', role: 'coach', updatedAt: now }]],
    [adminTeams, [{ id: 'team', name: 'Team', leaderAssistantId: 'coach', updatedAt: now }]],
    [runtimeMcpServers, [{ id: 'custom', enabled: false, secretRef: null }]],
  ]);
  const removed: unknown[] = [];
  let purposeInUse = false;
  const db = {
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
    execute: async () => ({ rows: [{ used: purposeInUse }] }),
    select: () => ({ from(table: unknown) {
      const chain = { where: () => chain, for: async () => tables.get(table) ?? [], limit: async () => tables.get(table) ?? [],
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(tables.get(table) ?? []).then(resolve) };
      return chain;
    } }),
    delete: (table: unknown) => ({ where: async () => { removed.push(table); tables.set(table, []); } }),
  };
  return { db, tables, removed, now, purposeInUse(value: boolean) { purposeInUse = value; } };
}

test('assistant deletion never reassigns leaders or removes a team; stale revision and frozen references block it', async () => {
  const f = deletionDatabase();
  const service = new PlatformRegistryService(f.db as never, 'live', { write: async () => 'audit' } as never, {} as never);
  await assert.rejects(service.deleteAssistant(admin, 'coach', 'stale'));
  assert.equal(f.removed.length, 0);
  await assert.rejects(service.deleteAssistant(admin, 'coach', f.now.toISOString()), /仍被团队/);
  assert.equal(f.removed.length, 0);
  f.tables.set(adminTeams, []); f.tables.set(adminTeamMembers, []);
  f.tables.set(adminTeamVersions, [{ id: 'frozen' }]);
  await assert.rejects(service.deleteAssistant(admin, 'coach', f.now.toISOString()));
  assert.equal(f.removed.length, 0);
  f.tables.set(adminTeamVersions, []);
  f.purposeInUse(true);
  await assert.rejects(service.deleteAssistant(admin, 'coach', f.now.toISOString()), /用途关联/);
  assert.equal(f.removed.length, 0);
  f.purposeInUse(false);
  await service.deleteAssistant(admin, 'coach', f.now.toISOString());
  assert.deepEqual(f.removed, [agentSkillBindings, agentToolBindings, agentMcpBindings, agentConfigs, adminAssistants]);
});

test('team and MCP deletion reject frozen or current bindings and remove only unused registrations', async () => {
  const f = deletionDatabase();
  const service = new PlatformRegistryService(f.db as never, 'live', { write: async () => 'audit' } as never, {} as never);
  f.tables.set(adminTeamVersions, [{ id: 'version' }]);
  await assert.rejects(service.deleteTeam(admin, 'team', f.now.toISOString()));
  f.tables.set(adminTeamVersions, []);
  await service.deleteTeam(admin, 'team', f.now.toISOString());
  const resources = new CopilotResources(f.db as never, { write: async () => 'audit' } as never);
  f.tables.set(agentMcpBindings, [{ agentId: 'agent' }]);
  await assert.rejects(resources.deleteMcp(admin, 'custom', 'blocked'));
  f.tables.set(agentMcpBindings, []); f.tables.set(adminAssistants, []);
  await resources.deleteMcp(admin, 'custom', 'delete');
  assert.equal((await resources.assertMcpDeleted('custom')).deleted, true);
  await assert.rejects(resources.deleteMcp(admin, 'ima-knowledge', 'builtin'));
});

test('actual knowledge library owner soft deletion cancels jobs and revokes sources while retaining the base record', async () => {
  const f = fixture();
  const base = { id: 'base', revision: 1, kind: 'platform', lifecycle: 'active', library_settings: {}, engine_instance_id: 'native', build_state: 'unindexed' };
  const state = { job: 'queued', source: 'ready', connection: 'ready' };
  const execute = async (query: SQL) => {
    const { sql } = new PgDialect().sqlToQuery(query);
    if (sql.includes('SELECT revision,library_settings')) return [{ revision: base.revision, library_settings: {} }];
    if (sql.includes('SET lifecycle=')) { base.lifecycle = 'deleted'; base.revision++; }
    if (sql.includes('UPDATE knowledge_jobs')) state.job = 'cancelled';
    if (sql.includes('UPDATE knowledge_sources')) state.source = 'revoked';
    if (sql.includes('UPDATE knowledge_base_connections')) state.connection = 'revoked';
    if (sql.includes('SELECT lifecycle,revision')) return [{ lifecycle: base.lifecycle, revision: base.revision }];
    return [];
  };
  const center = { base: async () => ({ ...base }), query: execute,
    configuration: async () => ({ revision: 5, config: { knowledgeEngines: { native: { enabled: true } } } }),
    database: () => ({ transaction: async <T>(run: (tx: { execute(query: SQL): Promise<{ rows: unknown[] }> }) => Promise<T>) =>
      run({ execute: async query => ({ rows: await execute(query) }) }) }) };
  const library = new KnowledgeLibraryService(center as never, f.teaching.audit as never, {} as never);
  const service = new CopilotLifecycle(f.registry as never, f.teaching.service, center as never, f.models as never, f.resources, f.ima as never, library);
  const configured = await service.execute(admin, 'knowledge.test', { id: base.id, mode: 'configuration' }, 'config');
  assert.ok(JSON.stringify(configured).includes('"indexReady":false'));
  await assert.rejects(service.execute(admin, 'knowledge.delete', { id: base.id, expectedRevision: 0 }, 'stale'));
  assert.equal(base.lifecycle, 'active');
  const deleted = await service.execute(admin, 'knowledge.delete', { id: base.id, expectedRevision: 1 }, 'delete');
  await service.readback(admin, 'knowledge.delete', deleted);
  assert.equal(base.lifecycle, 'deleted');
  assert.deepEqual(state, { job: 'cancelled', source: 'revoked', connection: 'revoked' });
});
