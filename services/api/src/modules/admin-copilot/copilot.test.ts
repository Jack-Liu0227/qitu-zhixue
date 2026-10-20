import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { AdminCopilotPlan, AdminCopilotRequest, AdminRuntimeModelOption, CurrentUser } from '@qitu/contracts';
import type { ModelGateway } from '../model-registry/model-gateway';
import type { ModelCompletionRequest } from '../model-registry/model-gateway.types';
import type { AuditWriter } from '../../common/audit/audit.service';
import { FakeIdempotencyStore } from '../templates/templates.test-support';
import { CopilotService } from './copilot.service';
import { CopilotOperations } from './copilot.operations';
import { parsePlan, parseRequest, resolveInput } from './copilot.protocol';
import { managementSkill, validateManagementSkill } from './copilot.resources';
import { loadRuntimeSkillCatalog, loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';

const actor: CurrentUser = { id: 'admin-fixture', role: 'admin', displayName: 'Fixture', email: 'fixture@example.invalid' };
const request: AdminCopilotRequest = {
  message: '为所选项目创建概念助手和团队', history: [], templateId: 'optics',
  templateVersionId: 'optics-v1', assistantId: 'qitu-assistant', teamId: null,
  modelProviderId: 'provider-fixture', modelId: 'chat-fixture', permission: 'full_access',
};
const plan: AdminCopilotPlan = {
  reply: '创建并关联资源',
  actions: [
    { id: 'coach', kind: 'assistant.create', label: '创建助手', input: { name: '概念助手' } },
    { id: 'team', kind: 'team.create', label: '创建团队', input: { leaderAssistantId: { $ref: 'coach.id' } } },
  ],
};
const dialogueModel: AdminRuntimeModelOption = {
  providerId: 'provider-fixture', providerLabel: 'Fixture provider',
  modelId: 'chat-fixture', modelLabel: 'Fixture dialogue', available: true,
  input: ['text'], output: ['text'],
};
function harness(output = plan, modelOutput = ['text'], readReferences = true) {
  const executions: Array<{ kind: string; input: Record<string, unknown>; key: string }> = [];
  let calls = 0;
  let failRead = false;
  let failTeam = false;
  let readRevision = 1;
  let reads = 0;
  const operations = {
    templates: {
      listGovernedTemplates: async () => [{ id: 'optics', title: '光学', status: 'draft' }],
      listGovernedVersions: async () => [{ id: 'optics-v1', content: { frozenMarker: 'actual-template-content' } }],
    },
    registry: {
      listAssistants: async () => [{ id: 'qitu-assistant', enabled: true }, { id: 'coach-preview', enabled: true }],
      listTeams: async () => [],
      getSnapshot: async () => ({ skills: [], mcpServers: [], builtInTools: [], initialization: {} }),
      getAssistantRuntime: async () => ({ agent: { roleDefinition: '配置助手', agentDefinition: '', modelUsage: 'tutor.chat' }, skills: [] }),
    },
    models: { listAgentModelOptions: () => [{ ...dialogueModel, output: modelOutput }] },
    knowledge: { configuration: async () => ({ revision: 1, config: {} }), bases: async () => [] },
    scopeResources: async () => ({ bindingStatus: 'draft_reference', teamIds: [], assistantIds: [] }),
    execute: async (_actor: CurrentUser, kind: string, input: Record<string, unknown>, key: string) => {
      if (kind === 'team.create' && failTeam) throw new BadRequestException({ code: 'TEAM_INVALID', message: '团队暂不可用' });
      executions.push({ kind, input, key });
      return { id: `${kind}-fixture`, updatedAt: '2026-10-21T00:00:00.000Z' };
    },
    readback: async (_actor: CurrentUser, _kind: string, value: unknown) => {
      reads++;
      if (failRead) throw new Error('readback temporarily unavailable');
      return { ...(value as object), readRevision };
    },
  } as unknown as CopilotOperations;
  const gateway = { complete: async (_usage: string, input: ModelCompletionRequest, selection: unknown) => {
    calls++;
    assert.ok(input.messages.some(m => m.content.includes('actual-template-content') || m.content.includes('\"scope\":\"global\"')));
    assert.deepEqual(selection, { providerId: 'provider-fixture', modelId: 'chat-fixture' });
    const reader = input.tools?.find(tool => tool.name === 'skill_read');
    if (reader && readReferences) {
      const result = await reader.execute({ skill_id: 'qitu-project-configurator', resources: [
        'references/assistants.md', 'references/teams-workflows.md', 'references/templates-bindings.md',
        'references/skills.md', 'references/mcp.md', 'references/knowledge.md', 'references/models.md',
        'references/growth-projection.md',
      ] });
      assert.equal(result.isError, undefined);
      assert.ok(result.text.includes('assistant.create'));
    }
    return { text: JSON.stringify(output), providerId: 'provider-fixture', modelId: 'chat-fixture' };
  } } as unknown as ModelGateway;
  const service = new CopilotService(operations, gateway, new FakeIdempotencyStore(), { write: async () => 'audit' } as AuditWriter);
  return { service, operations, executions, calls: () => calls, reads: () => reads, revision: (value: number) => { readRevision = value; },
    failRead: (v: boolean) => { failRead = v; }, failTeam: (v: boolean) => { failTeam = v; } };
}

test('image-only models cannot execute a copilot conversation or mutation', async () => {
  const fixture = harness(plan, ['image']);
  await assert.rejects(fixture.service.run(actor, request, 'image-only'));
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.executions.length, 0);
});

