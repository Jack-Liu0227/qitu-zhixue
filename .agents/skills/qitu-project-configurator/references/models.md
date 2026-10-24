# 模型提供商、目录和助手选模

先看 models 的 providerId/modelId、available、input/output。管家对话需要文本输入和输出，embedding/audio/image 专用模型不能用于配置对话。相同 modelId 在不同提供商下是两个选择。

| action | input |
| --- | --- |
| model.provider | `{id,name?,baseUrl?,api?,authHeader?,enabled?}` |
| model.create | `{providerId,modelId,displayName,api?,input?,output?,contextWindow?,maxTokens?,enabled?}` |
| model.update | providerId/modelId 标识现有模型，其余为可写元数据 |

这三类为 global 操作。api 使用服务端支持的协议，如 openai-completions/openai-responses/anthropic-messages/google-gemini，以实际目录为准。模态为 text/image/audio/embedding；contextWindow/maxTokens 是受 owner 验证的正整数，不凭品牌推算未验证的规格。

```json
{"id":"select","kind":"assistant.update","label":"设置概念助手模型","input":{
  "id":"<已有助手 ID>","expectedUpdatedAt":"<该助手当前 updatedAt>",
  "patch":{"modelProviderId":"<当前可用 provider ID>","modelId":"<该 provider 下可用 model ID>"}
}}
```

分配模型使用 assistant.update，并读取 assistants.md。model.update 只改目录元数据，不替代助手绑定。新提供商没有安全凭据时只能完成登记；用户在模型设置页填写凭据后，再探测并刷新可用目录。管家计划不接受 apiKey/token/password/headers/secretRef，不能请求用户把密钥发到聊天。

共享 provider 地址仅在用户明确要求时修改；已有凭据的 provider 地址变更被管家拒绝，须走模型设置安全流程。不得把模板或 Skills 用作保存密钥和路由 URL 的位置。

| owner HTTP API | body / 回读 |
| --- | --- |
| GET /api/v1/admin/model-providers | 读取提供商和配置状态，不返回凭据 |
| POST /api/v1/admin/model-providers/:id | 非秘密配置字段，安全凭据管理由原页面负责 |
| POST /api/v1/admin/model-providers/:providerId/models | body 去掉 action 的 providerId |
| PATCH /api/v1/admin/model-providers/:providerId/models/:modelId | body 去掉 providerId/modelId；按 owner 要求携带 Idempotency-Key |
| POST /api/v1/admin/model-providers/:providerId/models/:modelId/test | 后台专用真实模型探测 |
| GET /api/v1/admin/model-usages | 用途列表，当前未进入管家 action |
| PATCH /api/v1/admin/model-usages/:usageId | 后台专用用途配置，当前未进入管家 action |

回读目录中真实 provider/model 对、enabled、available、模态；保存目录不等于请求测试成功。新模型未出现在可用目录时不引用它发布团队。模型更换后，既有冻结团队与学生项目继续依各自版本合同运行。

`model.test {providerId,modelId}` 已接入原模型探测 owner，使用固定安全请求。失败返回失败检查，不返回“已保存”。同一请求的探测回执可复用；配置变动后要求新请求重测。model.delete {providerId,modelId} 复用模型 owner，仅删除未被用途、Agent 和教学绑定冻结配置引用的手工模型；等待管理员逐项二次确认。自动发现模型不能物理删除，使用现有 enabled=false 流程。provider.delete 仍未提供，供应商配置和凭据生命周期走原模型工作区。
