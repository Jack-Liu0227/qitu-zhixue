import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminCopilotRequest } from '@qitu/contracts';
import { assertOperationScope, rememberCreatedResource, type CopilotScopeResources, type CreatedResources } from './copilot.scope';
import { parseRequest } from './copilot.protocol';

const request: AdminCopilotRequest = { scope: 'selected_template', message: 'configure', history: [],
  templateId: 'optics', templateVersionId: 'optics-v1', assistantId: 'qitu-assistant', teamId: 'foreign-client-team',
  modelProviderId: 'provider', modelId: 'model', permission: 'full_access' };
const resources: CopilotScopeResources = { bindingStatus: 'active', teamIds: ['optics-team'], assistantIds: ['optics-coach'] };
const mismatch = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === 'COPILOT_SCOPE_MISMATCH';

test('global scope permits explicit resource IDs without a selected template', () => {
  const global = { ...request, scope: 'global' as const, templateId: null, templateVersionId: null };
  assertOperationScope(global, 'assistant.update', { id: 'global-assistant' }, resources, new Map());
  assertOperationScope(global, 'growth.projection.configure', { expectedRevision: 2 }, resources, new Map());
  assert.equal(parseRequest(global).scope, 'global');
});

test('scope parser rejects contradictory scopes, missing selection and unknown scopes', () => {
  for (const patch of [{ scope: 'global' }, { scope: 'selected_template', templateId: null, templateVersionId: null }, { scope: 'unbounded' }]) {
    assert.throws(() => parseRequest({ ...request, ...patch }));
  }
});

test('selected-template scope rejects foreign resources, client-selected teams and platform policies', () => {
  const cases = [
    ['assistant.update', { id: 'foreign-coach' }], ['team.update', { id: request.teamId }],
    ['workflow.update', { id: 'foreign-team' }], ['template.update', { id: 'foreign-template' }],
    ['template.version', { templateId: 'optics', sourceVersionId: 'other-v2' }],
    ['binding.activate', { templateId: 'optics', versionId: 'other-v2', bindingId: 'b' }],
    ['ima.configure', {}], ['knowledge.configure', {}], ['growth.projection.configure', {}],
    ['model.provider', { id: 'provider' }], ['mcp.update', { id: 'shared-mcp' }],
    ['knowledge.bind', { id: 'existing-kb', bindings: [] }], ['skill.publish', { id: 'existing-skill' }],
  ] as const;
  for (const [kind, input] of cases) assert.throws(() => assertOperationScope(request, kind, input, resources, new Map()), mismatch);
});

test('selected-template scope permits proven resources and own template binding lifecycle', () => {
  assertOperationScope(request, 'assistant.update', { id: 'optics-coach' }, resources, new Map());
  assertOperationScope(request, 'team.update', { id: 'optics-team' }, resources, new Map());
  assertOperationScope(request, 'team.update', { id: 'optics-team' }, resources, new Map());
  assertOperationScope(request, 'binding.activate', { templateId: 'optics', versionId: 'optics-v1', bindingId: 'b' }, resources, new Map());
});

test('new resource authorization requires a successful readback and does not grant unrelated KB permissions', () => {
  const created: CreatedResources = new Map();
  assert.throws(() => assertOperationScope(request, 'skill.publish', { id: 'new-skill' }, resources, created), mismatch);
  rememberCreatedResource(created, 'skill.create', { id: 'new-skill' });
  assertOperationScope(request, 'skill.publish', { id: 'new-skill' }, resources, created);
  rememberCreatedResource(created, 'knowledge.create', { id: 'new-kb' });
  assertOperationScope(request, 'knowledge.bind', { id: 'new-kb', bindings: [{ agentId: 'optics-coach' }] }, resources, created);
  assert.throws(() => assertOperationScope(request, 'knowledge.bind', { id: 'new-kb', bindings: [{ agentId: 'foreign-coach' }] }, resources, created), mismatch);
});

test('destructive lifecycle actions require global scope while owned template/assistant tests keep their object boundary', () => {
  for (const kind of ['assistant.delete', 'team.delete', 'template.delete', 'skill.delete', 'mcp.delete', 'knowledge.delete', 'model.delete', 'mcp.invoke', 'team.run', 'team.run.status', 'knowledge.import', 'knowledge.rebuild'] as const) {
    assert.throws(() => assertOperationScope(request, kind, { id: 'optics-coach', templateId: 'optics' }, resources, new Map()), mismatch);
  }
  assertOperationScope(request, 'assistant.test', { id: 'optics-coach', mode: 'configuration' }, resources, new Map());
  assert.throws(() => assertOperationScope(request, 'assistant.test', { id: 'foreign', mode: 'configuration' }, resources, new Map()), mismatch);
  assertOperationScope(request, 'template.test', { templateId: 'optics', versionId: 'optics-v1' }, resources, new Map());
  assert.throws(() => assertOperationScope(request, 'template.test', { templateId: 'other', versionId: 'optics-v1' }, resources, new Map()), mismatch);
});
