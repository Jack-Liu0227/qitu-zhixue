# 管家调用协议

应用入口为 `POST /api/v1/admin/copilot/turns`。必须使用 Admin 会话和 `Idempotency-Key`。浏览器使用已有登录态，不把 Cookie、Token 或 Key 写进对话、计划或示例。

```json
{
  "scope": "selected_template",
  "message": "为当前光学模板配置团队与知识工具",
  "history": [],
  "templateId": "<目录中的模板 ID>",
  "templateVersionId": "<该模板版本 ID>",
  "assistantId": "qitu-assistant",
  "teamId": null,
  "modelProviderId": "<可用提供商 ID>",
  "modelId": "<支持文本输入输出的模型 ID>",
  "permission": "full_access"
}
```

全局资源用 `scope=global`，templateId/templateVersionId 为 null。`selected_template` 仅可修改所选模板、服务端证明关联的助手/团队和本轮新建资源；在输入框选择 teamId 不能授予写权限。平台总配置、共享资源撤销与修改需 global。`read_only` 只回答和读取手册，不生成写 actions。预览其他助手不会执行管理动作。

模型最终返回：

```json
{"reply":"将创建教学助手，再加入团队。","actions":[
  {"id":"coach","kind":"assistant.create","label":"创建光学概念助手","input":{
    "name":"光学概念助手","description":"引导学生解释光学现象","role":"概念教练",
    "instructions":"按现有教学门禁追问，使用学生证据判断下一步。"
  }},
  {"id":"team","kind":"team.create","label":"创建光学团队","input":{
    "name":"光学项目团队","description":"光学项目教学协作",
    "leaderAssistantId":{"$ref":"coach.id"},
    "members":[{"assistantId":{"$ref":"coach.id"},"role":"leader"}]
  }}
]}
```

`$ref` 保留字段原类型，只能引用前序成功操作，例如 `coach.id`、`coach.updatedAt`、`skill.digest`、`base.revision`。上述未指定模型的助手仅创建配置；发布团队前必须配置实际可用模型。单轮最多 24 个 action，超出时分轮执行。不能在 input 中放未声明字段或通过字符串执行代码。

服务端为每步生成稳定幂等键，按 owner 写入后回读。只有 receipt.status=succeeded 才能报告该步已保存。failed 表示写入或回读未确认，blocked 表示依赖未成功。相同请求重试复用原计划与已完成写入；修改意图或修订冲突时重新读目录、生成新请求键，不能把旧键用于新内容。

能力和参考目录来自 `GET /api/v1/admin/copilot/capabilities`。references 只含路径、描述、操作与摘要，不包含正文；模型用 skill_read 按需读取。所有写 action 涉及的模块必须已读，服务端会校验。Skill 或参考摘要变化后，旧计划不继续执行。

常见错误：401/403 为登录或权限失败；`COPILOT_SCOPE_MISMATCH` 为范围不符；`COPILOT_INPUT_INVALID` 为字段或计划错误；`COPILOT_REFERENCE_REQUIRED` 为未读对应手册；`COPILOT_REFERENCES_UNAVAILABLE` 为资源包缺失或漂移；`COPILOT_PLAN_SKILL_CHANGED` 为执行依据变更。领域 revision 冲突需要回读，不覆盖别人刚保存的配置。

后文 HTTP 表格使用真实 owner 路径。管家 action 通常把 URL 中的 ID 放进 input，并额外要求 revision。直接 HTTP 的 body 不可照抄 action 封套，须按各模块说明展开。所有配置动作均不直接写学生项目、掌握度、作品审批或成长事实。

## 二次确认协议

所有 *.delete 及 mcp.invoke 返回 awaiting_confirmation receipt，携带 confirmation {id,expiresAt,target,impact,parameters}；尚未执行。管理员点击后由浏览器提交 POST /api/v1/admin/copilot/confirmations，body 为 {request:<原始请求>,turnKey:<原请求键>,actionId,confirmationId,decision:"confirm"|"cancel"}。它不是模型 action，不能在计划中生成确认字段或自动调用。凭据绑定管理员、参数、原计划及快照，十分钟失效；取消不可反悔复用同一凭据，源变化需新请求。未确认步骤的依赖 blocked。回执 cancelled 表示未执行。普通重试仍等待确认。