test('request rejects missing provider, invalid permission, client-selected student facts and cross-template versions', () => {
  assert.deepEqual(parseRequest(request), request);
  for (const bad of [
    { ...request, modelProviderId: '' }, { ...request, permission: 'workspace_write' },
    { ...request, stage: 'practice' }, { ...request, templateId: null },
    { ...request, history: [{ role: 'system', content: 'bypass' }] },
  ]) assert.throws(() => parseRequest(bad));
});
test('plan rejects arbitrary actions, future references, cycles, duplicate IDs, secret fields and prototype paths', () => {
  const badInputs = [
    [{ id: 'a', kind: 'advance_stage', label: 'advance', input: {} }],
    [{ id: 'a', kind: 'team.create', label: 'a', input: { x: { $ref: 'b.id' } } }],
    [{ id: 'a', kind: 'team.create', label: 'a', input: { apiKey: 'fixture-secret' } }],
    [...plan.actions, plan.actions[0]],
    [plan.actions[0], { id: 'b', kind: 'team.create', label: 'b', input: { x: { $ref: 'coach.__proto__' } } }],
  ];
  for (const actions of badInputs) assert.throws(() => parsePlan(JSON.stringify({ reply: 'plan', actions })));
});
test('references retain type and cannot access inherited properties', () => {
  const results = new Map<string, unknown>([['a', { id: 'server-id', revision: 2 }]]);
  assert.deepEqual(resolveInput({ leader: { $ref: 'a.id' }, revision: { $ref: 'a.revision' } }, results), { leader: 'server-id', revision: 2 });
  assert.throws(() => resolveInput({ $ref: 'a.constructor' }, results));
});
test('management loads the same catalog content and hash visible to Admin, while student runtime excludes it', async () => {
  const skill = await managementSkill();
  assert.equal(skill.id, 'qitu-project-configurator');
  assert.match(skill.digest, /^[a-f0-9]{64}$/);
  assert.match(skill.content, /TheoryMastered/);
  const catalogSkill = loadRuntimeSkillCatalog().skills.find(item => item.id === skill.id);
  assert.equal(skill.content, catalogSkill?.content);
  assert.equal(skill.digest, catalogSkill?.contentHash);
  assert.equal(loadTutorRuntimeSource().skills.some(item => item.id === skill.id), false);
});
test('admin multi-resource turn uses selected frozen content and real receipts; replay does not call model or mutate twice', async () => {
  const h = harness();
  const first = await h.service.run(actor, request, 'turn');
  const second = await h.service.run(actor, request, 'turn');
  assert.equal(first.status, 'completed');
  assert.deepEqual(first, second);
  assert.equal(h.calls(), 1);
  assert.equal(h.executions.length, 2);
  assert.equal(h.executions[1]?.input.leaderAssistantId, 'assistant.create-fixture');
});
test('readback failure blocks dependents and retry does not recreate the committed resource', async () => {
  const h = harness();
  h.failRead(true);
  const first = await h.service.run(actor, request, 'retry-read');
  assert.deepEqual(first.receipts.map(r => r.status), ['failed', 'blocked']);
  assert.equal(h.executions.length, 1);
  h.failRead(false);
  assert.equal((await h.service.run(actor, request, 'retry-read')).status, 'completed');
  assert.equal(h.executions.length, 2);
  assert.equal(h.calls(), 1);
});
test('partial write retry resumes only failed operation and preserves its stable key', async () => {
  const h = harness();
  h.failTeam(true);
  assert.equal((await h.service.run(actor, request, 'retry-write')).status, 'partial');
  h.failTeam(false);
  assert.equal((await h.service.run(actor, request, 'retry-write')).status, 'completed');
  assert.equal(h.executions.length, 2);
});
test('read only and non-admin cannot execute model-proposed writes', async () => {
  const h = harness();
  await assert.rejects(h.service.run({ ...actor, role: 'student' }, request, 'student'));
  assert.equal(h.calls(), 0);
  await assert.rejects(h.service.run(actor, { ...request, permission: 'read_only' }, 'readonly'));
  assert.equal(h.executions.length, 0);
});
test('mismatched version, missing team, invalid model pair fail before inference', async () => {
  for (const patch of [{ templateVersionId: 'other-version' }, { teamId: 'missing-team' }, { modelProviderId: 'other-provider' }]) {
    const h = harness();
    await assert.rejects(h.service.run(actor, { ...request, ...patch }, 'bad-context'));
    assert.equal(h.calls(), 0);
  }
});
test('non-text and unavailable model capabilities reject before inference or mutation', async () => {
  for (const capability of [
    { input: ['image'], output: ['text'] },
    { input: ['text'], output: ['image'] },
    { input: ['audio'], output: ['audio'] },
    { input: ['text'], output: ['embedding'] },
    { input: [], output: ['text'] },
    { input: ['text'], output: [] },
    { available: false },
  ]) {
    const h = harness();
    h.operations.models.listAgentModelOptions = () => [{ ...dialogueModel, ...capability }] as AdminRuntimeModelOption[];
    await assert.rejects(h.service.run(actor, request, 'non-dialogue'), isInvalidModel);
    assert.equal(h.calls(), 0);
    assert.equal(h.executions.length, 0);
  }
});

