/**
 * 模型供应商注册表与 Agent 运行时模型选择。
 *
 * 设计参照 Pi 的 `pi-ai` 模块，把一个「模型」拆成**三层**，而不是让管理员
 * 在一个输入框里填一串模型名：
 *
 *   1. 供应商 Provider —— `baseUrl` + 协议 `api` + 凭证。一个供应商对应
 *      一家网关或自己的中转，密钥只挂在这一层。
 *   2. 模型列表 ModelDescriptor[] —— 可以从 `baseUrl` **自动拉取**
 *      （见 `RefreshProviderResponse`），也可以手填。
 *   3. 兼容用途 ModelUsageBinding —— 旧版「AI搭档的普通回复」「灵感空间推荐」
 *      「成长总结」各自可以指到不同供应商/模型。
 *
 * 为什么值得拆三层：`pi-ai` 的 `createProvider({ baseUrl, auth, models,
 * fetchModels })` 就是这么做的——凭证属于供应商，能力属于模型，选择属于
 * Agent Runtime。旧用途结构保留用于迁移与兼容，不再是管理端事实源。
 *
 * 安全规则（沿用 `settings.ts`）：
 *  - 明文密钥只在写请求里出现一次，对外只给 `keyFingerprint`。
 *  - 日志只记供应商 id、地址与模型个数，**不记密钥**。
 */

/**
 * 上游协议族。决定拉模型列表与发起对话的请求形状。
 *
 * 四个值是**四种真实线协议**，不是供应商品牌：
 *  - `openai-completions`：`POST /v1/chat/completions`，模型目录 `GET /v1/models`；
 *  - `openai-responses`：`POST /v1/responses`，模型目录 `GET /v1/models`；
 *  - `anthropic-messages`：`POST /v1/messages` + `x-api-key`，目录 `GET /v1/models`；
 *  - `google-gemini`：**Gemini 原生 v1beta**，`:generateContent` /
 *    `:streamGenerateContent?alt=sse` + `x-goog-api-key`，目录
 *    `GET /v1beta/models`。用 OpenAI 兼容网关代理的 Gemini 模型应登记为
 *    `openai-completions` / `openai-responses`，不占用本协议值。
 */
export type ModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-gemini';

/** 模型能吃／能吐的模态。 */
export type ModelModality = 'text' | 'image' | 'audio' | 'embedding';

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
  /** 是否允许运行时使用该供应商。 */
  enabled: boolean;
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
  /** 是否允许运行时使用该供应商。 */
  enabled?: boolean;
  /** 明文密钥，只在请求体出现一次；传空串表示清除。 */
  apiKey?: string;
}

/** `POST /admin/model-providers/:id/refresh` 的响应。 */
/**
 * `POST /admin/model-providers/:id/refresh` 的响应。
 *
 * 同步只**更新已挂载模型的目录元数据**，不改变挂载集合（见
 * `docs/admin/model-registry.md` §5）：管理员勾选保存才是唯一的挂载/取消入口。
 */
export interface RefreshProviderResponse {
  provider: ProviderConfigPublic;
  /** 本次上游返回的模型总数（0 表示上游没返回，或地址不对）。 */
  fetched: number;
  /** 上游有、但本通道**未挂载**的模型；只报告，不写入。 */
  discovered: ModelDescriptor[];
  /** 本通道已挂载、但本次上游列表里已消失的模型；只报告，不自动删除。 */
  stale: ModelDescriptor[];
}

/* ------------------------------------------------------------------ *
 * 未保存供应商的模型发现探测（probe）
 *
 * 新建渠道表单里「获取模型」时，供应商还没有 id，不能走 `:id/refresh`。
 * 这个端点用**表单当前值**发起一次受 SSRF / 超时 / 响应体上限保护的
 * `/models` 拉取：密钥只在请求体出现一次，服务端不落库、不回显、不写日志。
 * 失败遵循连接测试的 `ok=false` 语义（HTTP 200），错误已脱敏。
 * ------------------------------------------------------------------ */

/** `POST /admin/model-providers/models/probe` 的请求体。 */
export interface ProbeModelsRequest {
  baseUrl: string;
  api: ModelApi;
  /** 明文密钥只在本请求体出现一次；服务端绝不持久化或回显。 */
  apiKey?: string;
  /** true 时把密钥作为 `Authorization: Bearer` 头发送（anthropic 协议忽略）。 */
  authHeader?: boolean;
}

/** `POST /admin/model-providers/models/probe` 的响应。 */
export interface ProbeModelsResponse {
  ok: boolean;
  /** 成功时为上游真实模型；失败时为空数组。**绝不回填任何预设模型**。 */
  models: ModelDescriptor[];
  /** 已脱敏的错误说明；成功时为 `null`。**绝不含密钥或原始响应体**。 */
  error: string | null;
}

