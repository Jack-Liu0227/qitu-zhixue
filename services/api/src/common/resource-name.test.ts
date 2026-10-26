import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertResourceNameAvailable, resourceNameDatabaseConflict, resourceNameKey } from './resource-name';
import { buildProblemDetails } from './http/problem-details';

test('name comparison normalizes whitespace and ASCII case, and excludes only the edited object', () => {
  assert.equal(resourceNameKey('\u3000Optics\t\n Team\u00a0'), 'optics team');
  assert.equal(resourceNameKey('光学团队'), '光学团队');
  assertResourceNameAvailable('team', 'Optics Team', [{ id: 'self', name: 'optics team' }], 'self');
  assert.throws(() => assertResourceNameAvailable('team', 'Optics Team', [
    { id: 'self', name: 'optics team' }, { id: 'other', name: ' OPTICS  TEAM ' },
  ], 'self'), /同名团队/);
});

test('database race conflicts become safe 409 responses, including wrapped errors', () => {
  for (const constraint of ['admin_teams_name_unique_idx', 'admin_assistants_name_unique_idx',
    'project_templates_platform_name_unique_idx', 'project_templates_school_name_unique_idx',
    'knowledge_bases_name_unique_idx', 'model_providers_name_unique_idx', 'model_models_name_unique_idx',
    'agent_configs_name_unique_idx', 'runtime_mcp_servers_name_unique_idx']) {
    const pg = { code: '23505', constraint, detail: 'PRIVATE_ROW_DATA', message: 'PRIVATE_SQL' };
    for (const error of [pg, { cause: pg }, { cause: { cause: pg } }]) {
      const problem = buildProblemDetails(error);
      assert.equal(problem.status, 409);
      assert.equal(problem.code, 'RESOURCE_NAME_CONFLICT');
      assert.doesNotMatch(JSON.stringify(problem), /PRIVATE|unique_idx/);
    }
  }
  assert.equal(resourceNameDatabaseConflict({ code: '23505', constraint: 'unrelated_pkey' }), undefined);
  assert.equal(resourceNameDatabaseConflict({ code: '23503', constraint: 'admin_teams_name_unique_idx' }), undefined);
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(resourceNameDatabaseConflict(cyclic), undefined);
});
