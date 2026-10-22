import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTutorKnowledgeAccess, resolveTutorKnowledgeAccess } from './tutor-knowledge-access';
import { IMA_READ_TOOLS } from './ima-mcp.client';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import type { ImaSettingsService } from '../platform-registry/ima-settings.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { ImaReadEvidence } from './ima-project-scope';
import { verifyLessonEvidence } from './tutor-activity-context';

test('managed source receipts enter this project turn only while owner, frozen scope and current tool grants agree', async () => {
  const h = teachingContextFixture();
  h.teaching.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['original'], allowedTools: ['ima_read_document'] };
  h.teaching.roles[0]!.tools = [{ toolId: 'ima_read_document', mcpServerId: 'ima-knowledge', schemaDigest: 'digest', handlerVersion: 'ima-mcp.v1' }];
  const teaching = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  let allowed = true;
  let current = ['original'];
  const access = await resolveTutorKnowledgeAccess({ studentId: h.project.studentId, assistantId: teaching.role.assistantId,
    projectId: h.project.id, templateVersionId: h.project.templateVersionId!, teaching, plans: h.store,
    bindings: { getFrozenTeachingBundle: async () => h.teaching } as unknown as TemplateBindingService,
    ima: { canCall: async () => true, currentKnowledgeBaseIds: async () => current } as unknown as ImaSettingsService,
    authorizeManagedTool: async () => allowed });
  const evidence: ImaReadEvidence = { sourceRef: 'knowledge-read:fixture', knowledgeBaseId: 'original',
    documentRefHash: 'a'.repeat(64), title: 'Approved source', expiresAt: Date.now() + 60_000 };
  assert.equal(await access.managed.recordReadEvidence!(evidence), true);
  assert.equal(access.readEvidence!.get(evidence.sourceRef), evidence);
  assert.deepEqual(await verifyLessonEvidence(access, [evidence.sourceRef]), [evidence]);
  access.readEvidence!.clear();
  assert.equal(await access.managed.recordReadEvidence!({ ...evidence, knowledgeBaseId: 'unfrozen' }), false);
  allowed = false;
  assert.equal(await access.managed.recordReadEvidence!(evidence), false);
  allowed = true; current = [];
  assert.equal(await access.managed.recordReadEvidence!(evidence), false);
  current = ['original']; h.project.studentId = 'other-student';
  assert.equal(await access.managed.recordReadEvidence!(evidence), false);
  assert.equal(access.readEvidence!.size, 0);
});

test('template handoff cannot inherit current global knowledge libraries before project confirmation', async () => {
  const input = { studentId: 'synthetic-student', assistantId: 'published-mentor', projectId: null,
    ima: { currentKnowledgeBaseIds: async () => ['assistant-library'], canCall: async () => true } as unknown as ImaSettingsService,
    authorizeManagedTool: async () => true };
  const access = await resolveTutorKnowledgeAccess({ ...input, unconfirmedTemplate: true });
  assert.deepEqual(await access.ima.knowledgeBaseIds(), []);
  for (const id of IMA_READ_TOOLS) assert.equal(await access.authorize(id), false);
  for (const id of ['knowledge_search', 'knowledge_read']) assert.equal(await access.managed.authorizeTool!(id), false);
  assert.deepEqual(access.managed.knowledgeBaseIds, []);
  // The existing separately governed free-intake path retains its explicit Admin policy.
  assert.deepEqual(await (await resolveTutorKnowledgeAccess(input)).ima.knowledgeBaseIds(), ['assistant-library']);
});

test('project scope refresh rechecks owner, frozen digest and current knowledge grants', async () => {
  const h = teachingContextFixture();
  h.teaching.knowledgeGrant = { serverId: 'ima-knowledge', knowledgeBaseIds: ['original'], allowedTools: ['ima_read_document'] };
  h.teaching.roles[0]!.tools = [{ toolId: 'ima_read_document', mcpServerId: 'ima-knowledge', schemaDigest: 'digest', handlerVersion: 'ima-mcp.v1' }];
  const context = await resolveTutorTeachingContext(h.store, h.project, h.teaching);
  let current = ['original'];
  let enabled = true;
  const settings = { canCall: async () => enabled, currentKnowledgeBaseIds: async () => current } as unknown as ImaSettingsService;
  const bindings = { getFrozenTeachingBundle: async () => h.teaching } as unknown as TemplateBindingService;
  const access = createTutorKnowledgeAccess(context, h.project.id, h.project.studentId, context.role.assistantId, settings, h.store, bindings);
  assert.ok(access.scope);
  assert.equal(await access.authorize!('ima_read_document'), true);
  assert.equal(await access.authorize!('ima_search_knowledge'), false);
  assert.deepEqual(await access.scope.refreshAllowedKnowledgeBaseIds(), ['original']);
  current = [];
  assert.deepEqual(await access.scope.refreshAllowedKnowledgeBaseIds(), []);
  enabled = false;
  assert.equal(await access.authorize!('ima_read_document'), false);
  current = ['original'];
  h.project.studentId = 'other-student';
  assert.deepEqual(await access.scope.refreshAllowedKnowledgeBaseIds(), []);
  h.project.studentId = 'synthetic-owner';
  h.teaching.approvalPolicyVersion = 'unexpected-replacement';
  assert.deepEqual(await access.scope.refreshAllowedKnowledgeBaseIds(), []);
});
