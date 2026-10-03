# 启途智学工程文档入口

> 更新：2026-10-02
>
> 当前实现基线：NestJS 模块化单体 + PostgreSQL + Redis/Worker。
> 文档优先级和历史资料说明见 [`docs/README.md`](./docs/README.md)。

## 首先阅读

1. [`AGENTS.md`](./AGENTS.md)：项目协作、安全和领域硬规则。
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)：模块边界、依赖和当前系统架构。
3. [`docs/DATABASE.md`](./docs/DATABASE.md)：数据库真源、表 owner、迁移和权限。
4. [`docs/decisions/0009-mastery-timeline-and-graphiti.md`](./docs/decisions/0009-mastery-timeline-and-graphiti.md)：掌握度时间线和 Graphiti 的当前决策。
5. [`docs/AI平台架构交接文档.md`](./docs/AI平台架构交接文档.md)：接手开发、运行链路和未完成事项。

## 当前文档分组

### 产品与业务

- [`docs/AI教育平台前后端开发文档_v1.0.md`](./docs/AI教育平台前后端开发文档_v1.0.md)：产品导航、四端范围和业务规则。
- [`docs/AI平台任务完成进度.md`](./docs/AI平台任务完成进度.md)：当前实现进度和已合并能力。
- [`docs/ROADMAP.md`](./docs/ROADMAP.md)：工程路线图和掌握度专项路线。

### 架构与数据

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)：系统架构入口。
- [`docs/DATABASE.md`](./docs/DATABASE.md)：数据库和迁移入口。
- [`docs/decisions/`](./docs/decisions/)：已接受的架构决策记录。
- [`docs/AI导师统一架构与Agent记忆方案_v1.0.md`](./docs/AI导师统一架构与Agent记忆方案_v1.0.md)：Agent、Mem0 和上下文边界。
- [`docs/AI搭档SDK架构落地说明.md`](./docs/AI搭档SDK架构落地说明.md)：当前 AI 搭档 SDK/端口落地说明。
- [`docs/SDK与包结构现状.md`](./docs/SDK与包结构现状.md)：当前 SDK、包结构和预期差异。

### 工程与运维

- [`docs/DEPLOYMENT_AND_AGENTS.md`](./docs/DEPLOYMENT_AND_AGENTS.md)：部署和 agent 协作。
- [`docs/INITIALIZATION.md`](./docs/INITIALIZATION.md)：demo/live 初始化。
- [`docs/LLM_MODEL_REGISTRY.md`](./docs/LLM_MODEL_REGISTRY.md)：模型注册和用途绑定。
- [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)：权限边界。
- [`docs/ISSUES.md`](./docs/ISSUES.md)：问题和技术债登记。

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
level。具体事件模型、时间语义、迁移阶段和验收门以 ADR 0009 为准。

## 历史归档

历史提案、旧数据库草案、旧任务清单和 2024/2025 交付记录位于
[`docs/archive/legacy-2024-2025/`](./docs/archive/legacy-2024-2025/)。它们保留作背景
和追溯依据，但不代表当前技术实现，也不应作为新开发任务的入口。
