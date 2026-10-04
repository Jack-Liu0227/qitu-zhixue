# 启途智学文档入口

> 更新：2026-10-04
>
> 本目录按责任域组织：`admin`、`student`、`teacher`、`parent`、`sdk` 五个二级目录是规范落点，`shared` 放跨责任域的系统基线，`decisions` 放 ADR，`archive` 只保留归档政策。实现、评审和部署默认从本页进入。

## 目录结构

```text
docs/
├── admin/       平台控制面、AI 运行时、模型注册表
├── student/     学生学习中心、AI 搭档、课程与掌握度设计
├── teacher/     班主任工作台
├── parent/      家长陪伴中心
├── sdk/         SDK 合同与 Agent 记忆设计
├── shared/      跨责任域系统基线：架构、数据库、权限、初始化、部署、路线、Issue、登录、团队与协作
├── decisions/   已接受的架构决策记录（ADR）
├── archive/     仅保留归档政策，不保留旧方案副本
└── README.md    唯一文档索引
```

| 文档 | 责任域 | 当前实现入口 |
|---|---|---|
| [admin/ADMIN.md](./admin/ADMIN.md) | 平台管理后台、AI 运行时、知识库、模板库、数据库状态、审计 | `apps/admin-console`、`services/api/src/modules/admin`、`platform-registry` |
| [student/STUDENT.md](./student/STUDENT.md) | 学生学习中心、探索、AI 搭档、项目、作品、成长轨迹 | `apps/student-center`、`services/api/src/modules/ai-tutor`、`projects` |
| [teacher/TEACHER.md](./teacher/TEACHER.md) | 班主任工作台、负责学生、问题处理、干预和项目复核 | `apps/teacher-workspace`、`services/api/src/modules/reminders`、`interventions` |
| [parent/PARENT.md](./parent/PARENT.md) | 家长授权投影、成长快照、反馈和消息 | `apps/parent-companion`、`services/api/src/modules/parent` |
| [sdk/SDK.md](./sdk/SDK.md) | Agent Runtime、Tutor context adapter、Qitu domain facade、浏览器只读 client | `packages/contracts`、`packages/ai-client`、`packages/api-client` |

各责任域目录内的补充文档：

- `admin/PLATFORM_CONTROL_PLANE.md`：Admin 控制面和运行时投影。
- `admin/LLM_MODEL_REGISTRY.md`：Provider、Model、Usage 和凭证边界。
- `student/student-agent-design.md`：学生 Agent 职责与边界设计。
- `student/student-frontend-backend-design.md`：学生端前后端模块和接口设计。
- `student/tutor-curriculum-design.md`：兴趣 → 4/8 周计划 → 先理论后实践的课程引擎设计。
- `student/deeptutor-source-verification.md`：课程设计的开源来源核对记录（2026-09-25，DeepTutor v1.6.11）。
- `sdk/AGENT_MEMORY.md`：Agent 记忆、上下文和策略边界设计。

## 系统基线（`shared/`）

- [ARCHITECTURE.md](./shared/ARCHITECTURE.md)：模块边界、依赖规则和数据权威。
- [DATABASE.md](./shared/DATABASE.md)：数据库、表 owner、迁移和数据权限。
- [PERMISSIONS.md](./shared/PERMISSIONS.md)：认证、角色和对象级授权。
- [INITIALIZATION.md](./shared/INITIALIZATION.md)：初始化、迁移和正式/演示模式。
- [DEPLOYMENT_AND_AGENTS.md](./shared/DEPLOYMENT_AND_AGENTS.md)：部署、运行时来源和 Agent 协作边界。
- [HANDOVER.md](./shared/HANDOVER.md)：模块清单、关键 API、环境配置和接手顺序。
- [ROADMAP.md](./shared/ROADMAP.md)：里程碑和迭代顺序。
- [ISSUES.md](./shared/ISSUES.md)：Issue 登记、验收标准和风险。
- [LOGIN.md](./shared/LOGIN.md)：统一登录入口和演示账号。
- [TEAM_SETUP.md](./shared/TEAM_SETUP.md)、[SHARED_PI_HERDR_AGENTS.md](./shared/SHARED_PI_HERDR_AGENTS.md)：团队分工、远程目录和 Agent 协作设置。

## 决策记录

- [ADR 0001–0010](./decisions/)：工程架构、领域边界、数据库访问层、成长轨迹导航、初始化与演示数据、领域模块存储、LLM Provider Registry、Admin/Teacher 边界、掌握度时间线、统一 Tutor 探索上下文。
- 重点：[ADR 0008](./decisions/0008-admin-teacher-boundary.md)、[ADR 0009](./decisions/0009-mastery-timeline-and-graphiti.md)、[ADR 0010](./decisions/0010-unified-tutor-exploration-context.md)。

## 读取规则

1. 先阅读 `AGENTS.md` 和本页。
2. 按任务责任域阅读对应目录的主文档。
3. 涉及跨模块边界时补读 `shared/ARCHITECTURE.md`、`shared/DATABASE.md` 和相关 ADR。
4. 涉及未成年人数据时必须同时检查 `shared/PERMISSIONS.md`、审计和字段投影要求。
5. 旧提案、旧技术栈、旧任务清单和兼容入口已删除，不再作为实现依据。

## 当前不变量

- 学生未确认意图不得创建正式项目。
- `TheoryMastered` 之前不得进入实践阶段。
- 项目状态、掌握度、成长档案、画像和审计不能由客户端或模型直接写入。
- 前端权限只负责显示，后端每次请求都重新做对象级授权。
- 一个学生同一时间只能有一个当前班主任。
- AI Agent 只能读取授权 projection，并返回结构化结果；不能持有数据库句柄。
