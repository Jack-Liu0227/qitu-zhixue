# LLM 模型注册表（Provider → Model → Usage）

> 管理员接入多家 LLM：配置网关与密钥、拉取/手工维护模型、为每个用途绑定模型。
> 本文描述目标设计与当前实现，**未实现项已明确标注**。
> 关联：ADR 0007、`packages/contracts/src/models.ts`、
> `services/api/src/modules/model-registry/`、`docs/shared/PERMISSIONS.md`。

## 1. 三层模型

参照 `pi-ai` 的分层：**凭证属于供应商，能力属于模型，选择属于用途**。

```text
Provider（供应商）
  baseUrl · protocol(api) · auth · apiKey(仅指纹对外)
        │  1:N
Model（模型）
  id · name(显示名) · input[] · output[] · contextWindow · maxTokens · source
        │  N:M（经用途绑定）
Usage（用途）
  tutor.chat / tutor.live / inspiration.recommend / curriculum.plan /
  growth.summarize / knowledge.embed
```

- 换模型只动 Model / Usage，不动 Provider 凭证。
- 换网关只动 Provider，不动用途绑定。
- 用途未显式绑定且无 `fallbackTo` → 解析为 `null`，调用方必须把功能标记为「不可用」。

## 2. 协议适配（显式三种）

| 协议值 | 覆盖 | 模型列表 | 鉴权头 | 对话路径 | 流式差异 |
|---|---|---|---|---|---|
| `openai-completions` | OpenAI Compatible / Chat Completions | `GET {base}/v1/models` | `Authorization: Bearer` | `/v1/chat/completions` | `choices[].delta` + `[DONE]` |
| `openai-responses` | OpenAI Responses | 同上 | `Authorization: Bearer` | `/v1/responses` | 事件类型更丰富，需映射 |
| `anthropic-messages` | Anthropic Messages | 同上 | `x-api-key` + `anthropic-version: 2023-06-01` | `/v1/messages` | `content_block_delta` 等 |

**适配器职责**：模型列表地址拼装、鉴权头、请求体、流式事件 → 统一内部事件
（`TutorStreamEvent`）。上层（ai-tutor service / SSE）不感知协议差异。

> 约定：`baseUrl` 是网关根（如 `https://newapi.example.com`），协议层自行补 `/v1`；
> 若管理员已写 `/v1` 则不重复补。`authHeader=false` 时密钥按供应商约定放入请求体
> （Anthropic 走 `x-api-key`，不使用 Bearer）。

## 3. 模型发现：URL + Key 自动拉取

- 入口：`POST /api/v1/admin/model-providers/:id/refresh`（显式动作，非保存副作用）。
- 服务端用该 Provider 的 `baseUrl` + `apiKey` 请求上游 `/models`。
- 上游通常只返回 `id`，不返回模态与上下文长度：
  **自动拉取一律保守声明 `input=['text']` / `output=['text']`**，`contextWindow`/`maxTokens` 为 `null`。
- 只有预置模板或管理员明确声明的能力才带 `image` / `audio`。
- 拉取失败**不返回 4xx/5xx**，而是写 `provider.lastError` 并保留已配置模型，
  让管理员看到「已保存配置 + 失败原因」，页面不崩。
- 安全：`fetch-models.ts` 已挡链路本地与云元数据地址（SSRF 基础防线）；
  生产环境应再叠一层出站白名单。
- 超时 12s，响应体上限 512KB。

## 4. 手工模型与显示名（目标，部分未实现）

产品要求「模型名称 / 显示名称可自定义」「支持手工添加模型」。
当前实现状态：

| 能力 | 状态 |
|---|---|
| 预置模板自带 `suggestedModels`（含显示名） | **已实现** |
| 拉取结果用 `id` 兜底，若命中预置则用预置显示名 | **已实现** |
| Provider / Model / Usage 三层与用途绑定 | **已实现（live 落库，demo 内存）** |
| 重启后恢复 Provider / Model / 用途绑定 | **已实现** |
| **手工新增模型**（独立于模板） | **未实现**（当前只支持模板带入） |
| **编辑模型显示名** | **未实现**（无写接口） |
| **连接测试**（Provider / Model / Usage，`POST .../test`） | **已实现**（不落库、不审计、不执行推理） |

