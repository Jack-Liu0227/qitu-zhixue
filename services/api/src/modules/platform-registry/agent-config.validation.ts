import { BadRequestException } from '@nestjs/common';
import type { AdminRuntimeAgentUpdateRequest } from '@qitu/contracts';

const fields = new Set(['label', 'roleDefinition', 'agentDefinition', 'parentAgentId', 'modelUsage', 'modelProviderId', 'modelId', 'capabilities', 'skillIds', 'skillBindings', 'toolIds', 'mcpBindings', 'enabled']);
const capabilities = new Set(['explore', 'plan', 'teach', 'review', 'reflect']);

function invalid(): never {
  throw new BadRequestException({ code: 'AGENT_CONFIG_INVALID', message: 'Agent 配置字段或绑定无效' });
}

function stringList(value: unknown, max = 64): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 160)) invalid();
  if (new Set(value).size !== value.length) invalid();
  return [...value] as string[];
}

/** Reject malformed or unknown fields before idempotency hashing or database access. */
export function parseAgentUpdate(body: unknown): AdminRuntimeAgentUpdateRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) invalid();
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some((key) => !fields.has(key))) invalid();
  const out: AdminRuntimeAgentUpdateRequest = {};
  for (const key of ['label', 'roleDefinition', 'agentDefinition', 'modelUsage'] as const) {
    if (key in input) {
      if (typeof input[key] !== 'string') invalid();
      out[key] = (input[key] as string).trim();
    }
  }
  for (const key of ['modelProviderId', 'modelId'] as const) {
    if (key in input) {
      if (input[key] !== null && typeof input[key] !== 'string') invalid();
      out[key] = input[key] === null ? null : (input[key] as string).trim();
      if (out[key] !== null && !out[key]) invalid();
    }
  }
  const providerSpecified = 'modelProviderId' in input;
  const modelSpecified = 'modelId' in input;
  if (providerSpecified !== modelSpecified) invalid();
  if (providerSpecified && ((out.modelProviderId === null) !== (out.modelId === null))) invalid();
  if (out.label !== undefined && (out.label.length < 2 || out.label.length > 80)) invalid();
  if (out.roleDefinition !== undefined && (out.roleDefinition.length < 20 || out.roleDefinition.length > 4000)) invalid();
  if (out.agentDefinition !== undefined && out.agentDefinition.length > 12000) invalid();
  if (out.modelUsage !== undefined && (!out.modelUsage || out.modelUsage.length > 160)) invalid();
  if ('parentAgentId' in input) {
    if (input.parentAgentId !== null && (typeof input.parentAgentId !== 'string' || !input.parentAgentId.trim() || input.parentAgentId.length > 160)) invalid();
    out.parentAgentId = input.parentAgentId as string | null;
  }
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') invalid();
    out.enabled = input.enabled;
  }
  if ('capabilities' in input) {
    out.capabilities = stringList(input.capabilities, 5);
    if (!out.capabilities.length || out.capabilities.some((id) => !capabilities.has(id))) invalid();
  }
  if ('skillIds' in input) out.skillIds = stringList(input.skillIds);
  if ('toolIds' in input) out.toolIds = stringList(input.toolIds);
  if ('skillBindings' in input) {
    if ('skillIds' in input || !Array.isArray(input.skillBindings) || input.skillBindings.length > 64) invalid();
    out.skillBindings = input.skillBindings.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) invalid();
      const binding = item as Record<string, unknown>;
      if (Object.keys(binding).some((key) => key !== 'skillId' && key !== 'inheritToChildren')) invalid();
      const [skillId] = stringList([binding.skillId]);
      if ('inheritToChildren' in binding && typeof binding.inheritToChildren !== 'boolean') invalid();
      return { skillId: skillId!, inheritToChildren: binding.inheritToChildren === true };
    });
    stringList(out.skillBindings.map((item) => item.skillId));
  }
  if ('mcpBindings' in input) {
    if (!Array.isArray(input.mcpBindings) || input.mcpBindings.length > 32) invalid();
    out.mcpBindings = input.mcpBindings.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) invalid();
      const binding = item as Record<string, unknown>;
      if (Object.keys(binding).some((key) => key !== 'serverId' && key !== 'toolIds')) invalid();
      const [serverId] = stringList([binding.serverId]);
      return { serverId: serverId!, toolIds: stringList(binding.toolIds ?? []) };
    });
    stringList(out.mcpBindings.map((item) => item.serverId), 32);
  }
  return out;
}

export function assertParentGraph(agentId: string, parentId: string | null, agents: readonly { id: string; parentAgentId: string | null }[]): void {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const seen = new Set([agentId]);
  let id = parentId;
  while (id !== null) {
    if (seen.has(id) || !byId.has(id)) invalid();
    seen.add(id);
    id = byId.get(id)!.parentAgentId;
  }
}
