# 模型注册表与 Agent 运行时

模型注册表负责保存供应商凭证、供应商模型目录和连接能力。模型的实际使用者由 AI 运行时中的 Agent 配置直接指定，管理员不再维护独立的模型用途绑定页面。

## 分层

```text
Provider（供应商）
  baseUrl / protocol / encrypted credential
        |
        +-- Model（模型）
              id / display name / input[] / output[] / source

Agent Runtime
  AGENTS.md / role definition / providerId + modelId / Skills / Tools / MCP
```

凭证属于供应商，能力属于模型，模型选择属于 Agent。一个 Agent 可以不指定模型，此时运行时会把它标记为未配置；运行时不会从客户端输入、硬编码默认值或另一个 Agent 推断模型。

## 管理入口

| 页面 | 作用 |
|---|---|
| `/admin/settings/model-providers` | 保存供应商、加密 API Key、刷新模型目录和连接测试 |
| `/admin/settings/ai-runtime` | 为每个 Agent 选择供应商与模型，并配置 AGENTS.md、Skills、Tools、MCP |

模型注册表 API 仍提供 `/admin/model-usages` 的兼容读取和旧数据迁移能力。新代码不得把它作为运行时事实源，也不得在管理导航中暴露该路由。

## Agent 选择规则

- `modelProviderId` 与 `modelId` 必须同时设置或同时清空。
- 服务端只接受已登记的供应商和已启用的模型，并在每次模型调用前重新校验供应商、模型、凭证和对象权限。
- Agent 快照只返回供应商名、模型名、能力和可用状态，不返回 API Key、密文或原始上游响应。
- 旧 `agent_configs.model_usage` 和 `model_usage_bindings` 只用于一次性迁移及兼容旧 SDK；读取旧 Agent 时可回退 `tutor.chat`，保存 Agent 后以直接选择字段为准。

直接选择是 Agent 的运行时事实源：服务端把 `modelProviderId + modelId` 解析为 `agent.model`，调用前再次检查供应商、模型启用状态、能力和凭证。客户端只能提交管理员表单中的脱敏 ID，不能提交 provider URL、凭证或替代模型；清空选择时运行时返回 `MODEL_NOT_CONFIGURED`。

## API

```http
GET   /api/v1/admin/model-providers
POST  /api/v1/admin/model-providers/:id
POST  /api/v1/admin/model-providers/:id/refresh
POST  /api/v1/admin/model-providers/:id/test
POST  /api/v1/admin/model-providers/:id/models/:modelId/test
GET   /api/v1/admin/ai-runtime
POST  /api/v1/admin/ai-runtime/agents/:agentId
PATCH /api/v1/admin/ai-runtime/agents/:agentId
POST  /api/v1/admin/model-providers/import/pi/server
GET   /api/v1/admin/model-voice
```

Agent 创建和更新必须携带 `Idempotency-Key`。写入在服务端完成字段白名单、模型存在性、父 Agent 环、Skill/Tool/MCP 绑定和管理员权限校验，并写审计日志。

## ModelGateway

业务模块只调用 `ModelGateway.complete(usageId, request, selection?)`。当 Agent 传入 `selection={ providerId, modelId }` 时，网关调用 `resolveRuntimeTargetByModel`；旧调用方仍可按 `usageId` 解析。Agent 调用使用 `agent.model` 标识，清空模型后直接返回 `MODEL_NOT_CONFIGURED`，不会继续使用旧 `tutor.chat` 绑定。网关负责协议适配、超时、取消、响应大小限制、错误脱敏和结果归一化。

模型注册表仍保留 `tutor.chat` 等用途定义，是旧业务和迁移期的兼容边界，不是管理员配置页面，也不是 Agent 模型选择的事实源。

## Team Runtime 与候选投影

Team Runtime 的 Team Leader 和子 Agent 都使用各自 Agent 配置的直接模型。Leader 只能通过服务端 route 委派任务；任务消息进入 Agent mailbox，由 worker 租约领取，执行状态通过 `TeamEvent` 和 outbox 传播。profile、growth 等子 Agent 只能产生 `agent_projection_candidates`，领域服务负责校验、幂等接受、正式写入和审计。

## 安全与持久化

- live 模式使用 `QITU_MODEL_SECRET_KEY` 加密保存 API Key，只对外返回配置状态和指纹。
- Provider、Model、Agent 配置变更写入审计；测试请求不写入密钥或原始响应。
- `0016_agent_direct_model_selection.sql` 为已有 Agent 从旧 `tutor.chat` 绑定填充直接模型字段。
- 删除或停用供应商、模型前，服务端检查 Agent 直接引用和旧兼容绑定，避免运行时产生悬空配置。

## 从本地 Pi 复制初始化配置

Pi 是桌面开发环境，不挂载到服务器，也不把 `auth.json`、API Key 或 OAuth 文件提交到 Git。首次初始化时，运维人员把本地 Pi 的 `models.json`、`models-store.json` 和 `auth.json` 复制到服务器受限目录，并在服务进程中临时设置 `QITU_PI_CONFIG_DIR`。然后以管理员身份调用：

```text
POST /api/v1/admin/model-providers/import/pi/server
Idempotency-Key: <fresh-key>
```

导入会复用 provider 的加密存储路径，重复导入同一个 provider/model 会更新已有记录。API Key 只在导入请求和服务端进程内出现，数据库只保存加密值与指纹；OAuth access/refresh token 会被忽略。导入完成后应清除暂存目录和 `QITU_PI_CONFIG_DIR`，正常重启只从数据库恢复 provider/model。

如果暂存目录未配置、文件无效或没有可导入 provider，接口会返回 `PI_CONFIG_NOT_CONFIGURED`、`PI_CONFIG_INVALID` 或 `PI_CONFIG_EMPTY`，不会生成一个看似成功的空配置。