目标设计（待实现）：

- `ModelDescriptor.name` 即可编辑显示名；`id` 是上游标识，不可变。
- 手工模型 `source='manual'`，优先级高于拉取结果；同一 `id` 只出现一次，手填覆盖拉取。
- 手工模型必须由管理员显式声明 `input` / `output` 模态，未实测不得勾选 `audio`。

## 5. 连接测试（已实现）

管理员可在**不改动配置**的前提下验证「配置 / 认证 / 模型发现」是否连通。
这是**连通性探测**，不是一次真正的推理调用——所有成功文案都显式声明
「仅验证配置 / 鉴权 / 模型发现，未执行推理」。

端点（均要求管理员会话，权限全部服务端校验）：

```http
POST /api/v1/admin/model-providers/:providerId/test
POST /api/v1/admin/model-providers/:providerId/models/:modelId/test
POST /api/v1/admin/model-usages/:usageId/test
```

统一返回 `packages/contracts/src/models.ts` 的 `ConnectionTestResponse`（包在 `{ data }` 里）：

```jsonc
{
  "ok": true,
  "latencyMs": 42,          // 成功为往返毫秒；失败为 null
  "message": "…未执行推理", // 成功说明；失败为 null
  "error": null,            // 失败原因（已脱敏）；成功为 null
  "testedAt": "2026-…Z",
  "usageId": null,          // 仅 Usage 级回填
  "modelId": null           // Model / Usage 级回填
}
```

行为：

- **Provider 级**：用已保存的 `baseUrl` + 解密后的 Key + 协议适配路径，请求上游
  `/models`，验证网关可达、鉴权通过、模型列表可解析。
- **Model 级**：在 Provider 探测基础上，确认 `modelId` 出现在**已启用的已知 /
  手工模型**或**本次可拉取的上游模型列表**中。
- **Usage 级**：先按 `fallbackTo` **解析出实际生效的** provider/model，再按 Model
  级测试；未绑定（含回落）返回 `ok=false`，不是 404。
- 三种协议都走既有 `fetch-models.ts` 适配路径：`openai-completions` /
  `openai-responses` 用 `Authorization: Bearer`，`anthropic-messages` 用
  `x-api-key` + `anthropic-version`。
- 复用既有 SSRF / 超时（12s）/ 响应体上限（512KB）的 fetcher，不新增外部请求路径。
- **不修改** Provider / Model / Usage 配置、不写密钥、**不写审计**、不落
  `lastTest`（schema 无该列，只返回结果）。

失败语义（稳定、页面不 5xx）：

| 场景 | 结果 |
|---|---|
| 网络 / 超时 / 上游 4xx-5xx / 鉴权失败 / 模型不在上游列表 | `200` + `ok=false`，`latencyMs=null`，`error` 脱敏 |
| 供应商 / 模型被停用 | `200` + `ok=false`，`error` 明确「已停用」 |
| 用途未绑定且无回落 | `200` + `ok=false`，`error` 提示先绑定 |
| 已存密文但无法解密（缺 `QITU_MODEL_SECRET_KEY`） | `200` + `ok=false`，提示无法验证鉴权 |
| 供应商 / 用途不存在 | `404` |
| 未知模型（不在已知 / 可拉取，库中也不存在） | `404` |

安全：

- `error` 经 `redactConnectionError` 兜底，替换已知明文密钥与 `sk-…` / `Bearer …`
  形态；**绝不**返回上游原始响应体或带凭证的 URL。
- 日志（`kind` / `target` / `actor` / `ok` / `latencyMs` / 已脱敏原因）不含密钥，
  且该日志**不是**审计记录（连接测试不产生配置变更）。
- 与 `refresh` 的区别：`refresh` 会**发现并落库**模型列表；`test` 只读探测、
  不改动任何数据。

## 6. 密钥、审计、幂等与回滚

**密钥（已实现持久化加密）**

- 明文只在写请求体出现一次；`live` 下用 **AES-256-GCM** 加密后写
  `model_providers.encrypted_api_key`，格式 `v1:<iv>:<authTag>:<ciphertext>`（各段 base64url，iv 12B / tag 16B）。
