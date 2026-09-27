/**
 * 模型供应商注册表与「用途 → 模型」绑定。
 *
 * 设计参照 Pi 的 `pi-ai` 模块，把一个「模型」拆成**三层**，而不是让管理员
 * 在一个输入框里填一串模型名：
 *
 *   1. 供应商 Provider —— `baseUrl` + 协议 `api` + 凭证。一个供应商对应
 *      一家网关或自己的中转，密钥只挂在这一层。
 *   2. 模型列表 ModelDescriptor[] —— 可以从 `baseUrl` **自动拉取**
 *      （见 `RefreshProviderResponse`），也可以手填。
 *   3. 用途绑定 ModelUsageBinding —— 「AI搭档的普通回复」「灵感空间推荐」
 *      「成长总结」各自可以指到不同供应商/模型。
 *
 * 为什么值得拆三层：`pi-ai` 的 `createProvider({ baseUrl, auth, models,
 * fetchModels })` 就是这么做的——**凭证属于供应商，能力属于模型，选择属于
 * 用途**。混在一起以后，「换一个模型」会变成「改一堆地方」。
 *
 * 安全规则（沿用 `settings.ts`）：
 *  - 明文密钥只在写请求里出现一次，对外只给 `keyFingerprint`。
 *  - 日志只记供应商 id、地址与模型个数，**不记密钥**。
 */

/** 上游协议族。决定拉模型列表与发起对话的请求形状。 */
export type ModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

/** 模型能吃／能吐的模态。 */
export type ModelModality = 'text' | 'image' | 'audio';

export interface ModelDescriptor {
  /** 上游模型标识，例如 `qwen-audio-3.0-realtime-plus`。 */
  id: string;
  name: string;
  api: ModelApi;
  /**
   * 能接收的输入模态。
   *
   * 来自自动拉取时，上游 `/models` 通常**不返回**模态信息，因此这里会保守
   * 地只填 `['text']`；只有预置模板或管理员明确声明过的才带 `audio`。
   * 不要为了让界面好看而猜——猜错会让「语音输入」在运行时报错。
   */
  input: ModelModality[];
  /** 能产出的输出模态。同上，拉取来的保守填 `['text']`。 */
  output: ModelModality[];
  contextWindow: number | null;
  maxTokens: number | null;
  /** `fetched` = 来自上游 `/models`；`manual` = 管理员手填。 */
  source: 'fetched' | 'manual';
}

export interface ProviderAuthPublic {
  /** 服务端是否已持有可用密钥。 */
  configured: boolean;
  /** SHA-256 前 12 位；**不是**密钥本身。 */
  keyFingerprint: string | null;
}

export interface ProviderConfigPublic {
  id: string;
  name: string;
  baseUrl: string;
  api: ModelApi;
  /** true 时把密钥作为 `Authorization: Bearer` 头发送。 */
  authHeader: boolean;
  auth: ProviderAuthPublic;
  models: ModelDescriptor[];
  /** 最近一次成功自动拉取的时间。 */
  modelsFetchedAt: string | null;
  /** 最近一次拉取的错误（已脱敏，不含密钥）；成功时为 null。 */
  lastError: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** 预置模板，减少手填 `baseUrl` / 协议出错。 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: ModelApi;
  authHeader: boolean;
  /**
   * 便于在自动拉取不可用时先手选。**模态声明仍然要诚实**：
   * 这里只声明确实支持的通道。
   */
  suggestedModels: { id: string; name: string; input: ModelModality[]; output: ModelModality[] }[];
}

export interface AdminProvidersResponse {
  providers: ProviderConfigPublic[];
  presets: ProviderPreset[];
}

export interface UpsertProviderRequest {
  name?: string;
  baseUrl?: string;
  api?: ModelApi;
  authHeader?: boolean;
  /** 明文密钥，只在请求体出现一次；传空串表示清除。 */
  apiKey?: string;
}

/** `POST /admin/model-providers/:id/refresh` 的响应。 */
export interface RefreshProviderResponse {
  provider: ProviderConfigPublic;
  /** 本次拉取到的模型个数（0 表示上游没返回，或地址不对）。 */
  fetched: number;
}

/* ------------------------------ 用途绑定 ------------------------------ */

/** 归属的 agent，仅用于后台分组显示。 */
export type AgentId = 'tutor' | 'inspiration' | 'curriculum' | 'growth' | 'knowledge';

export interface ModelUsageSlot {
  /** 稳定的机器名，例如 `tutor.chat`。 */
  id: string;
  agent: AgentId;
  label: string;
  description: string;
  /** 该用途至少需要模型具备的输出模态。 */
  requiresOutput: ModelModality[];
  /**
   * 未显式绑定时的回落用途 id。
   *
   * 这样「只配一个模型也能把整个产品跑起来」，而不是逼管理员把十几个用途
   * 全填一遍。`null` 表示这个用途必须显式绑定。
   */
  fallbackTo: string | null;
}

export interface ModelUsageBinding {
  usageId: string;
  providerId: string | null;
  modelId: string | null;
  /**
   * 解析后实际生效的模型（已应用 `fallbackTo`）。
   * `null` 表示这个用途当前**没有**可用模型——调用方必须把它当作
   * 「该功能不可用」处理，而不是回落到某个硬编码默认值。
   */
  resolved: { providerId: string; modelId: string } | null;
}