/* ------------------------------------------------------------------ *
 * 模型挂载集合（管理员）
 *
 * 两条产品规则：
 *  1. **获取是只读的**。`POST :id/models/discover` 与 `models/probe` 一样，
 *     只替管理员发起一次上游 `/models` 发现，不落库、不挂载、不改任何状态；
 *     失败遵循 `ok=false` 语义并返回已脱敏原因，绝不回填预设模型。
 *  2. **保存才写入**。`PUT :id/models` 接收「期望挂载集合」，一次事务里
 *     新增缺失项、物理删除不在集合里的项。被 Agent 配置或兼容用途引用的
 *     模型一律整笔拒绝（409，`detail` 列出冲突模型），不做部分成功。
 * ------------------------------------------------------------------ */

/** `POST /admin/model-providers/:id/models/discover` 的响应。 */
export interface DiscoverProviderModelsResponse {
  providerId: string;
  ok: boolean;
  /** 上游真实模型；失败时为空数组。**绝不回填任何预设模型**。 */
  models: ModelDescriptor[];
  /** 已脱敏错误说明；成功时为 `null`。 */
  error: string | null;
  /** 其中已经挂载在本通道上的模型 id，供界面默认勾选。 */
  mountedIds: string[];
}

/** 期望挂载集合里的单个模型条目。 */
export interface ProviderModelSelection {
  /** 上游真实模型 ID（不可变主键的一部分）。 */
  modelId: string;
  /** 展示名；省略时回落到 `modelId`。 */
  displayName?: string;
  /** 输入模态；上游不说模态时保守填 `['text']`，不要猜 `audio`／`image`。 */
  input?: ModelModality[];
  /** 输出模态；同上。 */
  output?: ModelModality[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  /**
   * 来源标记：`remote` = 选自上游发现列表（默认），`manual` = 管理员手填。
   * 已存在的行保留其原来源，请求里的该字段只对新行生效。
   */
  source?: 'remote' | 'manual';
}

/** `PUT /admin/model-providers/:id/models` 的请求体。 */
export interface SetProviderModelsRequest {
  /** 期望的完整挂载集合；空数组表示清空该通道全部模型。 */
  models: ProviderModelSelection[];
  /** 与 `Idempotency-Key` 请求头二选一或保持一致（头优先）。 */
  idempotencyKey?: string;
}

/** `PUT /admin/model-providers/:id/models` 的响应。 */
export interface SetProviderModelsResponse {
  provider: ProviderConfigPublic;
  /** 本次新登记的模型 id。 */
  created: string[];
  /** 本次被物理删除（取消挂载）的模型 id。 */
  removed: string[];
  /** 本次只更新元数据、保持挂载的模型 id。 */
  kept: string[];
}

/* ------------------------------ 兼容用途绑定 ------------------------------ */

/** 归属的 agent，仅用于后台分组显示。 */
export type AgentId = 'tutor' | 'inspiration' | 'curriculum' | 'growth' | 'knowledge' | 'admin';

export interface ModelUsageSlot {
  /** 稳定的机器名，例如 `tutor.chat`。 */
  id: string;
  agent: AgentId;
  label: string;
  description: string;
  /** 该用途至少需要模型具备的输入模态。未声明表示只校验输出。 */
  requiresInput?: ModelModality[];
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

/** Shared purpose policy for API and background Agent execution. */
export const MODEL_USAGE_SLOTS: readonly ModelUsageSlot[] = [
  {
    id: 'admin.copilot', agent: 'admin', label: '启途智学管家 · 默认模型',
    description: '管家新对话自动使用的模型，由管理员选择并保存。',
    requiresInput: ['text'], requiresOutput: ['text'], fallbackTo: 'tutor.chat',
  },
  {
    id: 'tutor.chat',
    agent: 'tutor',
    label: 'AI搭档 · 对话',
    description: '启发式追问的主体模型，决定教学语气与提示阶梯。',
    requiresInput: ['text'],
    requiresOutput: ['text'],
    fallbackTo: null,
  },
  {
    id: 'tutor.live',
    agent: 'tutor',
    label: 'AI搭档 · 实时语音',
    description: '实时语音通道。需同时具备 audio 输入与输出才能启用「语音入→语音出」。',
    requiresInput: ['audio'],
    requiresOutput: ['audio'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'inspiration.recommend',
    agent: 'inspiration',
    label: '灵感空间 · 项目推荐',
    description: '按兴趣与掌握度推荐模板，要求低延迟。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'curriculum.plan',
    agent: 'curriculum',
    label: '学习计划 · 拆解',
    description: '把模板拆成逐课时路线与每阶段的理论、实践任务。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'growth.summarize',
    agent: 'growth',
    label: '成长档案 · 总结与建议',
    description: '把证据记录归纳成成长结论。只允许产出「建议」，不得直接写结论。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'knowledge.embed',
    agent: 'knowledge',
    label: '知识库 · 向量化',
    description: '切片向量化，供检索使用。必须是向量模型，不能填对话模型。',
    requiresOutput: ['text'],
    fallbackTo: null,
  },
];

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
  input: ModelModality[];
  output: ModelModality[];
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
 * 会让已有 Agent 选择、兼容用途绑定与审计记录指向不存在的东西。需要换上游模型时先禁用再新建。
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
  /** 是否参与兼容用途解析与实际调用。 */
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
