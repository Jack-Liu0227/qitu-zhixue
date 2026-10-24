import { and, eq, notInArray, sql } from 'drizzle-orm';
import { pblTemplateTeamBindings, agentConfigs, modelModels, modelProviders, modelUsageBindings, type Database } from '@qitu/database';
import type { ModelDescriptor, ModelModality } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit';

/**
 * `model-registry` 的持久化原语。
 *
 * 只负责「怎么读写三张表」，不包含状态机、模态校验或审计语义；这些留在
 * `ModelRegistryService`。所有写函数都接受一个 `RegistryExecutor`，因此既能被
 * `withTransaction(db, (tx) => ...)` 的事务句柄调用（与审计同事务），也能直接用
 * 连接池调用。
 *
 * 注意：`model_models.source` 在库里用 `remote`，对外的 `ModelDescriptor.source`
 * 用 `fetched`；两者的映射只在 service 层做。
 */

/** 事务句柄或连接池，两者都实现了同一组 Drizzle 读写方法。 */
export type RegistryExecutor = Database | AuditTransaction;

export type ProviderRow = typeof modelProviders.$inferSelect;
export type ModelRow = typeof modelModels.$inferSelect;
export type UsageBindingRow = typeof modelUsageBindings.$inferSelect;

/* ------------------------------- 读 ------------------------------- */

export async function loadProviderRows(executor: RegistryExecutor): Promise<ProviderRow[]> {
  return executor.select().from(modelProviders);
}

export async function loadModelRows(executor: RegistryExecutor): Promise<ModelRow[]> {
  return executor.select().from(modelModels);
}

export async function loadUsageBindingRows(executor: RegistryExecutor): Promise<UsageBindingRow[]> {
  return executor.select().from(modelUsageBindings);
}

/** 读取单个供应商；不存在返回 `null`（区别于「查询失败」）。 */
export async function loadProviderRow(
  executor: RegistryExecutor,
  id: string,
): Promise<ProviderRow | null> {
  const rows = await executor
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 读取单个模型（**含软下线行**）。
 *
 * 内存快照只保留 `enabled` 模型，因此「是否已存在」这类判定必须回库查，
 * 否则同一个 `modelId` 会被重复创建。
 */
export async function loadModelRow(
  executor: RegistryExecutor,
  providerId: string,
  modelId: string,
): Promise<ModelRow | null> {
  const rows = await executor
    .select()
    .from(modelModels)
    .where(and(eq(modelModels.providerId, providerId), eq(modelModels.modelId, modelId)))
    .limit(1);
  return rows[0] ?? null;
}

/** 读取单个供应商的全部模型行（**含软下线行**）。 */
export async function loadModelRowsForProvider(
  executor: RegistryExecutor,
  providerId: string,
): Promise<ModelRow[]> {
  return executor
    .select()
    .from(modelModels)
    .where(eq(modelModels.providerId, providerId))
    .orderBy(modelModels.modelId);
}

/**
 * 列出该供应商下**被引用**的模型 id（兼容用途绑定 + Agent 直接选择）。
 *
 * 取消挂载是物理删除，因此删除前必须整体算一次引用集合：宁可整笔拒绝，
 * 也不能把运行时指向不存在的模型。
 */
export async function listReferencedModelIds(
  executor: RegistryExecutor,
  providerId: string,
): Promise<string[]> {
  const bindings = await executor
    .select({ modelId: modelUsageBindings.modelId })
    .from(modelUsageBindings)
    .where(eq(modelUsageBindings.providerId, providerId));
  const agents = await executor
    .select({ modelId: agentConfigs.modelId })
    .from(agentConfigs)
    .where(eq(agentConfigs.modelProviderId, providerId));
  return [
    ...new Set(
      [...bindings, ...agents]
        .map((row) => row.modelId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ];
}

/** 找出引用了某个 `(provider, model)` 的用途；为空表示可以安全停用 / 删除。 */
export async function listBindingUsageIdsForModel(
  executor: RegistryExecutor,
  providerId: string,
  modelId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ usageId: modelUsageBindings.usageId })
    .from(modelUsageBindings)
    .where(
      and(eq(modelUsageBindings.providerId, providerId), eq(modelUsageBindings.modelId, modelId)),
    );
  return rows.map((row) => row.usageId);
}

/** Find Agent configs that directly select a model. */
export async function listAgentIdsForModel(
  executor: RegistryExecutor,
  providerId: string,
  modelId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ agentId: agentConfigs.id })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.modelProviderId, providerId), eq(agentConfigs.modelId, modelId)));
  return rows.map((row) => row.agentId);
}