- 主密钥只从环境变量 **`QITU_MODEL_SECRET_KEY`** 读取：32 字节，64 位十六进制或 base64。
  **绝不写入仓库、迁移或日志**。生成示例：`openssl rand -base64 32`。
- 缺少主密钥时，带 `apiKey` 的 `live` 写入返回 **503**（`ServiceUnavailableException`），
  不落明文、不假装成功；也不会留下任何半写入的行。
- 对外只返回 `configured` 与 `keyFingerprint`（SHA-256 前 12 位）。
- 日志只打印供应商 id、地址、模型数量与「密钥=已配置/无」，绝不打印密钥。
- `demo` / `test` **无 `DATABASE_URL`** 时保留进程内明文实现，仅用于显式演示 / 测试，
  **不适合 live**；`live` 无库由 `DatabaseModule` fail-fast。
- `secret_ref` 列已预留（可接密钥管理服务），当前未读写。
- 启动水合时：若库中存在密文但 `QITU_MODEL_SECRET_KEY` 缺失 / 格式错误，进程仍能启动，
  但会打印告警且**无法解密**该密钥（自动拉取将缺少凭证）；此时 `configured` 仍按「密钥已存储」
  显示（依据指纹），由后续 `refresh` 失败暴露鉴权问题。

**审计（已实现）**

- provider `upsert` / `delete`、usage `bind` / `unbind`：`live` 下与业务写入**同一事务**落 `audit_logs`。
- `refresh`：成功时同事务审计；失败时先保留旧列表并写 `last_error`，审计为 **best-effort**
  （不让审计故障把可恢复的上游失败升级成 5xx）。
- 审计 detail 不含明文密钥（`redactSensitive` 递归脱敏兜底）。
- `POST .../test` 连接测试**不写审计**：它不改配置、不改状态，只在服务日志留下
  `kind` / `target` / `actor` / `ok` / `latencyMs`（原因已脱敏）。

**幂等（未接入，已说明边界）**

- 本任务未接入写幂等：控制器未接收 `Idempotency-Key`。
- 若后续接入，scope 必须使用 provider / model / usage 维度（如 `model-provider:<id>`、
  `model-usage:<usageId>`），并以请求体指纹做冲突判定。
- 当前靠「upsert 语义」保证重复提交同一供应商 / 绑定不产生重复行；`refresh` 可重放。

**回滚 / 删除**

- 删除 Provider：在事务内**先显式解绑**引用它的用途绑定、删除其模型，再删 Provider——
  满足 FK `ON DELETE RESTRICT`，同时兑现前端「引用它的用途会被解绑」文案。
- `updatedAt` / `updatedBy` 记录最后修改者；配置版本历史回滚尚未实现。

## 7. API 与前端（当前实现）

后端（`services/api/src/modules/model-registry/`，**live 落 PostgreSQL**）：

```http
GET    /api/v1/admin/model-providers             供应商列表 + 预置模板
POST   /api/v1/admin/model-providers/:id         新建/更新供应商
DELETE /api/v1/admin/model-providers/:id         删除（并解绑用途）
POST   /api/v1/admin/model-providers/:id/refresh 自动拉取模型列表
POST   /api/v1/admin/model-providers/:id/test    连通性测试（配置 / 鉴权 / 模型发现）
POST   /api/v1/admin/model-providers/:id/models/:modelId/test
                                                 模型连通性测试
POST   /api/v1/admin/model-usages/:usageId/test  用途连通性测试（先解析回落）
GET    /api/v1/admin/model-usages                用途列表 + 当前绑定（含回落解析）
PATCH  /api/v1/admin/model-usages/:usageId       绑定/解绑用途
```

管理员前端：

- `/admin/settings/model-providers` 模型供应商（预置模板、自动拉取、密钥只写）
- `/admin/settings/model-usages` 模型用途绑定
- `/admin/settings/models` 旧的两个插槽（文本 / Live），将迁移下线

旧的 `ModelSettingsModule`（`packages/contracts/src/settings.ts`）与注册表并存：
前者按「插槽」配模型，后者按「用途」配模型。迁移到按用途取模型后下线旧插槽（ADR 0007）。

