import { adminAssistants, agentConfigs, agentMcpBindings, runtimeMcpServers, type Database } from '@qitu/database';
import { PlatformRegistryService } from './platform-registry.service';

interface AssistantRuntimeFixture {
  service: PlatformRegistryService;
  db: Database;
  assistant: typeof adminAssistants.$inferSelect;
  configs: Array<typeof agentConfigs.$inferSelect>;
  bindings: Array<typeof agentMcpBindings.$inferSelect>;
  server: typeof runtimeMcpServers.$inferSelect;
  extraRows: Map<unknown, unknown[]>;
  setStorageAvailable(value: boolean): void;
  setFailAudit(value: boolean): void;
  runtimeConfig(id: string): typeof agentConfigs.$inferSelect;
}

export function assistantRuntimeFixture(): AssistantRuntimeFixture {
  const now = new Date('2026-10-19T00:00:00Z');
  const assistant: typeof adminAssistants.$inferSelect = {
    id: 'actual-concept-mentor', source: 'user', name: 'Actual concept mentor', avatar: null,
    description: 'Synthetic teaching fixture', role: 'Concept mentor', enabled: true, sortOrder: 1,
    modelProviderId: 'chosen-provider', modelId: 'same-model-name', temperature: 0.3,
    instructions: 'SYNTHETIC_ACTUAL_MENTOR_INSTRUCTION', enabledSkills: ['tutor-guided-learning'],
    toolIds: ['tutor.context_packet'], mcpServerIds: ['ima-knowledge'], defaults: {},
    agentStatus: 'online', agentStatusMessage: null, teamSelectable: true,
    updatedBy: null, createdAt: now, updatedAt: now,
  };
  const configs: Array<typeof agentConfigs.$inferSelect> = [];
  const bindings: Array<typeof agentMcpBindings.$inferSelect> = [];
  const server: typeof runtimeMcpServers.$inferSelect = {
    id: 'ima-knowledge', label: 'Synthetic IMA', transport: 'streamable_http', description: null,
    endpointOrigin: null, toolIds: ['ima_list_knowledge_bases'], enabled: true, status: 'connected',
    toolCount: 1, lastCheckedAt: null, lastError: null, secretRef: null, updatedAt: now,
  };
  let storageAvailable = true;
  let failAudit = false;
  const extraRows = new Map<unknown, unknown[]>();
  class Chain {
    constructor(private readonly rows: unknown[]) {}
    where() { return this; }
    orderBy() { return this; }
    limit() { return this; }
    then(resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve(this.rows).then(resolve, reject);
    }
  }
  const executor = {
    select: () => ({ from: (table: unknown) => {
      if (!storageAvailable) throw new Error('SYNTHETIC_STORAGE_UNAVAILABLE');
      return new Chain(table === adminAssistants ? [assistant] : table === agentConfigs ? configs
        : table === agentMcpBindings ? bindings : table === runtimeMcpServers ? [server] : extraRows.get(table) ?? []);
    } }),
    update: (table: unknown) => ({ set: (patch: unknown) => ({ where: async () => {
      if (table !== adminAssistants || typeof patch !== 'object' || patch === null) throw new Error('Unexpected mutation');
      Object.assign(assistant, patch);
    } }) }),
  };
  const db = { ...executor, transaction: async <T>(fn: (tx: typeof executor) => Promise<T>) => {
    const previous = structuredClone(assistant);
    try { return await fn(executor); } catch (error) { Object.assign(assistant, previous); throw error; }
  } } as unknown as Database;
  const audit = { write: async () => { if (failAudit) throw new Error('SYNTHETIC_AUDIT_FAILURE'); return 'audit'; } };
  const models = {
    getUsages: () => ({ usages: [], bindings: [] }),
    listAgentModelOptions: () => ['other-provider', 'chosen-provider'].map((providerId) => ({
      providerId, modelId: 'same-model-name', modelLabel: `${providerId} model`, available: true,
    })),
  };
  const service = new PlatformRegistryService(db, 'live', audit as never, models as never);
  return {
    service, db, assistant, configs, bindings, server, extraRows,
    setStorageAvailable: (value: boolean) => { storageAvailable = value; },
    setFailAudit: (value: boolean) => { failAudit = value; },
    runtimeConfig: (id: string): typeof agentConfigs.$inferSelect => ({
      id, displayName: 'UNRELATED_RUNTIME_LABEL', role: 'tutor', roleDefinition: 'UNRELATED_RUNTIME_ROLE',
      agentDefinition: 'UNRELATED_RUNTIME_INSTRUCTION', modelProviderId: 'other-provider', modelId: 'same-model-name',
      modelUsage: 'tutor.chat', capabilities: ['teach'], parentAgentId: null, enabled: true,
      configVersion: 1, updatedBy: null, createdAt: now, updatedAt: now,
    }),
  };
}
