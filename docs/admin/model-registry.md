# 模型注册表（Provider → Model → Usage）

> 管理员接入多家 LLM：配置网关与密钥、拉取 / 手工维护模型、为每个用途绑定模型。
> 实现：`services/api/src/modules/model-registry/`、`packages/contracts/src/models.ts`、
> `apps/admin-console/app/(console)/settings/model-providers|model-usages|models`。

## 1. 三层模型

**凭证属于供应商，能力属于模型，选择属于用途。**

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
- 用途未显式绑定且无 `fallbackTo` → 解析为 `null`，调用方必须把功能标记为「不可用」，不得静默回落硬编码默认。

## 2. 协议适配（显式三种）

| 协议值 | 覆盖 | 模型列表 | 鉴权头 | 对话路径 | 流式差异 |
|---|---|---|---|---|---|
| `openai-completions` | OpenAI Compatible | `GET {base}/v1/models` | `Authorization: Bearer` | `/v1/chat/completions` | `choices[].delta` + `[DONE]` |
| `openai-responses` | OpenAI Responses | 同上 | `Authorization: Bearer` | `/v1/responses` | 事件类型更丰富，需映射 |
| `anthropic-messages` | Anthropic Messages | 同上 | `x-api-key` + `anthropic-version: 2023-06-01` | `/v1/messages` | `content_block_delta` 等 |

适配器职责：模型列表地址拼装、鉴权头、请求体、流式事件 → 统一内部事件（`TutorStreamEvent`）。
上层（ai-tutor service / SSE）**不感知协议差异**。

约定：`baseUrl` 是网关根（如 `https://newapi.example.com`），协议层自行补 `/v1`；已写 `/v1` 不重复补。
`authHeader=false` 时密钥按供应商约定放入请求体（Anthropic 走 `x-api-key`）。

## 3. 模型发现（URL + Key 自动拉取）

- 入口：`POST /api/v1/admin/model-providers/:id/refresh`（显式动作，非保存副作用）。
- 服务端用该 Provider 的 `baseUrl` + `apiKey` 请求上游 `/models`。
- 上游通常只返回 `id`：**自动拉取一律保守声明 `input=['text']` / `output=['text']`**，`contextWindow` / `maxTokens` 为 `null`；只有预置模板或管理员明确声明的能力才带 `image` / `audio`。
- 拉取失败**不返回 4xx/5xx**，而是写 `provider.lastError` 并保留已配置模型。
- 安全：`fetch-models.ts` 已挡链路本地与云元数据地址（SSRF 基础防线）；生产应再叠出站白名单。
- 超时 12s，响应体上限 512KB。

## 4. 手工模型与显示名

| 能力 | 状态 |
|---|---|
| 预置模板自带 `suggestedModels`（含显示名） | 已实现 |
| 拉取结果用 `id` 兜底，命中预置则用预置显示名 | 已实现 |
| Provider / Model / Usage 三层与用途绑定 | 已实现（live 落库，demo 内存） |
| 重启后恢复 Provider / Model / 用途绑定 | 已实现 |
| 手工新增模型（独立于模板） | **未实现** |
| 编辑模型显示名 | **未实现**（无写接口） |
| 连接测试（Provider / Model / Usage） | 已实现（不落库、不审计、不执行推理） |

目标设计：`ModelDescriptor.name` 即可编辑显示名，`id` 是上游标识不可变；手工模型 `source='manual'` 优先级高于拉取结果；手工模型必须显式声明 `input` / `output`，未实测不得勾选 `audio`。

## 5. 连接测试（已实现）

连通性探测，**不是**真正的推理调用；成功文案显式声明「仅验证配置 / 鉴权 / 模型发现，未执行推理」。

```http
POST /api/v1/admin/model-providers/:providerId/test
POST /api/v1/admin/model-providers/:providerId/models/:modelId/test
POST /api/v1/admin/model-usages/:usageId/test
```

统一返回 `ConnectionTestResponse`（包在 `{ data }`）：

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

- **Provider 级**：用已保存的 `baseUrl` + 解密后的 Key + 协议适配路径请求 `/models`。
- **Model 级**：确认 `modelId` 出现在已启用的已知 / 手工模型或本次可拉取的上游列表中。
- **Usage 级**：先按 `fallbackTo` 解析出生效 provider/model 再测试；未绑定（含回落）返回 `ok=false`，不是 404。
- **不修改**任何配置、不写密钥、**不写审计**、不落 `lastTest`。

失败语义（稳定，页面不 5xx）：

| 场景 | 结果 |
|---|---|
| 网络 / 超时 / 上游 4xx-5xx / 鉴权失败 / 模型不在列表 | `200` + `ok=false`，`latencyMs=null`，`error` 脱敏 |
| 供应商 / 模型被停用 | `200` + `ok=false`，明确「已停用」 |
| 用途未绑定且无回落 | `200` + `ok=false`，提示先绑定 |
| 已存密文但无法解密（缺 `QITU_MODEL_SECRET_KEY`） | `200` + `ok=false`，提示无法验证鉴权 |
| 供应商 / 用途不存在 | `404` |
| 未知模型 | `404` |

