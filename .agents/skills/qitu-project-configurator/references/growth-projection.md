# 画像与成长用途助手

读取 growthProjectionSettings 的 revision/settings，以及其中 owner 返回的 assistants 可选清单。用途助手要求助手与对应运行时 Agent 都启用，不能仅依据普通助手目录的 enabled 字段。此模块配置“由哪个助手提出候选分析”，不生成或接受学生画像事实。

唯一 action 为 growth.projection.configure，只允许 global：

```json
{"id":"growth","kind":"growth.projection.configure","label":"配置画像与成长用途助手","input":{
  "expectedRevision":7,
  "settings":{"profileAssistantId":"<已启用的画像助手 ID>","growthAssistantId":"<已启用的成长助手 ID>"}
}}
```

7 是示例，执行时替换为当前 revision。null 表示停用该用途。settings 是完整用途配置，修改其中一个时保留另一项。引用新建助手可以使用 `$ref:"profile.id"`；助手的模型、技能与只读工具另由 assistant.create/update 管理。

| owner HTTP API | body / 回读 |
| --- | --- |
| GET /api/v1/admin/growth-projection/settings | revision、settings 与用途 readiness |
| PATCH /api/v1/admin/growth-projection/settings | `{expectedRevision,settings}`，带 Idempotency-Key |

配置成功后核对真实 revision 和两个助手 ID。生成候选、growth owner 验证接受、学生端结果展示是后续状态，不能把 readiness 或助手保存回执当分析已经完成。管家不得写学生成长分数、个人画像字段、原始对话、mastery 或审计记录。
