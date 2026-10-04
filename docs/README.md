# 启途智学文档总入口

> 更新：2026-10-05
> 当前实现基线：NestJS 模块化单体 + PostgreSQL + Redis/Worker + 四个 Next.js 前端。
>
> 本目录按**责任域**组织：`docs/<平台>/<功能>.md`。每个功能一个文件，
> 不再保留 ADR、设计稿、路线图、归档等历史/兼容文档。

## 阅读顺序

1. [`AGENTS.md`](../AGENTS.md)：项目协作、安全与领域硬规则（最高优先级）。
2. 本文件：产品基线、仓库架构、跨域硬规则、平台索引。
3. 按角色阅读对应平台入口：
   - 管理端：[`admin/platform-governance.md`](./admin/platform-governance.md)
   - 学生端：[`student/today.md`](./student/today.md)
   - 班主任端：[`teacher/dashboard.md`](./teacher/dashboard.md)
   - 家长端：[`parent/home.md`](./parent/home.md)
   - SDK：[`sdk/overview.md`](./sdk/overview.md)

## 平台与责任域

| 平台 | 目录 | 角色 | 说明 |
|---|---|---|---|
| 学生端 | `docs/student/` | `student` | 探索、AI搭档、项目、理论学习、制作工作台、作品、成长轨迹 |
| 班主任端 | `docs/teacher/` | `teacher` | 工作台、学生管理、问题处理、数据统计 |
| 家长端 | `docs/parent/` | `parent` | 授权投影下的成长快照、消息与反馈、导出 |
| 管理端 | `docs/admin/` | `admin` | 平台治理控制面、模型注册表、关系绑定、数据库、部署、权限 |
| SDK | `docs/sdk/` | — | Agent Runtime、领域 facade、浏览器 client、记忆 |

跨域基线（架构、权限、数据库、初始化、部署、登录）**不是**独立目录，而是分别归入
`docs/README.md`（架构与不变量）与 `docs/admin/`（权限、登录、数据库、初始化、部署）。

## 仓库架构

Monorepo（`pnpm workspace + Turborepo`），四端共用一套认证、API 合同、权限与数据模型。

```text
apps/            四个 Next.js 应用（student-center / teacher-workspace / parent-companion / admin-console）
packages/        共享能力（contracts / permissions / database / ai-client / auth / ui / design-tokens …）
services/        api（模块化单体）/ workers（异步任务）/ realtime-gateway / graphiti（可选投影）
database/        迁移产物 migrations/、确定性种子 seeds/、fixtures/
tooling/         启动、同步、端口约定
```

**硬边界：**

- 应用之间**禁止**互相导入业务代码；跨端共享只经 `packages/*`。
- 后端是模块化单体，按领域模块拆分，不提前拆微服务。
- 项目状态转换由 `projects` 领域统一写入；其他模块只能通过命令/领域事件请求变更。
- 家长授权、班主任分配、审计、幂等属于横切基础设施，业务页面不得各自实现。

## 领域边界（单一写入者）

每个领域模块是**各自数据的唯一写入者**；跨模块写只能走命令/事件/outbox。

| 领域 | 服务目录 | 负责 |
|---|---|---|
| Identity & Access | `identity-auth` / `account` / `directory` | 用户、角色、会话、家庭、监护关系、班主任分配、对象级授权 |
| Projects & Learning | `projects` / `learning-plan` / `mastery` | 模板版本、项目实例、阶段、任务、理论检查、状态机 |
| AI Tutor | `ai-tutor` / `agent-memory` | 会话、turn、context packet、提示等级、模型路由、卡顿检测 |
| Mentor Operations | `mentor` / `teacher` | 告警、问题、干预、班主任笔记、知识库 |
| Parent Experience | `parent` / `growth` | 授权脱敏投影、成长快照、消息与反馈、导出 |
| Admin & Compliance | `admin` / `platform-registry` / `platform-data` / `settings` / `templates` / `model-registry` / `knowledge` | 平台配置、AI 策略、审计、数据保留、敏感访问审批 |

依赖规则：

```text
apps → packages/contracts + packages/api-client + packages/ui
apps ✕ apps/* 业务代码
api modules → domain / application / infrastructure / presentation
api modules ✕ 直接写其他模块的表
cross-domain writes → command / event / outbox
parent reads → authorized projection only
```

## 跨域硬规则（所有平台必须遵守）

以下规则来自 `AGENTS.md`，任何平台文档与实现都不得违反：

1. **前端权限只负责显示**；所有对象级权限必须在后端再次校验（前端隐藏不是授权）。
2. 项目状态转换、AI 决策、成长档案、审计日志**不能由客户端直接写入**。
3. 一个学生同一时间只能有一个当前班主任（部分唯一索引保证）。
4. 学生**未确认意图**时不得创建正式项目。
5. `TheoryMastered` 之前不得进入实践阶段。
6. 涉及未成年人数据时，默认最小化可见范围并保留审计记录。
7. 所有写操作考虑幂等性，尤其项目、任务、作品、导师分配和干预操作。
8. 页面必须覆盖 loading / empty / error / 断网 / 权限失败五种状态。

## 文档维护规则

- 文档只能是「当前事实」或「明确标注的规划项」，不保留历史决策记录。
- 新增功能 → 在对应平台目录新增一个功能文件，并在本文件与平台入口登记。
- 不再使用的文档直接删除，不建立 `archive/`、`decisions/`、`shared/` 等兼容目录。
- 代码里的 `@see docs/...` 引用必须指向本目录中真实存在的文件。
