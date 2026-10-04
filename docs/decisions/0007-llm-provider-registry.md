# ADR 0007：LLM 供应商注册表与协议适配

- 状态：**Accepted（协议分层与三层模型）**；持久化与连接测试为规划项
- 日期：2026-09-27
- 范围：模型接入（Provider → Model → Usage）、协议适配、密钥与拉取模型
- 关联：ADR 0002（AI Tutor 边界）、ADR 0003、`docs/admin/LLM_MODEL_REGISTRY.md`、产品文档 7.5

## 背景

管理员需要接入多家 LLM（OpenAI、Anthropic、DeepSeek、通义千问及自建中转）。
上游差异有两层：

1. **协议族不同**：`/v1/chat/completions`、`/v1/responses`、`/v1/messages` 的请求体与
   流式事件形状不同，不能用一个「万能请求」覆盖。
2. **能力发现不同**：多数网关的 `GET /models` 只返回 id，不返回模态与上下文长度；
   若把 id 当成完整能力，会在运行期才发现「语音输入不可用」。

同时管理员不希望在一个输入框里维护一长串模型名与密钥。

当前事实（Stage 1，主工作树未提交）：

- `services/api/src/modules/model-registry/` 已实现 Provider → Model → Usage 三层与
  `fetch-models.ts` 的自动拉取、`provider-presets.ts` 预置模板。
- 供应商与用途绑定目前**只存在于进程内存**，重启即丢；密钥同样不落盘。
- 管理员端已存在「模型供应商」「模型用途绑定」页面与接口；
  **尚无**连接测试接口、**尚无**手工新增模型的独立接口、**尚无**自定义显示名的写接口。
- 与旧的 `ModelSettingsModule`（「我的模型 / Live 模型」两个插槽）并存，尚未迁移。

## 决策

1. **采用三层模型**：Provider（网关 + 协议 + 凭证）→ Model（能力 + 显示名）→ Usage（用途绑定）。
   密钥只挂 Provider 一层；「换模型」不改凭证，「换网关」不改用途。
2. **显式支持三种协议**，并在适配器层收敛差异：
   - `openai-completions`：OpenAI Compatible / Chat Completions。
   - `openai-responses`：OpenAI Responses。
   - `anthropic-messages`：Anthropic Messages。
   协议适配器负责：模型列表地址、鉴权头、请求体、流式事件到内部事件的映射。
3. **模型列表以自动拉取为准，手填为补充**：`POST /admin/model-providers/:id/refresh`
   是显式动作，不是保存副作用；拉取失败写 `provider.lastError` 而**不**让整页失败。
4. **能力以「诚实声明」为准**：拉取结果一律保守声明 `['text']`；
   只有预置模板或管理员明确声明的才带 `image` / `audio`。宁可少声明，不可猜。
5. **用途绑定允许受控回落**：仅在 `fallbackTo` 显式声明时回落，**没有全局兜底**；
   解析不到就返回 `null`，调用方必须把该功能显式标记为「不可用」。
6. **密钥只写不回显**：明文只在写请求体出现一次，对外只给 `configured` 与指纹；
   日志不打印密钥。
7. **落库是目标**：Provider / Model / UsageBinding / 密钥引用最终要持久化（见未决事项），
   并记录 `updatedAt` / `updatedBy` 与审计。当前的内存实现是过渡态。

## 协议适配器差异（必须在实现中体现）

| 维度 | openai-completions | openai-responses | anthropic-messages |
|---|---|---|---|
| 模型列表 | `GET {base}/v1/models` | 同左 | `GET {base}/v1/models` |
| 鉴权头 | `Authorization: Bearer <key>` | 同左 | `x-api-key: <key>` + `anthropic-version` |
| 对话路径 | `/v1/chat/completions` | `/v1/responses` | `/v1/messages` |
| 请求体核心 | `messages[]` | `input`（响应对象语义） | `messages[]` + `system` 独立字段 |
| 流式事件 | `data: {choices:[{delta}]}` + `[DONE]` | 事件类型更丰富，需要映射到统一 delta | `content_block_delta` 等事件 |
| 工具调用 | `tool_calls` 增量 | 响应内 item 语义 | `tool_use` block |

统一映射到内部流式事件（见 `packages/ai-client` 与 `ai-tutor/tutor.provider.ts` 的
`TutorStreamEvent`），使上层不感知协议差异。

## 后果

**正面**

- 新增供应商只需实现/复用协议适配器与模板，不碰业务。
- 「协议 + 网关 + 密钥」配错集中在 Provider 一层，便于诊断。
- 能力声明与实际可用通道挂钩，避免运行期才报错。

**负面 / 风险**

- 三套协议适配器是维护成本；上游行为可能漂移（尤其 Responses）。
- 自动拉取是服务端代发请求，存在 SSRF 面，需要出站白名单（当前已有基础黑名单）。
- 内存态会在单实例重启后丢失配置，无法多副本一致。

## 落地步骤

1. 保持三层模型与三种协议；补连接测试接口。
2. 为 Provider / Model / UsageBinding 建表并落库，密钥以引用（secret ref）形式保存。
3. 增加审计与幂等（写操作携带 `Idempotency-Key`）。
4. 逐步把旧的两个模型插槽迁移到「按用途取模型」，再下线旧插槽。

## 明确不做

- 不把不同协议塞进一个「万能请求」。
- 不为了界面好看而声明未实测的模态。
- 不把明文密钥写入数据库明文列、日志或响应。

## 未决事项

- [ ] Provider / Model / UsageBinding 持久化（建表、迁移、审计）尚未实现。
- [ ] 连接测试（`POST /admin/model-providers/:id/test`）尚未实现。
- [ ] 手工新增模型、编辑模型显示名的独立接口尚未实现。
- [ ] 密钥库（secret manager）尚未接入；当前只保留指纹。
- [ ] 旧 `ModelSettingsModule` 两个插槽与注册表的迁移路径尚未定稿。
