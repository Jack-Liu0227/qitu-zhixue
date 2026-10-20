# 模板库与教学绑定

先读取 currentTemplate、currentVersion、versions、teamVersions。模板元数据、模板版本、团队版本、绑定各自有 ID；student project ID 不参与管理模板的身份匹配。

| action | input / 返回字段 |
| --- | --- |
| template.create | `{schoolId:null,slug,title,summary,...}`，仅 global。可选 domain、ageRange、difficulty、estimatedDurationMinutes、requiredMaterials、learningObjectives、outcomeForm、safetyNotes |
| template.update | `{id,patch}`，patch 不含 slug/schoolId，已发布元数据不能直接编辑 |
| template.version | `{templateId,sourceVersionId?,stages?,content?,contentPatch?,rubric?}`，返回新版本 id |
| binding.create | `{templateId,versionId,teamVersionId}`，返回草稿 binding id |
| binding.draft | `{templateId,versionId,bindingId,draft}`，保存 canonical 教学配置 |
| binding.validate | `{templateId,versionId,bindingId}`，返回 validation/errors |
| binding.activate | 同上，验证并通过既有模板审核门禁后才可 active |
| binding.retire | 同上加 reason，通过 owner 退役，不改历史项目 |

用 sourceVersionId 克隆当前内容，contentPatch 仅做顶层合并。例如只关联团队：

```json
{"id":"version","kind":"template.version","label":"创建配置版本","input":{
  "templateId":"<所选模板 ID>","sourceVersionId":"<所选版本 ID>",
  "contentPatch":{"linkedTeamId":{"$ref":"team.id"}}
}}
```

content 和 contentPatch 互斥。若修改 contentPatch.pbl，应提交完整的 pbl，保留原目标、阶段、curriculum profiles/themes/sessions、课时与完成门禁。stages 是展示阶段，不是课时列表。新增排期或调整 12/16 课时必须产生新模板版本；不得改写旧 optics-physical-inquiry:v1。linkedTeamId 只关联配置草稿，不是已发布团队版本或 active binding。

TeachingBundleDraft 字段：

```json
{
  "templateVersionId":"<新版本 ID>","teamVersionId":"<team.version 回执 ID>",
  "scheduleProfileId":"<该 pbl.curriculum.profiles 中的 ID>",
  "approvalPolicyVersion":"<runtimePolicy.version>",
  "roleMap":[{"roleSlotId":"<模板课程中的角色槽 ID>","memberId":"<团队版本成员 slotId>","purposes":["outline","session","dialogue"]}],
  "skillPins":[{"roleSlotId":"<角色槽>","canonicalId":"<已发布教学 Skill ID>","version":"<该 Skill 版本>","packageDigest":"<该 Skill 真实 SHA-256>"}],
  "toolIds":[{"roleSlotId":"<角色槽>","toolId":"<实际授权工具 ID>"}],
  "mcpServerIds":["ima-knowledge"],"knowledgeBaseIds":["<实际授权的上游 IMA KB ID>"],
  "modelByPurpose":{"<角色槽>":{"outline":{"modelProviderId":"<provider ID>","modelId":"<model ID>"},"session":{"modelProviderId":"<provider ID>","modelId":"<model ID>"},"dialogue":{"modelProviderId":"<provider ID>","modelId":"<model ID>"}}},
  "sessionRoutes":[{"sessionIndex":1,"roleSlotId":"<角色槽>"}]
}
```

示例中的路由只是一个条目形状，实际必须覆盖所选 schedule 的全部课时，不能将阶段序号当课时序号。modelByPurpose 按角色槽及用途嵌套；已发布团队的模型/技能 pins 必须与其真实快照一致，不能用当前助手新配置冒充旧版本。approvalPolicyVersion、成员 slotId、课程角色槽或 hash 缺失时先读取来源，必要时分轮完成，不编造。

roleMap.memberId 是团队版本的 slotId，roleSlotId 是模板课程角色槽；assignedAssistantId 是助手 ID。这三个字段不可混用。知识授权只引用当前 grant 支持的 IMA ID，新增库不会自动扩展历史项目。空数组表示不授予能力，不能当通配符。

| owner HTTP API | 说明 |
| --- | --- |
| GET/POST /api/v1/admin/project-templates | 读模板 / 创建元数据 |
| PATCH /api/v1/admin/project-templates/:id | 元数据 patch |
| GET/POST /api/v1/admin/project-templates/:id/versions | 读正文 / 创建版本。直接 POST body 为 stages/content/rubric，不支持管家 sourceVersionId/contentPatch 封套 |
| GET /api/v1/admin/project-templates/:id/versions/:v/bindings/preview | 当前 activeBinding 及影响范围，仅用于治理 |
| POST .../:id/versions/:v/bindings | `{teamVersionId}` |
| GET/PATCH .../:id/versions/:v/bindings/:b/teaching-bundle | 读现有草稿 / PATCH body 为 TeachingBundleDraft 本身 |
| POST .../:id/versions/:v/bindings/:b/validate | 校验 |
| POST .../:id/versions/:v/bindings/:b/activate | 激活 |
| POST .../:id/versions/:v/bindings/:b/retire | `{reason}` |

表格中的 `...` 都指 `/api/v1/admin/project-templates`；写操作均带 Idempotency-Key。回读 binding 的实际 status、validation、bundleDigest/hash。未审核的版本可以保存配置，激活仍由原治理流程校验，不注入验证成功证据。

## 课时测试、发布与删除

| action | input / 检查 |
| --- | --- |
| template.test | `{templateId,versionId}`。读取真实 content.pbl，验证 curriculum/profiles/sessions 和四阶段顺序，返回各 profile 的课时数量；无课时合同不能假称为课时模板 |
| template.verify | 同上。原 owner 从已有学习/作品/导师事实评测；证据未满足时检查失败 |
| template.publish | 同上，可加 reason。原 owner 再评测真实发布证据；不能凭配置测试通过发布 |
| template.archive | `{templateId,reason}`。退出可选范围，保留版本和历史项目 |
| template.delete | `{templateId}`，仅 global。只允许未发布草稿；项目、计划、验证、绑定等引用由存储外键继续阻止物理删除 |

对应 HTTP 为 `POST /api/v1/admin/project-templates/:id/versions/:v/verify`、`.../publish`、`POST /api/v1/admin/project-templates/:id/archive` 和 `DELETE /api/v1/admin/project-templates/:id`。管家 verify/publish 不接受 mastery、作品审核或 completedProjectIds 等客户端证据。

同一生命周期建议分轮创建、校验/发布、归档/删除。资源删除后，旧创建回执的“当前资源回读”可能不再可用，这不会重新创建已完成资源。历史内容保留使用归档，不能为了清理配置而级联抹除学习记录。
