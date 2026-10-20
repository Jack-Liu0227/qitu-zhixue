# 助手配置

读取当轮 assistants、skills、tools、mcpServers、models。目录 ID 是引用依据，名称只用于展示。当前助手列表不向模型提供其他助手完整 instructions；若用户要求保留并改写未知提示词内容，应先取得原文，不凭描述重建覆盖。

| action | input 与约束 |
| --- | --- |
| assistant.create | 必填 name、description、role、instructions。name 为 1–40 字符，description 最多 500，role 最多 160，instructions 最多 20000 |
| assistant.update | `{id,expectedUpdatedAt,patch}`，timestamp 取目录或前序返回的 updatedAt。patch 仅含用户要求修改的字段 |

可写字段：name、description、role、instructions、avatar、modelProviderId、modelId、temperature、enabledSkills、toolIds、mcpServerIds、defaults、teamSelectable、sortOrder、enabled。temperature 为 0–2，sortOrder 为非负整数。id/source/deletable/agentStatus/createdAt/updatedAt 是服务端字段，不能提交到 patch。

示例，模型和 ID 需用当轮真实值替换：

```json
{"id":"coach","kind":"assistant.create","label":"创建光学概念助手","input":{
  "name":"光学概念助手","description":"使用授权材料帮助学生理解光学概念","role":"概念教练",
  "instructions":"先确认学生解释中的缺口，使用有来源的提示，不绕过理论门禁。",
  "modelProviderId":"<provider ID>","modelId":"<model ID>",
  "enabledSkills":["<已发布 teaching canonical ID>"],
  "toolIds":["knowledge_search","knowledge_read"],"mcpServerIds":[],
  "temperature":0.3,"enabled":true,"teamSelectable":true
}}
```

修改现有助手的技能，提交合并后的完整 enabledSkills 数组；保留未要求移除的项。toolIds 和 mcpServerIds 同理。模型字段必须成对设置，不能只传裸 modelId。模型不可用、技能未发布或工具不在服务端目录时先解决来源，不创建假名称。

新技能须先 skill.create → skill.publish，再用返回的 id 绑定。知识工具登记、逐库授权与平台总开关是不同配置，见 knowledge.md。mcpServerIds 只声明候选连接，不表示可发现或执行。普通教学助手不能绑定 runtime:admin 技能。

| owner HTTP API | body / 回读 |
| --- | --- |
| GET /api/v1/admin/ai-runtime/assistants | `{data:[assistant...]}` |
| POST /api/v1/admin/ai-runtime/assistants | body 为创建字段，带 Idempotency-Key |
| PATCH /api/v1/admin/ai-runtime/assistants/:id | body 为 patch 本身，不包 id/patch/expectedUpdatedAt；带 Idempotency-Key |
| GET /api/v1/admin/ai-runtime | 查看技能、工具、MCP 和运行时状态 |

管家 adapter 的 expectedUpdatedAt 比直接 PATCH 多一层并发约束。回读助手的实际字段、enabled、updatedAt，后续同一助手的修改引用上一步 updatedAt。助手配置保存不代表已被团队版本冻结，也不代表真实模型请求成功。
