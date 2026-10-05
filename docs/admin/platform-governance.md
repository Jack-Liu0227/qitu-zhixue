# 平台治理（管理端总览）

> 责任域：Admin & Compliance。角色：`admin`。
> 管理端是**平台治理控制面**，不是班主任的日常工作面。

## 1. 责任范围

管理端负责账户与关系治理、AI 运行时、知识库、模板库、模型绑定、初始化状态、审计与合规。
**管理端不替代班主任处理单个学生的日常学习问题**。

## 2. 页面与导航（冻结）

`apps/admin-console` 使用 `basePath: '/admin'`，代码中的 `href` 是 basePath 相对路径。

| 导航 | 实际路径 | 说明 |
|---|---|---|
| 治理概览 | `/admin` | 平台总览、聚合指标 |
| 学生数据统计 | `/admin/students/statistics` | 聚合 / 治理投影 |
| 关系绑定 | `/admin/relationships` | 监护关系、班主任分配 |
| 模型与设置 | `/admin/settings` | 设置子导航入口 |

`/admin/settings` 下的子页面：

- `/admin/settings/ai-runtime`：运行时策略、已发布 Skill、Tutor Partner、内置工具、模型用途状态与初始化检查（见 [`control-plane.md`](./control-plane.md)）。
- `/admin/settings/knowledge`：知识文档摘要、版本、标签、状态、hash、正文长度；不展示未授权全文。
- `/admin/settings/templates`：模板版本、发布状态、阶段与验证状态。
- `/admin/settings/database`：连接状态、初始化检查与迁移提示；**迁移不经 HTTP 执行**。
- `/admin/settings/model-providers`：模型供应商接入（见 [`model-registry.md`](./model-registry.md)）。
- `/admin/settings/model-usages`：模型用途绑定。
- `/admin/settings/models`：旧的两个插槽（文本 / Live），迁移到按用途取模型后下线。

独立入口：`/admin/models`（模型总览）、`/admin/students`、`/admin/students/[studentId]`、
`/admin/teachers`、`/admin/teachers/[teacherId]`。

实现入口：`apps/admin-console/app/(console)`、`services/api/src/modules/{admin,platform-registry,platform-data,initialization,model-registry,settings,templates,knowledge}`。

## 2.1 数据来源与指标边界

管理端响应都带 `dataSource`：`live` 表示来自 PostgreSQL 的身份、项目和作品投影，`demo` 只表示显式演示模式的 `PlatformDataService` 种子数据。

当前 `live` 已接通：学生名册、班主任关系、正式项目数量、当前项目、项目阶段/进度、已完成项目数量、已发布作品数量。项目活动时间暂使用项目创建时间作为保守投影，不代表完整学习会话活跃度。

以下指标依赖尚未建成的干预/活动聚合表，在 `live` 中不再读取 demo 值：卡顿学生、待处理介入、教师近期开工时间、学生本周学习会话与分钟数。对应页面应显示“计划中/暂无数据”，不能把 `0` 解读为平台没有事件。审计与个别学生访问仍按本文件第 3 节的失败关闭规则执行。



平台治理与班级日常是两类工作，不能因为两者都能读到学生数据就混为一谈。

| 维度 | 班主任 `teacher` | 管理员 `admin` |
|---|---|---|
| 默认视图 | 自己名下学生的日常视图 | 聚合 / 治理视图 |
| 个别学生日常处理 | **是**（学生管理、问题处理、干预、项目复核、笔记） | **否**，不得默认进入 |
| 对象级范围 | `mentor_assignments(status=active, mentor_user_id=自己)` | 平台治理范围；个别学生需显式授权范围 |
| 全局配置权 | 无（不得改全局 AI 策略） | 模板、AI 策略、模型路由、审计、数据保留 |
| 账号与安全 | 跨角色账户面 | 同左 |

规则：

1. 管理员默认只看到**聚合 / 治理投影**（统计、覆盖率、分布、审计）；进入个别学生数据必须是显式动作，不能是默认落地页。
2. 管理员访问个别学生数据（含 `/admin/students/:id`）必须同时满足：
   - 对象级授权范围：本次访问限定到具体学生 / 资源；
   - 最小字段可见性：只返回该目的所需字段，默认不返回原始对话与原始语音；
   - 目的 / 原因：访问理由必填并落审计；
   - 敏感场景二次确认：原始对话、原始语音、导出等敏感读取需二次确认；
   - 审计：每次个别访问写 `audit_logs`；
   - 限时：授权范围带有效时间，过期即失效。
3. 班主任的个别学生权限来自关系（`mentor_assignments`），不是角色字符串；班主任不得修改全局 AI 策略、不得分配其他导师、不得删除原始学习数据。
4. **前端隐藏入口不构成授权**：无论管理端是否渲染「进入某个学生」的按钮，后端都必须重新判定。

> **当前实现状态**：上述「授权范围 / 目的 / 二次确认 / 限时 / 审计」模型尚未落地。
> `/admin/students/:id` 后端已收紧为**失败关闭**：在显式授权模型实现前，管理员请求
> 个别学生详情统一返回 `403`（规则见 `services/api/src/common/access/access-policy.rules.ts`
> 的 `canAdminReadIndividualStudent`）。聚合 / 治理视图与关系绑定不受影响。
> **在授权模型实现前，不得把管理员个别学生页当作已合规。**

## 4. AI 运行时边界

- 运行时只读取仓库根 `AGENTS.md` 与 `.agents/skills/**`。
- `.pi/agents`、`.pi/skills`、`.pi/settings.json`、`.pi/extensions` 是 Pi/Herdr **开发协作元数据**，永远不进入 Tutor runtime。
- Agent 列表来自 `tutor_partners` 与服务端注册信息，不展示开发角色。
- MCP 在接入安全 Registry 前保持空投影，不读取仓库开发配置。
- 内置工具只展示脱敏 descriptor；实际执行由 Tutor / Projects / Mastery / Growth / Worker owner 负责。
- 模型凭证只由服务端模型网关读取；前端不接触 API Key、完整系统提示词或上游原始响应。

详见 [`control-plane.md`](./control-plane.md)。

## 5. 管理操作规则

- 初始化接口必须 Admin 授权、幂等、审计；`database` 初始化检查只读，迁移由部署 / CLI 运维流程完成。
- 知识库与模板库是 Admin 治理资源；Teacher 不提供管理入口。
- 任何学生数据查看都遵守对象级授权、最小字段、目的限制与审计。
- 删除、失效、版本切换和模型绑定不能绕过 owner 服务、幂等与 outbox。

## 6. 状态与错误

- 页面与 API 必须覆盖 `loading` / `empty` / `error` / `offline` / `permission-denied`。
- 未认证返回 `401`；越权返回 `403`，**不得以空列表伪装成功**。
- 无法证实的状态显示 `unknown`，不得渲染为 `ready`。

## 7. 相关文档

- [`control-plane.md`](./control-plane.md)
- [`model-registry.md`](./model-registry.md)
- [`permissions.md`](./permissions.md)
- [`directory-and-relationships.md`](./directory-and-relationships.md)
- [`database.md`](./database.md)
- [`initialization.md`](./initialization.md)
- [`authentication.md`](./authentication.md)