**持久化与重启恢复**

- `live` + `DATABASE_URL`：Provider / Model / UsageBinding 读写
  `model_providers` / `model_models` / `model_usage_bindings`（迁移 `0002`）。
- 进程启动时 `onModuleInit` 从库水合内存快照；重启后状态恢复。
  只读接口（`listProviders` / `getUsages`）因此保持同步，`admin.controller` 无需改动。
- 自动拉取：远程模型 upsert 到 `model_models`（`source='remote'`，对外映射为 `fetched`）；
  本次未返回的远程模型标记 `enabled=false`（软下线，不物理删除）；
  **手工模型（`source='manual'`）永不被刷新下线**。
- `demo` / `test` 无 `DATABASE_URL` 时用内存实现（显式降级，**非默认**）。

**尚未实现（本任务范围外）**

- 把运行时 `ModelGateway` **接入业务**：消费 `resolve(usageId)` 结果真正发起
  模型调用 / 流式对话（seam 已实现，见 §8；AI搭档 `tutor.chat` 非流式已接入，
  其余用途与流式仍未接线）。
- 手工新增模型、编辑显示名的写接口。
- 旧 `settings` / `ModelSettingsModule` 插槽与注册表的合并迁移。

## 8. 运行时 ModelGateway（seam 已实现，AI搭档 `tutor.chat` 非流式已接入）

> 代码：`services/api/src/modules/model-registry/model-gateway{,.types,.adapters,.errors}.ts`。
> 测试：`model-gateway.test.ts`（本地 mock 上游，覆盖三协议 / 脱敏 / 超时 / 取消 / 不可用）。

管理员配好 Provider + Model + Usage 后，业务模块需要真正发起 LLM 调用的统一入口。
接缝（seam）= 解析 → 适配 → 调用 → 归一化 + 脱敏。**首个业务调用方**是 AI搭档
对话（`tutor.chat`，非流式，见 §8.7）；成长档案 / 知识库 / 流式对话仍未接入。

分层：

```text
业务（后续：AI搭档 / 成长 / 知识库）
   │  complete(usageId, { messages, temperature?, maxTokens?, timeoutMs?, signal? })
   ▼
ModelGateway            ← 唯一入口；拿不到明文密钥
   ├ resolveRuntimeTarget(usageId)  ← ModelRegistryService 实现，含解密凭证（仅网关可见）
   ├ ProviderAdapter                ← 协议差异只在这里
   └ 超时 / 取消 / 错误脱敏 / 结果归一化
```

### 8.1 统一输入输出

- 输入：`ModelCompletionRequest` = `messages[{role: system|user|assistant, content}]`
  + 可选 `temperature` / `maxTokens` / `timeoutMs` / `signal`。
- 输出：`ModelCompletionResult` = `providerId` / `modelId` / `api` / `text` /
  `finishReason` / `usage{inputTokens,outputTokens,totalTokens}`。**不含任何凭证字段**。
- 三种协议差异（system 承载方式、`max_tokens` 必填、响应结构）在适配器内吸收，
  调用方只看到「文本进、文本出」。

### 8.2 用途解析与「不可用」

`ModelGateway` 通过 `resolveRuntimeTarget(usageId)` 解析：用途 → （含 `fallbackTo`）
绑定 → Provider（baseUrl / api / authHeader）→ Model → **解密后的密钥**。
任一层缺失都抛 `ModelGatewayError`（业务方把功能显式标为不可用，不静默回落到硬编码默认）：

| 错误码 | 场景 |
|---|---|
| `MODEL_USAGE_UNKNOWN` | 用途 id 不在注册表 |
| `MODEL_USAGE_NOT_BOUND` | 用途未绑定且无可用回落 |
| `MODEL_PROVIDER_NOT_FOUND` / `MODEL_PROVIDER_DISABLED` | 供应商不存在 / 已停用 |
| `MODEL_BASE_URL_MISSING` | 供应商无网关地址 |
| `MODEL_NOT_FOUND` / `MODEL_DISABLED` | 模型不存在 / 已停用 |
| `MODEL_CREDENTIAL_MISSING` | 无可用密钥或密文无法解密 |