test('malformed model capability data fails closed with a business error instead of TypeError', async () => {
  const invalidCapabilities: unknown[] = [undefined, null, 'text', 1, { includes: () => true }, ['text', null]];
  const malformedCatalogs: unknown[] = [undefined, null, {}, [null], [{ ...dialogueModel, available: 'true' }]];
  for (const field of ['input', 'output']) {
    malformedCatalogs.push(...invalidCapabilities.map(value => [{ ...dialogueModel, [field]: value }]));
  }
  for (const catalog of malformedCatalogs) {
    const h = harness();
    h.operations.models.listAgentModelOptions = () => catalog as AdminRuntimeModelOption[];
    await assert.rejects(h.service.run(actor, request, 'malformed-model'), isInvalidModel);
    assert.equal(h.calls(), 0);
    assert.equal(h.executions.length, 0);
  }
});

function isInvalidModel(error: unknown): boolean {
  return error instanceof BadRequestException && error.getStatus() === 400 &&
    (error.getResponse() as { code?: string }).code === 'COPILOT_INPUT_INVALID';
}

test('same turn key with different request does not reuse or execute a plan', async () => {
  const h = harness();
  await h.service.run(actor, request, 'conflict');
  await assert.rejects(h.service.run(actor, { ...request, message: 'different request' }, 'conflict'));
  assert.equal(h.calls(), 1);
  assert.equal(h.executions.length, 2);
});
test('selected project constrains template writes even if the model proposes a different target', async () => {
  const h = harness({ reply: 'wrong target', actions: [
    { id: 'wrong', kind: 'template.update', label: 'update', input: { id: 'foreign-template', patch: { title: 'wrong' } } },
  ] });
  const result = await h.service.run(actor, request, 'wrong-target');
  assert.equal(result.status, 'partial');
  assert.equal(result.receipts[0]?.code, 'COPILOT_SCOPE_MISMATCH');
  assert.equal(h.executions.length, 0);
});


