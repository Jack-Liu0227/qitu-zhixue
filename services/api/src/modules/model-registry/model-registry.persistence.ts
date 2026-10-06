import { and, eq, notInArray } from 'drizzle-orm';
import { agentConfigs, modelModels, modelProviders, modelUsageBindings, type Database } from '@qitu/database';
import type { ModelDescriptor } from '@qitu/contracts';
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
 */
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
