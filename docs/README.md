# 启途智学文档总入口

> 文档校验基线：2026-10-10，`main@772c601`。
>
> 当前实现：NestJS 模块化单体 + PostgreSQL + Redis/Worker + 一个公开官网/登录应用 + 四个角色应用。

## 阅读顺序

1. [`../AGENTS.md`](../AGENTS.md)：协作、安全和领域硬规则，优先级最高。
2. [`aboutus/README.md`](./aboutus/README.md)：产品定位、主页信息和 AI 与人共成长的叙事基线。
3. 本文件：仓库架构、责任域、跨域不变量和文档维护规则。
4. 按角色阅读入口：
   - 管理端：[`admin/platform-governance.md`](./admin/platform-governance.md)
   - 公开站点：[`admin/public-site.md`](./admin/public-site.md)
   - 学生端：[`student/today.md`](./student/today.md)
   - 班主任端：[`teacher/dashboard.md`](./teacher/dashboard.md)
   - 家长端：[`parent/home.md`](./parent/home.md)
   - SDK：[`sdk/overview.md`](./sdk/overview.md)

## 文档目录

| 目录       | 责任                                                         | 入口                                                             |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `aboutus/` | 产品定位、教育理念、公开主页信息                             | [`aboutus/README.md`](./aboutus/README.md)                       |
| `admin/`   | 平台治理、认证、数据库、部署、公开站点、模型和权限           | [`admin/platform-governance.md`](./admin/platform-governance.md) |
| `student/` | 灵感、AI 搭档、项目、学习计划、工作台、作品和成长            | [`student/today.md`](./student/today.md)                         |
| `teacher/` | 班主任工作台、学生、问题、统计和平台知识能力边界             | [`teacher/dashboard.md`](./teacher/dashboard.md)                 |
| `parent/`  | 授权成长投影、进展、消息和导出                               | [`parent/home.md`](./parent/home.md)                             |
| `sdk/`     | Agent Runtime、Team Runtime、领域 Facade、浏览器客户端和记忆 | [`sdk/overview.md`](./sdk/overview.md)                           |

`aboutus/` 是产品叙事目录，不是新的运行时责任域；接口、状态机和权限合同仍以对应平台文档和代码为准。

## 仓库架构

```text
apps/       auth-portal（官网/统一登录）
            student-center / parent-companion / teacher-workspace / admin-console
packages/   contracts / api-client / ai-client / auth / database / model-runtime /
            permissions / ui / design-tokens / validation ...
services/   api（模块化单体）/ workers / realtime-gateway / graphiti（可选投影）
database/   migrations / seeds / fixtures
tooling/    启动、同步、端口、基线校验和生产辅助脚本
```

四个角色平台共享认证、API 合同、权限和数据模型。公开官网只提供公开读接口和咨询写入口；它不绕过登录访问学生、家长或教师数据。

## 领域边界

| 领域                | 主要代码                                                                         | 单一写入职责                               |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Identity & Access   | `identity-auth` / `account` / `directory`                                        | 用户、会话、家庭、监护关系和班主任分配     |
| Projects & Learning | `projects` / `learning-plan` / `mastery`                                         | 模板、项目、阶段、任务、理论检查和门禁     |
| AI Tutor            | `ai-tutor` / `agent-memory`                                                      | 会话、上下文、教学动作和记忆候选           |
| Mentor Operations   | `mentor` / `teacher` / `feedback`                                                | 告警、干预、班主任笔记和反馈工单           |
| Parent Experience   | `parent` / `growth`                                                              | 授权脱敏投影、消息和导出                   |
| Admin & Compliance  | `admin` / `platform-registry` / `settings` / `model-registry` / `initialization` | 平台配置、模型、Agent、审计和初始化        |
| Team Runtime        | `team-runtime` / `workers`                                                       | route、mailbox、租约、任务、事件和候选投影 |
| Public Site         | `public-content`                                                                 | 公开首页聚合和咨询线索                     |

跨领域写入只能通过命令、领域事件或 outbox；家长只读授权投影，Team Runtime 结果必须回到领域 owner 校验后才成为正式事实。

## 跨域硬规则

1. 前端权限只负责显示；所有对象级权限由后端再次校验。
2. 项目状态、AI 决策、成长档案和审计日志不能由客户端直接写入。
3. 一个学生同一时间只能有一个当前班主任。
4. 学生未确认意图时不能创建正式项目。
5. `TheoryMastered` 之前不能进入实践阶段。
6. 未成年人数据默认最小可见范围，并保留敏感访问审计。
7. 项目、任务、作品、导师分配、干预和配置写操作都要考虑幂等性。
8. 页面必须覆盖 loading、empty、error、offline 和 permission-denied。

## AI 与模型事实源

模型供应商页面 `/admin/settings/model-providers` 负责供应商、协议、凭证状态、模型目录刷新和连接测试；模型页面 `/admin/settings/models` 从同一 provider registry 生成模型视图，不能维护第二份模型清单。Agent 在 `/admin/settings/ai-runtime` 直接选择 `providerId + modelId`，服务端在每次调用前重新校验供应商、模型、凭证和权限。

Team Runtime 的真实协同链路是：Leader 创建 run → 服务端 route 委派任务 → mailbox/租约由 worker 执行 → task/event/outbox 回传 → 领域 owner 校验候选结果。任何 mock 或 demo 数据必须明确标识，不能冒充真实协同结果。

## 文档维护

- 每个功能一个事实文档；规划内容明确标记，不用历史 ADR 代替当前合同。
- 新增页面、API、错误码、迁移、权限或异步任务时更新对应目录和本文件索引。
- 删除不再使用的文档，不创建 `archive/`、`decisions/`、`shared/` 等兼容目录。
- 所有 `@see docs/...` 和 Markdown 相对链接必须指向真实文件。
- 校验命令：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm check:basepath`。