安全：`error` 经 `redactConnectionError` 兜底，替换明文密钥与 `sk-…` / `Bearer …` 形态；**绝不**返回上游原始响应体或带凭证的 URL。该日志**不是**审计记录。

`refresh` 与 `test` 的区别：`refresh` 会**发现并落库**模型列表；`test` 只读探测。

## 6. 密钥、审计、幂等与回滚

**密钥（已实现持久化加密）**

- 明文只在写请求体出现一次；`live` 下用 **AES-256-GCM** 加密后写 `model_providers.encrypted_api_key`，格式 `v1:<iv>:<authTag>:<ciphertext>`（base64url；iv 12B / tag 16B）。
- 主密钥只从环境变量 **`QITU_MODEL_SECRET_KEY`** 读取：32 字节，64 位十六进制或 base64。**绝不写入仓库、迁移或日志**。生成示例：`openssl rand -base64 32`。
- 缺主密钥时带 `apiKey` 的 `live` 写入返回 **503**，不落明文、不假装成功，不留半写入行。
- 对外只返回 `configured` 与 `keyFingerprint`（SHA-256 前 12 位）。
- 启动水合：库中密文存在但主密钥缺失 / 格式错误时进程仍可启动，但打印告警且无法解密；`configured` 仍按指纹显示，由后续 `refresh` 失败暴露问题。
- `demo` / `test` 无 `DATABASE_URL` 时保留进程内明文实现，**不适合 live**。
- `secret_ref` 列已预留（可接密钥管理服务），当前未读写。

**审计（已实现）**

- provider `upsert` / `delete`、usage `bind` / `unbind`：`live` 下与业务写入**同一事务**落 `audit_logs`。
- `refresh`：成功同事务审计；失败先保留旧列表并写 `last_error`，审计为 **best-effort**。
- 审计 detail 不含明文密钥（`redactSensitive` 递归兜底）。
- `POST .../test` **不写审计**。

**幂等**：控制器未接收 `Idempotency-Key`；当前靠 upsert 语义保证重复提交不产生重复行，`refresh` 可重放。后续接入时 scope 用 provider / model / usage 维度。

**回滚 / 删除**：删除 Provider 时在事务内**先显式解绑**引用它的用途绑定、删除其模型，再删 Provider（满足 FK `ON DELETE RESTRICT`）。`updatedAt` / `updatedBy` 记录最后修改者；**配置版本历史回滚尚未实现**。

## 7. API 与前端

```http
GET    /api/v1/admin/model-providers             供应商列表 + 预置模板
POST   /api/v1/admin/model-providers/:id         新建/更新供应商
DELETE /api/v1/admin/model-providers/:id         删除（并解绑用途）
POST   /api/v1/admin/model-providers/:id/refresh 自动拉取模型列表
POST   /api/v1/admin/model-providers/:id/test    连通性测试
POST   /api/v1/admin/model-providers/:id/models/:modelId/test
POST   /api/v1/admin/model-usages/:usageId/test  用途连通性测试（先解析回落）
GET    /api/v1/admin/model-usages                用途列表 + 当前绑定（含回落解析）
PATCH  /api/v1/admin/model-usages/:usageId       绑定/解绑用途
```

**持久化与重启恢复**：`live` + `DATABASE_URL` 读写 `model_providers` / `model_models` / `model_usage_bindings`（迁移 `0002`）；`onModuleInit` 从库水合内存快照。自动拉取把远程模型 upsert（`source='remote'`，对外映射 `fetched`），本次未返回的远程模型标 `enabled=false`（软下线，不物理删除）；**手工模型（`source='manual'`）永不被刷新下线**。

旧的 `ModelSettingsModule`（`packages/contracts/src/settings.ts`）按「插槽」配模型，与按「用途」配模型的注册表并存，迁移完成后下线旧插槽。

## 8. 运行时 ModelGateway

接缝 = 解析 → 适配 → 调用 → 归一化 + 脱敏。**首个业务调用方**是 AI搭档对话（`tutor.chat`，非流式）。

```text
业务（AI搭档 / 成长 / 知识库）
   │  complete(usageId, { messages, temperature?, maxTokens?, timeoutMs?, signal? })
   ▼
ModelGateway            ← 唯一入口；拿不到明文密钥
   ├ resolveRuntimeTarget(usageId)  ← 含解密凭证（仅网关可见）
   ├ ProviderAdapter                ← 协议差异只在这里
   └ 超时 / 取消 / 错误脱敏 / 结果归一化
```

- 输入 `ModelCompletionRequest`：`messages[{role: system|user|assistant, content}]` + 可选参数。
- 输出 `ModelCompletionResult`：`providerId` / `modelId` / `api` / `text` / `finishReason` / `usage`。**不含任何凭证字段**。

### 8.1 不可用错误码