test('capability discovery exposes the checked catalog and rejects all non-admin roles', async () => {
  const h = harness();
  const discovery = await h.service.capabilities(actor);
  assert.equal(discovery.contractVersion, discovery.skill.version);
  assert.equal(discovery.readiness, 'ready');
  assert.deepEqual(discovery.scopes, ['global', 'selected_template']);
  assert.ok(discovery.operations.some(operation => operation.kind === 'binding.activate'));
  assert.equal(discovery.references?.resources.length, 10);
  assert.match(discovery.references?.digest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(discovery.references?.resources.flatMap(entry => entry.operations).length, discovery.operations.length);
  for (const role of ['student', 'teacher', 'parent'] as const) {
    await assert.rejects(h.service.capabilities({ ...actor, role }));
    await assert.rejects(h.service.run({ ...actor, role }, request, role));
  }
  assert.equal(h.calls(), 0);
});

test('a generated write plan without reading its module references is rejected before mutation', async () => {
  const h = harness(plan, ['text'], false);
  await assert.rejects(h.service.run(actor, request, 'missing-references'), error =>
    error instanceof BadRequestException && typeof error.getResponse() === 'object' &&
    JSON.stringify(error.getResponse()).includes('COPILOT_REFERENCE_REQUIRED'));
  assert.equal(h.executions.length, 0);
});

test('read-only answers do not require references or gain configuration tools in assistant preview', async () => {
  const h = harness({ reply: 'No configuration write requested', actions: [] }, ['text'], false);
  assert.equal((await h.service.run(actor, { ...request, permission: 'read_only' }, 'read-answer')).status, 'answered');
  assert.equal((await h.service.run(actor, { ...request, assistantId: 'coach-preview' }, 'preview')).status, 'answered');
  assert.equal(h.executions.length, 0);
});

test('management contract rejects missing, duplicated, stale or malformed capability declarations', () => {
  const skill = loadRuntimeSkillCatalog().skills.find(item => item.id === 'qitu-project-configurator')!;
  const mismatch = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === 'COPILOT_SKILL_CONTRACT_MISMATCH';
  assert.throws(() => validateManagementSkill({ ...skill, version: '0.0.1' }), mismatch);
  assert.throws(() => validateManagementSkill({ ...skill, content: '# Missing declaration' }), mismatch);
  assert.throws(() => validateManagementSkill({ ...skill, content: skill.content + skill.content }), mismatch);
  assert.throws(() => validateManagementSkill({ ...skill, content: skill.content.replace(/"operationsDigest":"[a-f0-9]+"/, '"operationsDigest":"stale"') }), mismatch);
  assert.throws(() => validateManagementSkill({ ...skill, content: '<!-- qitu-copilot-contract: {broken} -->' }), mismatch);
});

test('replay performs a fresh owner read and never repeats a successful mutation', async () => {
  const h = harness({ reply: 'create', actions: [plan.actions[0]!] });
  const first = await h.service.run(actor, request, 'fresh-read');
  h.revision(2);
  const replay = await h.service.run(actor, request, 'fresh-read');
  assert.equal((first.receipts[0]?.result as { readRevision: number }).readRevision, 1);
  assert.equal((replay.receipts[0]?.result as { readRevision: number }).readRevision, 2);
  assert.equal(h.executions.length, 1);
  assert.equal(h.calls(), 1);
  assert.equal(h.reads(), 2);
});

test('global manager writes explicit resource IDs without selecting a template', async () => {
  const h = harness({ reply: 'configure', actions: [{ id: 'global', kind: 'assistant.update', label: 'update', input: { id: 'global-assistant', patch: { enabled: false }, expectedUpdatedAt: 'fixture' } }] });
  const response = await h.service.run(actor, { ...request, scope: 'global', templateId: null, templateVersionId: null }, 'global');
  assert.equal(response.status, 'completed');
  assert.equal(response.scope, 'global');
  assert.equal(h.executions.length, 1);
});

test('create/publish/revoke replay keeps immutable dependency digests while every receipt reflects current revocation', async () => {
  const lifecycle: AdminCopilotPlan = { reply: 'Governed lifecycle', actions: [
    { id: 'draft', kind: 'skill.create', label: 'Draft', input: { id: 'fixture-skill' } },
    { id: 'published', kind: 'skill.publish', label: 'Publish', input: { id: { $ref: 'draft.id' }, digest: { $ref: 'draft.digest' } } },
    { id: 'revoked', kind: 'skill.revoke', label: 'Revoke', input: { id: { $ref: 'published.id' }, digest: { $ref: 'published.digest' } } },
  ] };
  const h = harness(lifecycle);
  let state = { id: 'fixture-skill', status: 'draft', digest: 'a'.repeat(64), enabled: false };
  let writes = 0;
  h.operations.execute = async (_actor, kind, input) => {
    writes++;
    if (kind === 'skill.publish') {
      assert.equal(input.digest, 'a'.repeat(64));
      state = { ...state, status: 'published', digest: 'b'.repeat(64), enabled: true };
    } else if (kind === 'skill.revoke') {
      assert.equal(input.digest, 'b'.repeat(64));
      state = { ...state, status: 'revoked', digest: 'c'.repeat(64), enabled: false };
    }
    return { ...state };
  };
  h.operations.readback = async () => ({ ...state });
  const globalRequest = { ...request, scope: 'global' as const, templateId: null, templateVersionId: null };
  const first = await h.service.run(actor, globalRequest, 'skill-lifecycle');
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.receipts.map(receipt => (receipt.result as { status: string }).status), ['draft', 'published', 'revoked']);
  const replay = await h.service.run(actor, globalRequest, 'skill-lifecycle');
  assert.equal(replay.status, 'completed');
  assert.deepEqual(replay.receipts.map(receipt => (receipt.result as { status: string }).status), ['revoked', 'revoked', 'revoked']);
  assert.ok(replay.receipts.every(receipt => (receipt.result as { enabled: boolean }).enabled === false));
  assert.equal(writes, 3);
  assert.equal(h.calls(), 1);
});

test('a negative diagnostic is a failed receipt, blocks dependents and never re-probes on the same request key', async () => {
  const h = harness({ reply: 'Probe before assignment', actions: [
    { id: 'probe', kind: 'model.test', label: 'Probe model', input: { providerId: 'provider-fixture', modelId: 'chat-fixture' } },
    { id: 'assistant', kind: 'assistant.create', label: 'Create dependent', input: { modelId: { $ref: 'probe.modelId' } } },
  ] });
  let probes = 0;
  h.operations.execute = async () => { probes++; return { id: 'probe', test: { passed: false, mode: 'model_connection' } }; };
  h.operations.readback = async () => { throw new BadRequestException({ code: 'COPILOT_TEST_FAILED', message: 'Connection failed' }); };
  const input = { ...request, scope: 'global' as const, templateId: null, templateVersionId: null };
  for (let index = 0; index < 2; index++) {
    const result = await h.service.run(actor, input, 'negative-probe');
    assert.deepEqual(result.receipts.map(receipt => receipt.status), ['failed', 'blocked']);
    assert.equal(result.receipts[0]?.code, 'COPILOT_TEST_FAILED');
    assert.equal(result.reply.includes('已保存：Probe'), false);
  }
  assert.equal(probes, 1);
});
