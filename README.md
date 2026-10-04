# 启途智学工程文档入口

> 更新：2026-10-04
>
> 当前实现基线：NestJS 模块化单体 + PostgreSQL + Redis/Worker。
> 文档优先级和历史资料说明见 [`docs/README.md`](./docs/README.md)。

## 首先阅读

1. [`AGENTS.md`](./AGENTS.md)：项目协作、安全和领域硬规则。
2. [`docs/README.md`](./docs/README.md)：五端与 SDK 文档索引、优先级和读取顺序。
3. 按责任域阅读 [`docs/admin/platform-governance.md`](./docs/admin/platform-governance.md)、[`docs/student/today.md`](./docs/student/today.md)、[`docs/teacher/dashboard.md`](./docs/teacher/dashboard.md)、[`docs/parent/home.md`](./docs/parent/home.md) 或 [`docs/sdk/overview.md`](./docs/sdk/overview.md)。
4. [`docs/admin/database.md`](./docs/admin/database.md)：数据真源、表归属和迁移。
5. [`docs/admin/permissions.md`](./docs/admin/permissions.md)：角色、对象级授权、错误码与审计。

## 当前文档分组

按平台二级目录组织，**每个具体功能一份 `.md`**：

- [Admin](./docs/admin/)：平台治理、控制面、模型注册表、权限、认证、目录与关系、数据库、初始化、部署。
- [Student](./docs/student/)：今天、灵感空间、AI搭档、我的项目、制作工作台、作品展厅、成长轨迹、学习计划。
- [Teacher](./docs/teacher/)：工作台、学生管理、问题处理、数据统计、知识库（planned）。
- [Parent](./docs/parent/)：首页、学习进展、消息与反馈、成长导出。
- [SDK](./docs/sdk/)：总览、Agent Runtime、浏览器客户端、领域 facade、Agent 记忆。

## 运行服务

本仓库目前是 Monorepo，不是预期的独立 `@qitu/sdk` 多包仓。启动边界如下：

```bash
# API + 四端前端
QITU_DATA_MODE=test tooling/start-qitu-services.sh start

# Graphiti 外部投影（需要 Docker + Neo4j + secret 环境变量）
export GRAPHITI_NEO4J_PASSWORD='local-only-secret'
export QITU_GRAPHITI_TOKEN='local-only-token'
tooling/qitu-graphiti.sh up
tooling/qitu-graphiti.sh init
export QITU_GRAPHITI_ENABLED=true
pnpm --filter @qitu/workers mastery:once
```

默认不启用 Graphiti。`services/graphiti` 是结构化 projection bridge，不是聊天记忆服务；
真实 round-trip 需要 Docker/Neo4j 和 `graphiti-core`，当前代码测试不会伪造该结果。


```text
过程证据 / 审计       PostgreSQL + Trajectory/L1
当前掌握 / 项目门槛   PostgreSQL mastery projection
掌握度时间线查询     MasteryTimelinePort，可选 Graphiti 投影
长期偏好事实         Mem0
阶段摘要 / 综合画像  自研 L2 / L3
```

Graphiti 不直接决定 `TheoryMastered`、实践解锁、项目状态或权限；Mem0 不保存掌握
level。具体事件模型、时间语义、迁移阶段和验收门以
[`docs/student/growth.md`](./docs/student/growth.md) §3 与
[`docs/sdk/agent-memory.md`](./docs/sdk/agent-memory.md) 为准。

## 文档维护

- 当前事实文档只放在 `docs/{admin,student,teacher,parent,sdk}/` 与 `docs/README.md`。
- 兼容文档、历史 ADR 与归档目录已删除；历史版本通过 git 历史保留。
- 新增能力必须是「当前实现事实」或明确标注的「planned」，并在对应平台的功能文档中维护。