/** Find Agent configs that directly select any model from a provider. */
export async function listAgentIdsForProvider(
  executor: RegistryExecutor,
  providerId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ agentId: agentConfigs.id })
    .from(agentConfigs)
    .where(eq(agentConfigs.modelProviderId, providerId));
  return rows.map((row) => row.agentId);
}

/* ------------------------------ 写供应商 ------------------------------ */

export interface ProviderRowInput {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authHeader: boolean;
  enabled: boolean;
  secretRef: string | null;
  encryptedApiKey: string | null;
  keyFingerprint: string | null;
  modelsFetchedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Upsert 一行 provider；`created_at` 不动，其余按传入值覆盖。 */
export async function upsertProviderRow(
  executor: RegistryExecutor,
  values: ProviderRowInput,
): Promise<void> {
  await executor
    .insert(modelProviders)
    .values(values)
    .onConflictDoUpdate({
      target: modelProviders.id,
      set: {
        name: values.name,
        baseUrl: values.baseUrl,
        api: values.api,
        authHeader: values.authHeader,
        enabled: values.enabled,
        secretRef: values.secretRef,
        encryptedApiKey: values.encryptedApiKey,
        keyFingerprint: values.keyFingerprint,
        modelsFetchedAt: values.modelsFetchedAt,
        lastError: values.lastError,
        updatedAt: values.updatedAt,
        updatedBy: values.updatedBy,
      },
    });
}

/** 删除 provider 前先清理它的绑定与模型，避免 FK RESTRICT 挡住整次删除。 */
export async function deleteProviderRows(executor: RegistryExecutor, id: string): Promise<void> {
  await executor.delete(modelUsageBindings).where(eq(modelUsageBindings.providerId, id));
  await executor.delete(modelModels).where(eq(modelModels.providerId, id));
  await executor.delete(modelProviders).where(eq(modelProviders.id, id));
}

export async function markProviderFetchSuccess(
  executor: RegistryExecutor,
  id: string,
  now: Date,
  actor: string | null,
): Promise<void> {
  await executor
    .update(modelProviders)
    .set({ modelsFetchedAt: now, lastError: null, updatedAt: now, updatedBy: actor })
    .where(eq(modelProviders.id, id));
}

export async function markProviderFetchError(
  executor: RegistryExecutor,
  id: string,
  message: string,
  now: Date,
  actor: string | null,
): Promise<void> {
  await executor
    .update(modelProviders)
    .set({ lastError: message, updatedAt: now, updatedBy: actor })
    .where(eq(modelProviders.id, id));
}

/**
 * 只顶 `updated_at` / `updated_by`。
 *
 * 用于「挂载集合已保存」这类不代表一次成功拉取、**不得**动 `models_fetched_at`
 * 与 `last_error` 的写入。
 */
export async function markProviderModelsUpdated(
  executor: RegistryExecutor,
  id: string,
  now: Date,
  actor: string | null,
): Promise<void> {
  await executor
    .update(modelProviders)
    .set({ updatedAt: now, updatedBy: actor })
    .where(eq(modelProviders.id, id));
}

/* ------------------------------- 写模型 ------------------------------- */

export interface ManualModelRowInput {
  providerId: string;
  modelId: string;
  displayName: string;
  input: string[];
  output: string[];
  contextWindow: number | null;
  maxTokens: number | null;
}

/** Upsert 一个手工模型（预置模板带入）。手工模型永远 `enabled` 且不参与刷新下线。 */
export async function upsertManualModelRow(
  executor: RegistryExecutor,
  model: ManualModelRowInput,
  now: Date,
): Promise<void> {
  await executor
    .insert(modelModels)
    .values({
      providerId: model.providerId,
      modelId: model.modelId,
      displayName: model.displayName,
      inputModalities: model.input,
      outputModalities: model.output,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      source: 'manual',
      enabled: true,
      lastSeenAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [modelModels.providerId, modelModels.modelId],
      set: {
        displayName: model.displayName,
        inputModalities: model.input,
        outputModalities: model.output,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        source: 'manual',
        enabled: true,
        updatedAt: now,
      },
    });
}

/**
 * 用一次成功的上游拉取结果 upsert 远程模型，并把**本次未返回**的远程模型标记为
 * `enabled=false`（软下线）。
 *
 * 关键约束：
 * - 只动 `source='remote'` 的行，**绝不删除或禁用 manual 模型**；
 * - 不物理删除任何行，`last_seen_at` 记录最后一次被上游看到的时间，便于追溯。
 *
 * ⚠️ `POST :id/refresh` **已不再使用本函数**：同步不再改变挂载集合，只用
 * `syncRemoteModelMetadata`。本函数保留给测试与历史行为复用（例如需要
 * 「全量挂载上游模型」时）。
 */
export async function syncRemoteModelMetadata(
  executor: RegistryExecutor,
  providerId: string,
  models: readonly ModelDescriptor[],
  now: Date,
): Promise<void> {
  for (const model of models) {
    // 只更新已存在的行：新上游模型必须经过管理员勾选保存才会入库。
    await executor
      .update(modelModels)
      .set({
        displayName: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(modelModels.providerId, providerId),
          eq(modelModels.modelId, model.id),
          eq(modelModels.source, 'remote'),
        ),
      );
  }
}

/* ------------------------------ 写挂载集合 ------------------------------ */

/** `PUT :id/models` 的单行输入（已由服务层校验/收敛）。 */
export interface SelectedModelRowInput {
  modelId: string;
  displayName: string;
  input: ModelModality[];
  output: ModelModality[];
  contextWindow: number | null;
  maxTokens: number | null;
  /** 仅对新行生效；已存在的行保留原来源。 */
  source: 'remote' | 'manual';
}

/**
 * 把模型行写进「期望挂载集合」。
 *
 * - 新行：按 `source` 插入并 `enabled=true`；
 * - 已存在行（包括之前的软下线行）：只更新元数据并重新 `enabled=true`，
 *   **不改 `source`**，避免一次保存把手工模型洗成远程模型或反之。
 */
export async function upsertSelectedModelRows(
  executor: RegistryExecutor,
  providerId: string,
  models: readonly SelectedModelRowInput[],
  now: Date,
): Promise<void> {
  for (const model of models) {
    await executor
      .insert(modelModels)
      .values({
        providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        inputModalities: model.input,
        outputModalities: model.output,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        source: model.source,
        enabled: true,
        lastSeenAt: model.source === 'remote' ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [modelModels.providerId, modelModels.modelId],
        set: {
          displayName: model.displayName,
          inputModalities: model.input,
          outputModalities: model.output,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          enabled: true,
          updatedAt: now,
        },
      });
  }
}

/**
 * 按 id 批量物理删除模型行（不区分来源）。
 *
 * 调用方必须已经确认这些 id 没有被用途绑定或 Agent 直接引用，否则 FK
 * `ON DELETE RESTRICT` 会报错。
 */
export async function deleteModelRowsByIds(
  executor: RegistryExecutor,
  providerId: string,
  modelIds: readonly string[],
): Promise<void> {
  for (const modelId of modelIds) {
    await executor
      .delete(modelModels)
      .where(and(eq(modelModels.providerId, providerId), eq(modelModels.modelId, modelId)));
  }
}

export async function upsertRemoteModels(
  executor: RegistryExecutor,
  providerId: string,
  models: readonly ModelDescriptor[],
  now: Date,
): Promise<void> {
  for (const model of models) {
    await executor
      .insert(modelModels)
      .values({
        providerId,
        modelId: model.id,
        displayName: model.name,
        inputModalities: model.input,
        outputModalities: model.output,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        source: 'remote',
        enabled: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [modelModels.providerId, modelModels.modelId],
        set: {
          displayName: model.name,
          inputModalities: model.input,
          outputModalities: model.output,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          source: 'remote',
          enabled: true,
          lastSeenAt: now,
          updatedAt: now,
        },
      });
  }

  const staleWhere =
    models.length === 0
      ? and(eq(modelModels.providerId, providerId), eq(modelModels.source, 'remote'))
      : and(
          eq(modelModels.providerId, providerId),
          eq(modelModels.source, 'remote'),
          notInArray(
            modelModels.modelId,
            models.map((model) => model.id),
          ),
        );

  await executor
    .update(modelModels)
    .set({ enabled: false, updatedAt: now })
    .where(staleWhere);
}

/* ---------------------------- 写手工模型 ---------------------------- */

export interface ManualModelWriteInput {
  providerId: string;
  modelId: string;
  displayName: string;
  input: string[];
  output: string[];
  contextWindow: number | null;
  maxTokens: number | null;
  enabled: boolean;
}

/**
 * **严格插入**一行手工模型。
 *
 * 这里刻意不用 `onConflictDoUpdate`：管理员手工创建遇到重复 `modelId` 时必须
 * 冲突报错，而不是静默覆盖既有（可能是远程）模型。重复由 `(provider_id, model_id)`
 * 主键保证，服务层把 Postgres `23505` 翻译成 409。
 */
export async function insertManualModelRow(
  executor: RegistryExecutor,
  model: ManualModelWriteInput,
  now: Date,
): Promise<void> {
  await executor.insert(modelModels).values({
    providerId: model.providerId,
    modelId: model.modelId,
    displayName: model.displayName,
    inputModalities: model.input,
    outputModalities: model.output,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    source: 'manual',
    enabled: model.enabled,
    lastSeenAt: null,
    updatedAt: now,
  });
}

export interface ManualModelPatch {
  displayName?: string;
  input?: string[];
  output?: string[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  enabled?: boolean;
}

/**
 * 更新手工模型的可编辑字段。
 *
 * `WHERE` 里额外带上 `source='manual'`，即使服务层的检查被绕过或发生竞态，
 * 也不会用一次刷新/手工操作去覆盖远程模型。
 */
export async function updateManualModelRow(
  executor: RegistryExecutor,
  providerId: string,
  modelId: string,
  patch: ManualModelPatch,
  now: Date,
): Promise<void> {
  const set: {
    updatedAt: Date;
    displayName?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    contextWindow?: number | null;
    maxTokens?: number | null;
    enabled?: boolean;
  } = { updatedAt: now };
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.input !== undefined) set.inputModalities = patch.input;
  if (patch.output !== undefined) set.outputModalities = patch.output;
  if (patch.contextWindow !== undefined) set.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) set.maxTokens = patch.maxTokens;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;

