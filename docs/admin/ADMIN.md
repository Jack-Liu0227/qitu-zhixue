# Admin 平台管理后台

## 责任范围

Admin 是平台治理控制面，负责账户与关系治理、AI 运行时、知识库、模板库、模型绑定、初始化状态、审计和合规。Admin 不替代班主任处理单个学生的日常学习问题。

## 当前页面

- `/admin`：平台总览。
- `/admin/settings/ai-runtime`：运行时策略、已发布 Skill、Tutor Partner、内置工具和模型用途状态。
- `/admin/settings/knowledge`：知识文档摘要、版本、标签、状态、hash 和正文长度；不直接展示未授权全文。
- `/admin/settings/templates`：模板版本、发布状态、阶段和验证状态。
- `/admin/settings/database`：连接状态、初始化检查和迁移提示；数据库迁移不通过 HTTP 执行。

实现入口：`apps/admin-console/app/(console)`、`services/api/src/modules/admin`、`services/api/src/modules/platform-registry`、`services/api/src/modules/initialization`。

## AI 运行时边界

- 运行时只读取 `AGENTS.md` 和 `.agents/skills/**`。
- `.pi/agents`、`.pi/skills`、`.pi/settings.json` 和 `.pi/extensions` 是开发协作元数据，不进入 Tutor runtime。
- Agent 列表来自 `tutor_partners` 和服务端注册信息，不展示开发角色。
- MCP 未接入安全 Registry 前保持空投影，不读取仓库开发配置。
- 内置工具只展示脱敏 descriptor；实际执行由 Tutor、Projects、Mastery、Growth 或 Worker owner 负责。
- 模型凭证只由服务端模型网关读取，前端不接触 API Key、完整系统提示词或上游原始响应。

## 管理操作规则

- 初始化接口必须 Admin 授权、幂等、审计；`database` 初始化检查只读，迁移由部署或 CLI 运维流程完成。
- 知识库与模板库是 Admin 治理资源；Teacher 不提供管理入口。
- 任何学生数据查看都遵守对象级授权、最小字段、目的限制和审计。
- 删除、失效、版本切换和模型绑定不能绕过 owner 服务、幂等和 outbox。

## 状态要求

Admin 页面和 API 必须覆盖 `loading`、`empty`、`error`、`offline`、`permission-denied`。接口未认证时返回 `401`，越权访问不得以空列表伪装成功。

## 关联文档

- [SDK.md](../sdk/SDK.md)
- [PLATFORM_CONTROL_PLANE.md](./PLATFORM_CONTROL_PLANE.md)
- [INITIALIZATION.md](../shared/INITIALIZATION.md)
- [PERMISSIONS.md](../shared/PERMISSIONS.md)
- [ARCHITECTURE.md](../shared/ARCHITECTURE.md)
