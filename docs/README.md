# 启途智学文档入口

> 更新：2026-10-04
>
> 本目录按五个责任域组织当前文档：`Admin`、`Student`、`Teacher`、`Parent`、`SDK`。实现、评审和部署默认从本页进入，不再把历史归档文档当作规范来源。

## 五端与 SDK

| 文档 | 责任域 | 当前实现入口 |
|---|---|---|
| [ADMIN.md](./ADMIN.md) | 平台管理后台、AI 运行时、知识库、模板库、数据库状态、审计 | `apps/admin-console`、`services/api/src/modules/admin`、`platform-registry` |
| [STUDENT.md](./STUDENT.md) | 学生学习中心、探索、AI 搭档、项目、作品、成长轨迹 | `apps/student-center`、`services/api/src/modules/ai-tutor`、`projects` |
| [TEACHER.md](./TEACHER.md) | 班主任工作台、负责学生、问题处理、干预和项目复核 | `apps/teacher-workspace`、`services/api/src/modules/reminders`、`interventions` |
| [PARENT.md](./PARENT.md) | 家长授权投影、成长快照、反馈和消息 | `apps/parent-companion`、`services/api/src/modules/parent` |
| [SDK.md](./SDK.md) | Agent Runtime、Tutor context adapter、Qitu domain facade、浏览器只读 client | `packages/contracts`、`packages/ai-client`、`packages/api-client` |

## 系统基线

- [ARCHITECTURE.md](./ARCHITECTURE.md)：模块边界、依赖规则和数据权威。
- [DATABASE.md](./DATABASE.md)：数据库、表 owner、迁移和数据权限。
- [PERMISSIONS.md](./PERMISSIONS.md)：认证、角色和对象级授权。
- [PLATFORM_CONTROL_PLANE.md](./PLATFORM_CONTROL_PLANE.md)：Admin 控制面和运行时投影。
- [INITIALIZATION.md](./INITIALIZATION.md)：初始化、迁移和正式/演示模式。
- [DEPLOYMENT_AND_AGENTS.md](./DEPLOYMENT_AND_AGENTS.md)：部署、运行时来源和 Agent 协作边界。
- [LLM_MODEL_REGISTRY.md](./LLM_MODEL_REGISTRY.md)：Provider、Model、Usage 和凭证边界。
- [AI搭档SDK架构落地说明.md](./AI搭档SDK架构落地说明.md)：Tutor 链路和代码位置补充。
- [SDK与包结构现状.md](./SDK与包结构现状.md)：包结构实现盘点。
- [AI导师统一架构与Agent记忆方案_v1.0.md](./AI导师统一架构与Agent记忆方案_v1.0.md)：记忆、上下文和 Agent 策略补充。
- [AI平台架构交接文档.md](./AI平台架构交接文档.md)：交接与运行链路补充。

## 决策记录

- [ADR 0008：Admin 与 Teacher 边界](./decisions/0008-admin-teacher-boundary.md)
- [ADR 0009：掌握度时间线与 Graphiti 投影](./decisions/0009-mastery-timeline-and-graphiti.md)
- [ADR 0010：统一 Tutor 探索上下文](./decisions/0010-unified-tutor-exploration-context.md)

## 读取规则

1. 先阅读 `AGENTS.md` 和本页。
2. 按任务责任域阅读五端文档或 `SDK.md`。
3. 涉及跨模块边界时补读 `ARCHITECTURE.md`、`DATABASE.md` 和相关 ADR。
4. 涉及未成年人数据时必须同时检查 `PERMISSIONS.md`、审计和字段投影要求。
5. 旧提案、旧技术栈和旧任务清单不再作为实现依据；当前仓库不保留历史 Markdown 副本。

## 当前不变量

- 学生未确认意图不得创建正式项目。
- `TheoryMastered` 之前不得进入实践阶段。
- 项目状态、掌握度、成长档案、画像和审计不能由客户端或模型直接写入。
- 前端权限只负责显示，后端每次请求都重新做对象级授权。
- 一个学生同一时间只能有一个当前班主任。
- AI Agent 只能读取授权 projection，并返回结构化结果；不能持有数据库句柄。