### 8.3 协议请求 / 解析

| 协议 | 路径 | 请求体差异 | 响应文本 |
|---|---|---|---|
| `openai-completions` | `POST {base}/v1/chat/completions` | `messages` 直传 | `choices[0].message.content` |
| `openai-responses` | `POST {base}/v1/responses` | system → `instructions`，其余进 `input` | `output[].content[]` 中 `output_text`（跳过 `reasoning`），兼容顶层 `output_text` |
| `anthropic-messages` | `POST {base}/v1/messages` | system → `system`；`max_tokens` 必填（缺省 1024） | `content[].text` |

- 鉴权头统一走 `providerAuthHeaders()`：`Authorization: Bearer` 或
  `x-api-key` + `anthropic-version: 2023-06-01`；`authHeader=false` 时按协议处理。
- `baseUrl` 补 `/v1` 由 `protocolUrl()` 统一处理，已含 `/v1` 不重复补。

### 8.4 超时 / 取消 / 脱敏

- 超时：默认 30s，上限 120s；`AbortSignal.any([调用方 signal, AbortSignal.timeout])`。
  超时 → `MODEL_REQUEST_TIMEOUT`（可重试）；调用方取消 → `MODEL_REQUEST_ABORTED`。
- 上游非 2xx → `MODEL_UPSTREAM_HTTP_ERROR`（带 `upstreamStatus`，429/5xx 标记可重试）。
  **丢弃响应体**，避免夹带上游回显的请求内容 / 密钥；消息只含状态码。
- 响应体上限 2MB；非 JSON / 非法 → `MODEL_RESPONSE_INVALID`；空文本 → `MODEL_EMPTY_RESPONSE`。
- 明文密钥只在 `ModelGateway` 内构造请求头；**绝不**进入返回值、日志、错误或审计。
  日志只含 `usage / provider / model / api / 字数`。

### 8.5 流式 seam

`ModelGateway.stream(usageId, request)` 已按 `ModelStreamEvent`
（`text-delta` / `done` / `error`）预留事件形状，但**尚未接线**，调用时明确抛
`MODEL_STREAM_NOT_IMPLEMENTED`，绝不假装支持流式。

### 8.6 尚未接入的业务（明确边界）

- AI搭档：`tutor.chat`（非流式对话）**已接入** §8.7；`tutor.live`、语音、
  **上游流式**仍未接线。
- 成长档案（`growth.summarize`）、学习计划（`curriculum.plan`）。
- 知识库（`knowledge.embed`）：向量模型绑定与 pgvector 检索。
- 现有 `POST .../test` 连接测试**仍是独立只读探测**，不复用 `ModelGateway`，
  行为不变（不落库、不审计、不推理）。

### 8.7 AI搭档对话接线（`tutor.chat`，非流式）

> 代码：`services/api/src/modules/ai-tutor/gateway-tutor.provider.ts`。
> 测试：`gateway-tutor.provider.test.ts`（桩替 `ModelGateway`，不触网 / 不启库）。

`GatewayTutorProvider` 实现导师 `TutorProvider` 接口，把已配置模型接入苏格拉底
提示链路，**不改变**现有 SSE / 幂等 / 回放契约：

- 调用：`ModelGateway.complete('tutor.chat', { messages, temperature: 0.3, maxTokens })`。
  系统提示带服务端决定的提示档位与项目阶段；学生输入只进 user 消息，
  不含其他学生数据 / 联系方式等敏感字段。
- 提示阶梯：`selectHintLevel` 仍是**唯一**档位决策点（每轮最多 +1，第 5 档仅
  `explain`），模型无法跳档，`stage_after` / 档位均为服务端决定。
- 安全闸门：模型文本必须再过 `checkAnswerLeak`（泄露措辞 / 长度 / 引导档
  以问句结尾），不合规就替换为安全稿，再按 `splitIntoDeltas` 逐块下发。
- 工具事件**只记录真实发生的两步**：一次 `model.gateway.complete` 调用、
  一次 `safety.answer_leak.guard` 校验；**不伪造**项目上下文等未接入结果。
