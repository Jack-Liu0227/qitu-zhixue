import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { KnowledgeRetrievalController } from './knowledge-retrieval.controller';
import type { ManagedKnowledgeScope } from '../ai-tutor/tutor-knowledge-access';
import { KnowledgeModule } from './knowledge.module';
import { TemplatesModule } from '../templates/templates.module';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

test('citation reads use cached assistant provenance, frozen project scope and current tool grants', async () => {
  let enabled = true; let reads = 0;
  let currentKnowledgeBaseIds = ['frozen-kb'];
  let imaReadAllowed = true;
  let managedReadAllowed = true;
  const bundle = { knowledgeGrant: { knowledgeBaseIds: ['frozen-kb'], allowedTools: ['ima_read_document'] } };
  const controller = new KnowledgeRetrievalController({
    read: async (student: string, assistant: string, id: string, scope: ManagedKnowledgeScope) => {
      reads++;
      assert.equal(student, 'student'); assert.equal(assistant, 'actual-source-assistant');
      assert.equal(scope.key, JSON.stringify(['student', 'owned', assistant, teachingValueDigest(bundle)]));
      if (!await scope.authorizeTool?.('knowledge_read')) throw new Error('REVOKED');
      assert.deepEqual(scope.knowledgeBaseIds, ['frozen-kb']);
      return { citationId: id };
    },
  } as never, { getSession: () => ({ user: { id: 'student', role: 'student' } }) } as never, {
    query: async (query: SQL) => {
      const { sql, params } = new PgDialect().sqlToQuery(query);
      if (sql.includes('FROM projects')) return params[0] === 'owned' && params[1] === 'student'
        ? [{ template_version_id: 'frozen-version', status: 'theory_learning' }] : [];
      return [{ assistant_id: 'actual-source-assistant' }];
    },
  } as never, {
    resolveProjectAssistantId: () => { throw new Error('Must not guess from current template'); },
    getAssistantRuntime: async () => ({ agent: { enabled, toolIds: managedReadAllowed ? ['knowledge_read'] : [] } }),
  } as never, {
    getFrozenTeachingBundle: async (project: string, version: string) => {
      assert.equal(project, 'owned'); assert.equal(version, 'frozen-version');
      return bundle;
    },
  } as never, {
    currentKnowledgeBaseIds: async () => currentKnowledgeBaseIds,
    canCall: async (agentId: string, toolId: string, assistantId: string) => {
      assert.equal(agentId, 'actual-source-assistant');
      assert.equal(assistantId, 'actual-source-assistant');
      assert.equal(toolId, 'ima_read_document');
      return imaReadAllowed;
    },
  } as never);
  await assert.rejects(controller.citation(undefined, 'external~ref', 'owned'), { status: 401 });
  await assert.rejects(controller.citation('qitu_session=ok', 'external~ref', 'foreign'), { status: 404 });
  assert.equal(reads, 0);
  assert.deepEqual(await controller.citation('qitu_session=ok', 'external~ref', 'owned'), { data: { citationId: 'external~ref' } });
  enabled = false;
  await assert.rejects(controller.citation('qitu_session=ok', 'external~ref', 'owned'), /REVOKED/);
  enabled = true; managedReadAllowed = false;
  await assert.rejects(controller.citation('qitu_session=ok', 'external~ref', 'owned'), /REVOKED/);
  managedReadAllowed = true; imaReadAllowed = false;
  await assert.rejects(controller.citation('qitu_session=ok', 'external~ref', 'owned'), /REVOKED/);
  imaReadAllowed = true; currentKnowledgeBaseIds = [];
  await assert.rejects(controller.citation('qitu_session=ok', 'external~ref', 'owned'), /REVOKED/);
});

test('knowledge and template module imports resolve their circular module references', () => {
  for (const module of [KnowledgeModule, TemplatesModule]) {
    const imports = Reflect.getMetadata('imports', module) as unknown[];
    assert.ok(imports.length > 0);
    for (const item of imports) {
      const resolved = item && typeof item === 'object' && 'forwardRef' in item
        ? (item as { forwardRef(): unknown }).forwardRef() : item;
      assert.ok(resolved, 'Nest module reference must not be undefined at runtime');
    }
  }
});
