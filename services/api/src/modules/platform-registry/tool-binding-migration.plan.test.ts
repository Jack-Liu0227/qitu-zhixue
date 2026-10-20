import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGACY_TOOL_BINDING_RESOLUTIONS, RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import { BUILTIN_ASSISTANTS } from '@qitu/ai-client';
import { buildToolBindingMigrationPlan } from './tool-binding-migration.plan';

const known = RUNTIME_TOOL_CATALOG.map(tool => tool.id);
const row = { id: 'fixture', name: 'Fixture', updatedAt: new Date('2026-10-01T00:00:00Z'), toolIds: ['mastery_query', 'learning_plan_advance', 'unrecognized-custom-tool'] };

test('migration removes only explicitly retired declarations, preserves order and never adds permissions', () => {
  const plan = buildToolBindingMigrationPlan([row], known);
  assert.deepEqual(plan.entries[0]?.afterToolIds, ['mastery_query', 'unrecognized-custom-tool']);
  assert.deepEqual(plan.entries[0]?.beforeToolIds, row.toolIds);
  assert.deepEqual(plan.unresolvedToolIds, ['unrecognized-custom-tool']);
  assert.equal(plan.entries[0]?.retired[0]?.owner, 'learning-plan / projects');
  assert.equal(row.toolIds.length, 3);
});

test('a genuinely registered implementation is not retired and every metadata item has an explicit disposition', () => {
  const plan = buildToolBindingMigrationPlan([row], [...known, 'learning_plan_advance']);
  assert.equal(plan.entries.length, 0);
  assert.equal(new Set(LEGACY_TOOL_BINDING_RESOLUTIONS.map(item => item.id)).size, 9);
  assert.equal(LEGACY_TOOL_BINDING_RESOLUTIONS.every(item => item.owner && item.explanation), true);
});

test('preview revision is independent of row order and changes when any assistant binding or version changes', () => {
  const other = { ...row, id: 'other', toolIds: ['knowledge_search'] };
  const revision = buildToolBindingMigrationPlan([row, other], known).revision;
  assert.equal(buildToolBindingMigrationPlan([other, row], known).revision, revision);
  assert.notEqual(buildToolBindingMigrationPlan([{ ...row, toolIds: [...row.toolIds, 'knowledge_read'] }, other], known).revision, revision);
  assert.notEqual(buildToolBindingMigrationPlan([{ ...row, updatedAt: new Date() }, other], known).revision, revision);
});

test('fresh assistant defaults and current seed sources no longer advertise unregistered tools', () => {
  for (const assistant of BUILTIN_ASSISTANTS) assert.deepEqual(assistant.toolIds.filter(id => !known.includes(id)), [], assistant.id);
  const retired = new Set(LEGACY_TOOL_BINDING_RESOLUTIONS.map(item => item.id));
  for (const name of ['admin-ai-config.sql', 'optics-team-seed.sql', 'feishu-reporting-assistant.sql']) {
    const content = readFileSync(resolve(process.cwd(), '../../database/seeds', name), 'utf8');
    for (const match of content.matchAll(/'(\[[^\n']*\])'::jsonb/g)) {
      const values: unknown = JSON.parse(match[1]!);
      if (Array.isArray(values)) assert.equal(values.some(value => typeof value === 'string' && retired.has(value)), false, name);
    }
  }
});