export interface AdminModelUsagesResponse {
  usages: ModelUsageSlot[];
  bindings: ModelUsageBinding[];
}

export interface BindUsageRequest {
  providerId: string | null;
  modelId: string | null;
}

/** `GET /models/runtime` 里给四端看的「模型清单摘要」。 */
export interface ModelUsageRuntimeSummary {
  usageId: string;
  modelId: string | null;
  available: boolean;
}

/* ------------------------------------------------------------------ *
 * 手工模型管理（管理员）
 *
 * 自动拉取（`RefreshProviderResponse`）拿到的是上游真实模型；管理员也可以
 * **手工补一个**上游列表里没有、或上游没返回能力信息的模型。手工模型与
 * 拉取模型共存于同一个 `ProviderConfigPublic.models` 列表，靠
 * `ModelDescriptor.source` 区分，任何一侧的增删都不会覆盖另一侧。
 *
 * ⚠️ **`modelId` 与 `displayName` 的分工**：
 *  - `modelId` 是**上游真实 ID**，发对话请求时用它，创建后**不可更改**；
 *  - `displayName` 只是平台内展示名，管理员随时可改，**不影响实际请求**。
 * 因此更新请求里**没有 `modelId`**：想换上游模型只能禁用/删除后新建。
 * ------------------------------------------------------------------ */

/** `POST /admin/model-providers/:id/models` —— 手工新增一个模型。 */
export interface CreateManualModelRequest {
  /** 上游真实模型 ID，用于实际请求；同一 provider 下不可重复，创建后不可更改。 */
  modelId: string;
  /** 平台展示名，仅用于界面；不影响实际请求。 */
  displayName: string;
  /** 上游协议；缺省时沿用所在 provider 的 `api`。 */
  api?: ModelApi;
  /**
   * 能接收的输入模态。上游不返回能力时保守填 `['text']`；不要为界面好看而
   * 声明 `audio`／`image`，猜错会让运行时报错。
   */
  input: ModelModality[];
  /** 能产出的输出模态。同上，未知时默认 `['text']`。 */
  output: ModelModality[];
  contextWindow: number | null;
  maxTokens: number | null;
  enabled: boolean;
  idempotencyKey: string;
}

/**
 * `PATCH /admin/model-providers/:id/models/:modelId` —— 更新手工模型。
 *
 * **故意不含 `modelId`**：`modelId` 是不可变主键，改 ID 等于换了一个模型，
 * 会让已有用途绑定与审计记录指向不存在的东西。需要换上游模型时先禁用再新建。
 */
export interface UpdateManualModelRequest {
  /** 仅改展示名；`modelId`（实际请求用）保持不变。 */
  displayName?: string;
  api?: ModelApi;
  input?: ModelModality[];
  output?: ModelModality[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  /** 停用后不再参与用途解析，也不会被调用。 */
  enabled?: boolean;
  idempotencyKey: string;
}

/**
 * 单个模型的增量视图：`providerId` + `ModelDescriptor` 本体 + 运行状态。
 *
 * 兼容 `ProviderConfigPublic.models`：`model` 就是列表里的那个
 * `ModelDescriptor`（含 `id`／`input`／`output`／`contextWindow` 等），
 * 这里额外带上 `enabled`／`lastSeenAt`，让手工新增、编辑、启停后只需回传
 * 一个模型，而不必重发整个 provider。
 */
export interface AdminModelResponse {
  providerId: string;
  model: ModelDescriptor;
  /** 是否参与用途绑定与实际调用。 */
  enabled: boolean;
  /** 最近一次在上游列表中见到的时间；手工模型恒为 `null`。 */
  lastSeenAt: string | null;
}

/* ------------------------------------------------------------------ *
 * 连接测试（Provider / Model / Usage）
 *
 * 管理员保存后需要一键确认「这把 Key、这个地址、这个模型真的能通」。测试
 * 结果只回脱敏信息：**密钥永不出现**在 `message` / `error` 里，错误也只给
 * 已脱敏的原因，不返回上游原始响应体。
 * ------------------------------------------------------------------ */

/**
 * `POST .../test` 的统一响应。
 *
 * 三处入口共用：provider 级（`usageId`／`modelId` 均为 `null`）、model 级
 * （只填 `modelId`）、usage 级（填 `usageId`，并按解析结果填 `modelId`）。
 */
export interface ConnectionTestResponse {
  ok: boolean;
  /** 端到端往返耗时（毫秒）；失败时为 `null`。 */
  latencyMs: number | null;
  /** 面向管理员的一句话说明；无则 `null`。 */
  message: string | null;
  /** 已脱敏的错误说明；成功时为 `null`。**绝不含密钥或原始响应体**。 */
  error: string | null;
  testedAt: string;
  /** usage 级测试填该用途 id；provider／model 级为 `null`。 */
  usageId: string | null;
  /** model／usage 级测试填解析到的模型 id；provider 级为 `null`。 */
  modelId: string | null;
}