  await executor
    .update(modelModels)
    .set(set)
    .where(
      and(
        eq(modelModels.providerId, providerId),
        eq(modelModels.modelId, modelId),
        eq(modelModels.source, 'manual'),
      ),
    );
}

/** 物理删除一行**未被绑定**的手工模型（远程模型只能刷新，绑定校验在服务层）。 */
export async function deleteManualModelRow(
  executor: RegistryExecutor,
  providerId: string,
  modelId: string,
): Promise<void> {
  await executor
    .delete(modelModels)
    .where(
      and(
        eq(modelModels.providerId, providerId),
        eq(modelModels.modelId, modelId),
        eq(modelModels.source, 'manual'),
      ),
    );
}

/* ------------------------------ 写绑定 ------------------------------ */

export interface BindingRowInput {
  usageId: string;
  providerId: string;
  modelId: string;
}

export async function upsertBindingRow(
  executor: RegistryExecutor,
  binding: BindingRowInput,
  actor: string | null,
  now: Date,
): Promise<void> {
  await executor
    .insert(modelUsageBindings)
    .values({
      usageId: binding.usageId,
      providerId: binding.providerId,
      modelId: binding.modelId,
      enabled: true,
      updatedBy: actor,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: modelUsageBindings.usageId,
      set: {
        providerId: binding.providerId,
        modelId: binding.modelId,
        enabled: true,
        updatedBy: actor,
        updatedAt: now,
      },
    });
}

export async function deleteBindingRow(
  executor: RegistryExecutor,
  usageId: string,
): Promise<void> {
  await executor.delete(modelUsageBindings).where(eq(modelUsageBindings.usageId, usageId));
}

/** Published snapshots are historical semantic boundaries, even after mutable Agent selections change. */
export async function listFrozenTeamVersionsForModel(executor: RegistryExecutor, providerId: string, modelId: string): Promise<string[]> {
  const rows = await executor.select({ id: pblTemplateTeamBindings.id }).from(pblTemplateTeamBindings).where(
    sql`EXISTS (SELECT 1 FROM jsonb_each(${pblTemplateTeamBindings.teamSnapshots}) AS frozen WHERE frozen.value->'members' @> ${JSON.stringify([{ runtimeSnapshot: { model: { modelProviderId: providerId, modelId } } }])}::jsonb)`);
  return rows.map(row => row.id);
}
