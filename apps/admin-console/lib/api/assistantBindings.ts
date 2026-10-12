import type { AdminAssistantConfig, AdminAssistantUpdateInput } from '@qitu/contracts';
import { updatePersistedAssistant } from './assistants';
import { newIdempotencyKey } from './modelRegistry';

export const BUILTIN_IMAGE_GENERATION_ID = 'builtin.image_generation';
export const BUILTIN_SANDBOX_ID = 'builtin.sandbox';

/** MCP accepts the canonical row id, while legacy JSON-editor rows may contain the display name. */
export function hasMcpBinding(assistant: AdminAssistantConfig, row: { id: string; name: string }): boolean {
  return assistant.mcpServerIds.includes(row.id) || assistant.mcpServerIds.includes(row.name);
}

export function hasBuiltinBinding(assistant: AdminAssistantConfig, toolId: string): boolean {
  return assistant.toolIds.includes(toolId);
}

export function hasSkillBinding(assistant: AdminAssistantConfig, skillId: string): boolean {
  return assistant.enabledSkills.includes(skillId);
}

export function toggleBinding(values: readonly string[], value: string | readonly string[], enabled: boolean): string[] {
  const removals = new Set(typeof value === 'string' ? [value] : value);
  const next = values.filter((item) => !removals.has(item));
  if (enabled && (typeof value === 'string' || value.length > 0)) next.push(typeof value === 'string' ? value : value[0]!);
  return next;
}

/** Every request gets a fresh key; the patch deliberately contains exactly one binding field. */
export function persistAssistantBinding(
  assistantId: string,
  field: 'mcpServerIds' | 'toolIds' | 'enabledSkills',
  values: string[],
): Promise<AdminAssistantConfig> {
  const patch = { [field]: values } as AdminAssistantUpdateInput;
  return updatePersistedAssistant(assistantId, patch, newIdempotencyKey());
}

export function isDuplicateReplay(error: unknown): boolean {
  return (error as { status?: number }).status === 409;
}