| 错误码 | 场景 |
|---|---|
| `MODEL_USAGE_UNKNOWN` | 用途 id 不在注册表 |
| `MODEL_USAGE_NOT_BOUND` | 用途未绑定且无可用回落 |
| `MODEL_PROVIDER_NOT_FOUND` / `MODEL_PROVIDER_DISABLED` | 供应商不存在 / 已停用 |
| `MODEL_BASE_URL_MISSING` | 供应商无网关地址 |
| `MODEL_NOT_FOUND` / `MODEL_DISABLED` | 模型不存在 / 已停用 |
| `MODEL_CREDENTIAL_MISSING` | 无可用密钥或密文无法解密 |

### 8.2 请求 / 解析差异

| 协议 | 路径 | 请求体差异 | 响应文本 |
|---|---|---|---|
| `openai-completions` | `POST {base}/v1/chat/completions` | `messages` 直传 | `choices[0].message.content` |
| `openai-responses` | `POST {base}/v1/responses` | system → `instructions`，其余进 `input` | `output[].content[]` 中 `output_text`（跳过 `reasoning`） |
| `anthropic-messages` | `POST {base}/v1/messages` | system → `system`；`max_tokens` 必填（缺省 1024） | `content[].text` |

### 8.3 超时 / 取消 / 脱敏

- 超时：默认 30s，上限 120s。超时 → `MODEL_REQUEST_TIMEOUT`；调用方取消 → `MODEL_REQUEST_ABORTED`。
- 上游非 2xx → `MODEL_UPSTREAM_HTTP_ERROR`（带 `upstreamStatus`，429/5xx 可重试）；**丢弃响应体**，消息只含状态码。
- 响应体上限 2MB；非 JSON / 非法 → `MODEL_RESPONSE_INVALID`；空文本 → `MODEL_EMPTY_RESPONSE`。
- 明文密钥只在 `ModelGateway` 内构造请求头；**绝不**进入返回值、日志、错误或审计。日志只含 `usage / provider / model / api / 字数`。

### 8.4 流式 seam

`ModelGateway.stream(usageId, request)` 已按 `ModelStreamEvent`（`text-delta` / `done` / `error`）预留，
但**尚未接线**，调用时明确抛 `MODEL_STREAM_NOT_IMPLEMENTED`，绝不假装支持流式。

### 8.5 AI搭档对话接线（`tutor.chat`，非流式）

`services/api/src/modules/ai-tutor/gateway-tutor.provider.ts` 实现 `TutorProvider`，把已配置模型接入
苏格拉底提示链路，**不改变** SSE / 幂等 / 回放契约：

- 调用 `ModelGateway.complete('tutor.chat', { messages, temperature: 0.3, maxTokens })`；系统提示带服务端决定的提示档位与项目阶段，学生输入只进 user 消息。
- `selectHintLevel` 仍是**唯一**档位决策点（每轮最多 +1，第 5 档仅 `explain`）；模型无法跳档。
- 模型文本必须再过 `checkAnswerLeak`（泄露措辞 / 长度 / 引导档以问句结尾），不合规替换为安全稿，再按 `splitIntoDeltas` 逐块下发。
- 工具事件只记录真实发生的两步：一次 `model.gateway.complete`、一次 `safety.answer_leak.guard`；**不伪造**未接入结果。
- 模式：`live` → `GatewayTutorProvider`；`demo` / `test` → 确定性 `HeuristicTutorProvider`。
- 不可用语义：未绑定 / 缺凭证 → `MODEL_NOT_CONFIGURED`；超时 / 5xx → `MODEL_UNAVAILABLE`；其它 → `MODEL_CALL_FAILED`。三者以 SSE `error` 帧显式返回，**绝不静默回落**。
- **流式未实现**：`complete` 拿到整段文本后逐块下发，不声明是上游流式。

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

## 10. 验收与未决

- [ ] 能用三种协议分别接入一个供应商并拉取到模型列表。
- [ ] 拉取失败时保留配置并展示脱敏原因，不返回 5xx。
- [x] 用途绑定不满足输出模态时被拒绝（400）。
- [x] 密钥永不出现在响应、URL 或日志中。
- [x] Provider / Model / Usage 变更可审计（**可回滚未实现**）。
- [x] 连接测试失败 `200 + ok=false` 且脱敏。
- [x] `ModelGateway.complete` 统一三协议，超时 / 取消 / 脱敏 / 回落有单测。
- [x] AI搭档 `tutor.chat`（非流式）接入，不可用语义与泄露闸门有单测。
- [ ] 其余业务（成长 / 知识库 / `tutor.live`）与**上游流式**接入 `ModelGateway`。
- [ ] 手工新增模型与编辑显示名写接口。
- [ ] 写幂等接入（provider / model / usage scope）。
- [ ] 密钥管理服务接入与轮换（`secret_ref` 预留）。
- [ ] 旧两个模型插槽的迁移下线。
- [ ] `knowledge.embed` 的向量模型绑定与 pgvector 检索链路。
