import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materializationAllowed, type SourcePolicy } from './knowledge-source.policy';
import { PROJECT_TOOL, type PlatformKnowledgeConfig } from './knowledge-center.config';
const config: PlatformKnowledgeConfig = {
  mcpServers: {},
  knowledgeEngines: {
    ima: {
      name: 'ima',
      description: '',
      provider: 'ima',
      enabled: true,
      config: {
        connectionRef: 'ima-legacy',
        allowMaterialize: true,
        allowedKnowledgeBaseIds: ['allowed'],
      },
    },
  },
  platformTools: { 'project-knowledge': { ...PROJECT_TOOL, enabled: true, boundAssistants: [] } },
};
const target = { owner_user_id: 'student-a', school_id: 'school-a' };
const source: SourcePolicy = {
  kind: 'platform',
  lifecycle: 'active',
  visibility: 'active',
  engine_instance_id: null,
  school_id: null,
  owner_user_id: null,
  origin: { canMaterialize: true },
};
test('materialization enforces school, owner, review and project-source isolation', () => {
  assert.equal(materializationAllowed(source, target, config), true);
  for (const patch of [
    { kind: 'project' },
    { kind: 'school', school_id: 'school-b' },
    { kind: 'student', owner_user_id: 'student-b' },
    { visibility: 'deleted' },
    { lifecycle: 'deleted' },
    { origin: { canMaterialize: false } },
  ])
    assert.equal(materializationAllowed({ ...source, ...patch }, target, config), false);
  assert.equal(
    materializationAllowed({ ...source, kind: 'school', school_id: 'school-a' }, target, config),
    true,
  );
  assert.equal(
    materializationAllowed(
      { ...source, kind: 'student', owner_user_id: 'student-a' },
      target,
      config,
    ),
    true,
  );
});
test('ima provenance requires a current explicit whitelist and unchanged connection', () => {
  const ima = {
    ...source,
    engine_instance_id: 'ima',
    origin: {
      canMaterialize: true,
      kind: 'ima',
      engineInstanceId: 'ima',
      connectionRef: 'ima-legacy',
      remoteKnowledgeBaseId: 'allowed',
    },
  };
  assert.equal(materializationAllowed(ima, target, config), true);
  for (const whitelist of [[], null, ['other']]) {
    const changed = structuredClone(config);
    changed.knowledgeEngines.ima!.config.allowedKnowledgeBaseIds = whitelist;
    assert.equal(materializationAllowed(ima, target, changed), false);
  }
  for (const patch of [
    { enabled: false },
    { config: { ...config.knowledgeEngines.ima!.config, allowMaterialize: false } },
    { config: { ...config.knowledgeEngines.ima!.config, connectionRef: 'changed' } },
  ]) {
    const changed = structuredClone(config);
    Object.assign(changed.knowledgeEngines.ima!, patch);
    assert.equal(materializationAllowed(ima, target, changed), false);
  }
});