- 模式（`QITU_DATA_MODE`）：`live`（默认）→ `GatewayTutorProvider`；
  `demo` / `test` → 确定性的 `HeuristicTutorProvider`。
- 不可用语义：`tutor.chat` 未绑定 / 供应商 / 模型 / 凭证缺失 → 归一为
  `MODEL_NOT_CONFIGURED`；上游超时 / 5xx 等可重试 → `MODEL_UNAVAILABLE`；
  其它失败 → `MODEL_CALL_FAILED`。三者都以 `error` 事件（SSE `error` 帧）
  显式返回，**绝不静默回落到 Heuristic / demo**。错误只含稳定码与面向学生的
  短句，**不含** API Key 或上游正文。
- **流式未实现**：上游分片流未接线，`complete` 拿到整段文本后再逐块下发，
  不声明是上游流式。

## 9. 空态与错误策略

| 场景 | 表现 |
|---|---|
| 无供应商 | 用途页提示「先去模型供应商接入」，不给假选项 |
| 无模型 | 供应商卡片提示「点击自动拉取或从模板添加」 |
| 拉取失败 | 卡片显示 `lastError`，保留已有配置 |
| 用途未绑定 | Badge「未生效」；有 `fallbackTo` 则显示回落解析结果 |
| 连接测试失败 | 显示脱敏 `error` 与「不可用」，不跳错、不 5xx |
| 权限不足 | 403，提示用管理员账号登录 |
| 断网 | OfflineBanner，可重试 |

## 10. 验收标准

- [ ] 能用三种协议分别接入一个供应商并拉取到模型列表。
- [ ] 拉取失败时页面保留配置并展示脱敏原因，不返回 5xx。
- [x] 用途绑定不满足输出模态时被拒绝（400），而非运行时报错。
- [x] 无 `fallbackTo` 的用途解析为 `null`，前端显示「不可用」。
- [x] 密钥永不出现在响应、URL 或日志中（DB 中只存 AES-256-GCM 密文与指纹）。
- [x] Provider/Model/Usage 变更可审计（**可回滚仍未实现**）。
- [x] 连接测试（Provider / Model / Usage）返回 `ok/latencyMs/message/error`，失败
  `200 + ok=false` 且错误脱敏（含 `openai-responses` 路径测试）。
- [x] 运行时 `ModelGateway` seam：`complete(usageId)` 统一调用三种协议，超时 / 取消 /
  脱敏 / 用途回落与不可用错误码均有本地 mock 上游单测；密钥不出网关。
- [x] AI搭档 `tutor.chat`（非流式）接入 `ModelGateway`：`live/demo/test` provider
  选择、不可用错误语义、答案泄露闸门与脱敏均有单测（见 §8.7）。
- [ ] 其余业务（成长 / 知识库 / `tutor.live`）与**上游流式**接入 `ModelGateway`。

## 11. 未决事项

- [x] Provider / Model / UsageBinding 落库与迁移（迁移 `0002`）。
- [x] 密钥 AES-256-GCM 加密与缺主密钥 503 策略（`QITU_MODEL_SECRET_KEY`）。
- [x] Provider / Model / Usage 写操作审计（同事务；refresh 成功同事务、失败 best-effort）。
- [x] 连接测试接口（`POST .../test`，Provider / Model / Usage 三级）。
- [x] 运行时 `ModelGateway` seam（三协议非流式 `complete` + 脱敏；`stream` 未接线）。
- [x] AI搭档 `tutor.chat` 非流式接入 `GatewayTutorProvider`（`live` 默认走真实模型，
  未配置显式返回 `MODEL_NOT_CONFIGURED`，不静默回落）。
- [ ] 上游流式（`ModelGateway.stream`）与 `tutor.live` 接线。
- [ ] 手工新增模型与编辑显示名的写接口。
- [ ] `ModelGateway` 接入业务 + 流式实现（`ModelStreamEvent`）。
- [ ] 写幂等接入（provider / model / usage scope）。
- [ ] 密钥管理服务接入与密钥轮换（`secret_ref` 预留）。
- [ ] 旧两个模型插槽的迁移与下线路径。
- [ ] `knowledge.embed` 的向量模型绑定与 pgvector 检索链路（M4）。
