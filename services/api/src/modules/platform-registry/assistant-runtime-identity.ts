/** Deliberate historical aliases, never inferred from a name or role label. */
const ASSISTANT_RUNTIME_BINDINGS: ReadonlyMap<string, readonly string[]> = new Map([
  ['tutor-leader', ['qitu-learning-partner']],
]);

export function runtimeIdsForAssistant(assistantId: string): readonly string[] {
  return [...new Set([assistantId, ...(ASSISTANT_RUNTIME_BINDINGS.get(assistantId) ?? [])])];
}

export function assistantIdsForRuntimeAgent(agentId: string): readonly string[] {
  const aliases = [...ASSISTANT_RUNTIME_BINDINGS]
    .filter(([, runtimeIds]) => runtimeIds.includes(agentId))
    .map(([assistantId]) => assistantId);
  return [...new Set([agentId, ...aliases])];
}
