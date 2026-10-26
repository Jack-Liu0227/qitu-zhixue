import { ConflictException } from '@nestjs/common';
import { resourceNameKey } from '@qitu/contracts';
export { resourceNameKey } from '@qitu/contracts';

export const RESOURCE_NAME_LABELS = {
  assistant: '助手', team: '团队', agent: '运行时 Agent', template: '模板',
  knowledge_base: '知识库', model_provider: '模型供应商', model: '模型',
  mcp_server: 'MCP 服务', knowledge_engine: '知识引擎',
} as const;
export type NamedResource = keyof typeof RESOURCE_NAME_LABELS;

export function resourceNameConflict(kind: NamedResource): ConflictException {
  return new ConflictException({
    code: 'RESOURCE_NAME_CONFLICT',
    message: `同类别下已存在同名${RESOURCE_NAME_LABELS[kind]}，请使用其他名称。`,
    details: { resourceType: kind },
  });
}

export function assertResourceNameAvailable(
  kind: NamedResource, name: string, records: Iterable<{ id: string; name: string }>, exceptId?: string,
): void {
  const key = resourceNameKey(name);
  for (const record of records) {
    if (record.id !== exceptId && resourceNameKey(record.name) === key) throw resourceNameConflict(kind);
  }
}

export function assertResourceNamesUnique(kind: NamedResource, names: Iterable<string>): void {
  const seen = new Set<string>();
  for (const name of names) {
    const key = resourceNameKey(name);
    if (seen.has(key)) throw resourceNameConflict(kind);
    seen.add(key);
  }
}

const NAME_CONSTRAINTS: Readonly<Record<string, NamedResource>> = {
  admin_assistants_name_unique_idx: 'assistant',
  admin_teams_name_unique_idx: 'team',
  agent_configs_name_unique_idx: 'agent',
  project_templates_platform_name_unique_idx: 'template',
  project_templates_school_name_unique_idx: 'template',
  knowledge_bases_name_unique_idx: 'knowledge_base',
  model_providers_name_unique_idx: 'model_provider',
  model_models_name_unique_idx: 'model',
  runtime_mcp_servers_name_unique_idx: 'mcp_server',
};

/** Drizzle may wrap PostgreSQL errors in cause. Never expose SQL, names or other row data. */
export function resourceNameDatabaseConflict(error: unknown): ConflictException | undefined {
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    const candidate = error as { code?: unknown; constraint?: unknown; cause?: unknown };
    const kind = typeof candidate.constraint === 'string' && Object.hasOwn(NAME_CONSTRAINTS, candidate.constraint)
      ? NAME_CONSTRAINTS[candidate.constraint] : undefined;
    if (candidate.code === '23505' && kind) return resourceNameConflict(kind);
    error = candidate.cause;
  }
  return undefined;
}
