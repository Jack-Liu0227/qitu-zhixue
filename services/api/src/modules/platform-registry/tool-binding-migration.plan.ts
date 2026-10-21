import { createHash } from 'node:crypto';
import { LEGACY_TOOL_BINDING_RESOLUTIONS, type ToolBindingMigrationPlan } from '@qitu/contracts';

export interface ToolBindingMigrationRow {
  id: string;
  name: string;
  toolIds: string[];
  updatedAt: Date;
}

export function buildToolBindingMigrationPlan(rows: readonly ToolBindingMigrationRow[], knownIds: readonly string[]): ToolBindingMigrationPlan {
  const legacy = new Map(LEGACY_TOOL_BINDING_RESOLUTIONS.map(item => [item.id, item]));
  const known = new Set(knownIds);
  const policyVersion = 'legacy-tool-bindings.v1';
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const input = { policyVersion, resolutions: LEGACY_TOOL_BINDING_RESOLUTIONS, knownIds: [...knownIds].sort(),
    assistants: sorted.map(row => ({ id: row.id, name: row.name, toolIds: row.toolIds, updatedAt: row.updatedAt.toISOString() })) };
  return {
    policyVersion,
    revision: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    entries: sorted.flatMap(row => {
      const retired = row.toolIds.flatMap(id => {
        const resolution = legacy.get(id);
        return !known.has(id) && resolution ? [resolution] : [];
      });
      const retiredIds = new Set(retired.map(item => item.id));
      return retired.length ? [{ assistantId: row.id, assistantName: row.name, expectedUpdatedAt: row.updatedAt.toISOString(),
        beforeToolIds: [...row.toolIds], afterToolIds: row.toolIds.filter(id => !retiredIds.has(id)), retired }] : [];
    }),
    unresolvedToolIds: [...new Set(sorted.flatMap(row => row.toolIds).filter(id => !known.has(id) && !legacy.has(id)))].sort(),
  };
}
