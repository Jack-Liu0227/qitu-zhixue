# 启途智学工程文档入口

> 更新：2026-10-04
>
> 当前实现基线：NestJS 模块化单体 + PostgreSQL + Redis/Worker。
> 文档优先级和历史资料说明见 [`docs/README.md`](./docs/README.md)。

## 首先阅读

1. [`AGENTS.md`](./AGENTS.md)：项目协作、安全和领域硬规则。
2. [`docs/README.md`](./docs/README.md)：五端与 SDK 文档索引、优先级和读取顺序。
3. 按责任域阅读 [`ADMIN.md`](./docs/ADMIN.md)、[`STUDENT.md`](./docs/STUDENT.md)、[`TEACHER.md`](./docs/TEACHER.md)、[`PARENT.md`](./docs/PARENT.md) 或 [`SDK.md`](./docs/SDK.md)。
4. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 和 [`docs/DATABASE.md`](./docs/DATABASE.md)：跨模块边界、数据真源和迁移。
5. [`docs/decisions/`](./docs/decisions/)：已接受的架构决策记录。

## 当前文档分组

- [Admin](./docs/ADMIN.md)：平台控制面、AI 运行时、知识库、模板库、数据库和审计。
- [Student](./docs/STUDENT.md)：学生导航、探索、AI 搭档、项目、作品和成长轨迹。
- [Teacher](./docs/TEACHER.md)：班主任工作台、负责学生、问题处理和人工干预。
- [Parent](./docs/PARENT.md)：家长授权投影、成长快照、消息和反馈。
- [SDK](./docs/SDK.md)：Agent Runtime、Tutor adapter、领域 facade 和浏览器 client。

详细系统文档：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)、[`docs/DATABASE.md`](./docs/DATABASE.md)、[`docs/DEPLOYMENT_AND_AGENTS.md`](./docs/DEPLOYMENT_AND_AGENTS.md)、[`docs/ROADMAP.md`](./docs/ROADMAP.md)。

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

## 历史资料

旧历史文档已清理；归档目录只保留清理政策说明。当前实现不应引用不存在的旧归档路径。
