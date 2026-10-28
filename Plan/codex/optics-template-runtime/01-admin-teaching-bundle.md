> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 01 · Admin Teaching Bundle

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 要解决的问题

现在管理员可以分别修改模板、团队、助手、Skills、MCP、知识库和模型，但学生确认项目时没有一个“同一版本合同”把这些配置一起冻结。必须把它们编译为一个不可变 bundle，而不是让 Tutor 在运行时按名称、标题或全局默认值猜配置。

## 复用的 owner 与代码位置

| 责任 | 现有 owner |
| --- | --- |
| 模板版本与课时 | `services/api/src/modules/templates`、`learning-plan` |
| 团队版本与成员 | `templates-binding`、`platform-registry`、`team-runtime` |
| canonical skills | `agentSkillBindings`、runtime catalog、`teaching-bundle.compiler.ts` |
| MCP/IMA | `ImaSettingsService`、`ImaMcpClient`、knowledge center |
| 模型 | `model-registry` / `ModelGateway` |
| 审计与幂等 | `AuditWriter`、`IdempotencyStore` |

## 建议改动

1. 在模板版本绑定编辑器中增加 bundle 草稿读写接口，草稿字段只允许引用 ID：
   `templateVersionId`、`teamVersionId`、`roleMap`、`skillPins`、`toolIds`、`mcpServerIds`、
   `knowledgeBaseIds`、`modelByPurpose`、`approvalPolicyVersion`。
2. 服务端通过 `compileTeachingBundle` 编译并计算 `bundleDigest`。编译失败返回稳定错误码，不能保存 warning-only 配置。
3. `pbl_template_team_bindings` 的 `bindingHash` 必须同时覆盖 `bundleDigest`；管理员修改任何成员、skill、MCP、知识库或模型都必须产生新 team/template version，不能原地覆盖已 active 版本。
4. `activate` 回读数据库中的 binding、bundle digest 和验证结果后再返回成功；部分失败、目录不可用、回读失败都明确显示。
5. 不在模板或浏览器中保存 provider secret、URL、token。`modelProviderId + modelId` 始终成对保存。

## API 形状

```text
GET   /api/v1/admin/project-templates/:templateId/versions/:versionId/teaching-bundle
PATCH /api/v1/admin/project-templates/:templateId/versions/:versionId/teaching-bundle
POST  /api/v1/admin/project-templates/:templateId/versions/:versionId/teaching-bundle/validate
POST  /api/v1/admin/project-templates/:templateId/versions/:versionId/teaching-bundle/activate
```

The implemented Admin endpoints are binding-scoped: append `/bindings/:bindingId/teaching-bundle` to the GET/PATCH paths. Validation and activation continue to use the existing `/bindings/:bindingId/validate` and `/bindings/:bindingId/activate` lifecycle routes.

所有写请求带 `Idempotency-Key`。响应必须返回 `status`、`bundleDigest`、`validation`、`replayed`，不能只返回“保存成功”。

## 验收条件

- 不存在 canonical skill、未发布 skill、未知 MCP tool、超出 IMA 知识库 grant、未绑定模型或虚假团队成员时，validate 必须失败。
- active binding 的 digest 与项目确认时写入的 snapshot digest 相同；运行时不按当前 Admin 配置回算历史项目。
- `resolveDeepTeamBinding` 和 Tutor 运行时只读取 frozen bundle；缺 snapshot/bundle 直接返回 `PROJECT_BINDING_RECONFIRM_REQUIRED` 或 `PROJECT_TEACHING_BUNDLE_UNAVAILABLE`。
