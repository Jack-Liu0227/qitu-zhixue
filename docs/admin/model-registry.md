# 模型 Provider、模型与 Agent 运行时

模型注册表是供应商、凭证状态、协议和模型目录的唯一事实源。模型用途绑定只保留旧 SDK 的兼容读取和迁移边界；新的 Agent 直接选择供应商与模型。

## 1. Provider 分层

```text
Provider
  baseUrl + protocol + encrypted credential + enabled
    └── Model
          id + displayName + input/output modalities + source + enabled
                └── Agent Runtime selection: providerId + modelId
```

当前支持的协议是 `openai-completions`、`openai-responses` 和 `anthropic-messages`。OpenAI-compatible / NewAPI 网关通常使用 `openai-completions`，模型目录通过 `GET /v1/models` 同步；同步只保存服务端允许的模型描述，不把 API Key 或原始上游响应返回浏览器。

## 2. 管理端页面与同步关系

| 页面                              | 事实与操作                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/admin/settings/model-providers` | 新建、编辑、启停 Provider；保存 base URL、协议和密钥；连接测试；刷新 `/models`；手动补充或编辑模型 |
| `/admin/settings/models`          | 从同一 Provider Registry 展开全部模型，按 ready/pending 筛选和测试；不维护第二份模型表             |
| `/admin/settings/ai-runtime`      | 为 Agent 选择直接的 `providerId + modelId`，配置角色定义、Tools、Skills 和 MCP                     |

模型页的 provider/model 列表来自 `GET /api/v1/admin/model-providers`；旧 `GET /api/v1/admin/model-usages` 只用于展示兼容绑定和迁移关联，不作为模型目录或运行时选择的事实源。新增、刷新、停用模型必须回到 Provider 页面完成。

Provider 页面参考 NewAPI 的 channel 思路：一个 Provider 记录一个网关地址、协议、密钥状态、模型目录和测试状态；多个模型共享同一 Provider 凭证，不为每个模型重复保存 URL 或 Key。

## 3. 管理 API

```http
GET    /api/v1/admin/model-providers
POST   /api/v1/admin/model-providers/:id
PATCH  /api/v1/admin/model-providers/:id
DELETE /api/v1/admin/model-providers/:id
POST   /api/v1/admin/model-providers/:id/refresh
POST   /api/v1/admin/model-providers/:id/test
POST   /api/v1/admin/model-providers/:id/models
PATCH  /api/v1/admin/model-providers/:id/models/:modelId
DELETE /api/v1/admin/model-providers/:id/models/:modelId
POST   /api/v1/admin/model-providers/:id/models/:modelId/test
GET    /api/v1/admin/ai-runtime
POST   /api/v1/admin/ai-runtime/agents/:agentId
PATCH  /api/v1/admin/ai-runtime/agents/:agentId
POST   /api/v1/admin/model-providers/import/pi/server
GET    /api/v1/admin/model-voice
GET    /api/v1/voice/capabilities
POST   /api/v1/voice/transcriptions
POST   /api/v1/voice/synthesis
```

Provider、模型和 Agent 写入都需要管理员权限；写操作使用 `Idempotency-Key`，服务端校验字段白名单、协议与模型能力、引用关系和审计记录。

## 4. 运行时选择规则

- `modelProviderId` 与 `modelId` 必须同时设置或同时清空。
- 服务端每次调用前重新确认 Provider、Model 已启用、协议匹配、凭证可用、Agent 有权限。
- Agent 清空模型时返回 `MODEL_NOT_CONFIGURED`，不能悄悄回退到 `tutor.chat` 或另一个 Agent 的模型。
- 浏览器只能提交脱敏 ID，不能提交 provider URL、凭证或替代模型。
- `ModelGateway.complete(usageId, request, selection?)` 仍兼容旧调用方；Agent 调用优先使用直接模型选择。

## 5. 连接与模型目录

连接测试只探测供应商声明的 `/v1/models`，使用对应协议的授权头并限制超时、响应大小和 SSRF 范围。刷新成功时远程模型更新为 `source=remote`；管理员手动补充的模型为 `source=manual`。远程刷新失败会保留上一次可用目录并记录 `lastError`，不能清空成“同步成功”。

Pi 配置导入只接受服务端受限目录中的 `models.json`、`models-store.json` 和 `auth.json`，导入时忽略 OAuth token；数据库只保存加密凭证和指纹。任何 API Key、Token 或 OAuth 文件都不能提交到 Git。

## 6. Team Runtime 与真实协同

Team Leader 和子 Agent 分别使用自身的直接模型。Leader 通过启用的 route 委派任务，服务端写入 mailbox；worker 以租约领取并执行，结果写入 task、message、event 和 outbox。profile/growth 等结果先进入候选投影，领域 owner 校验、幂等接受和审计后才成为正式数据。

## 7. 安全与未决事项

- live 模式使用 `QITU_MODEL_SECRET_KEY` 加密保存 API Key，只对外返回 configured 状态和指纹。
- Provider、Model、Agent 和测试操作写入审计；日志不得包含 API Key、原始模型响应或未脱敏学生对话。
- 删除或停用前检查 Agent 直接引用和旧兼容绑定，避免运行时出现悬空模型。
- [ ] 增加批量 Provider 健康检查和模型目录差异报告。
- [ ] 将旧 `model_usage_bindings` 迁移完成后删除兼容读取入口。
