# 启途智学文档索引

> 更新：2026-10-04
>
> 本页定义文档优先级，避免历史提案与当前工程基线同时指导实现。

## 当前决策源

| 文档 | 用途 | 状态 |
|---|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 模块边界、依赖规则、系统总架构 | 当前基线 |
| [`PLATFORM_CONTROL_PLANE.md`](./PLATFORM_CONTROL_PLANE.md) | 管理后台 AI 运行时只读投影、受限初始化端点、保留的开发期制品（`.pi`）与删除记录 | 当前基线 |
| [`DATABASE.md`](./DATABASE.md) | PostgreSQL、表 owner、迁移顺序和数据权限 | 当前基线 |
| [`decisions/0009-mastery-timeline-and-graphiti.md`](./decisions/0009-mastery-timeline-and-graphiti.md) | 掌握度时间线、事件、门槛和 Graphiti 定位 | 当前决策源 |
| [`decisions/0010-unified-tutor-exploration-context.md`](./decisions/0010-unified-tutor-exploration-context.md) | 学生端自由探索与项目辅导统一会话上下文 | 提案（待独立评审 + 全量构建后定稿） |
| [`AI平台架构交接文档.md`](./AI平台架构交接文档.md) | Agent 接手、运行链路、当前缺口和实施顺序 | 当前交接文档 |
| [`AI导师统一架构与Agent记忆方案_v1.0.md`](./AI导师统一架构与Agent记忆方案_v1.0.md) | Mem0、关系记忆、上下文和 Agent 边界 | 当前补充设计 |
| [`ROADMAP.md`](./ROADMAP.md) | 产品与工程阶段路线 | 当前路线图 |
| [`AI教育平台前后端开发文档_v1.0.md`](./AI教育平台前后端开发文档_v1.0.md) | 产品导航、业务规则和四端范围 | 产品基线 |

## 读取顺序

处理掌握度、成长轨迹、Graphiti 或 Mem0 任务时，按以下顺序读取：

1. `AGENTS.md` 和本索引；
2. `ARCHITECTURE.md`、`DATABASE.md`；
3. `decisions/0009-mastery-timeline-and-graphiti.md`；
4. 管理后台、初始化或运行时投影任务：`PLATFORM_CONTROL_PLANE.md`、`INITIALIZATION.md`；
5. 目标模块对应的交接文档、合同和测试；
6. 历史设计文档仅用于了解背景，不用于推翻当前决策。

## 当前记忆与掌握度分工

```text
过程证据 / 审计       PostgreSQL + Trajectory/L1
当前掌握 / 项目门槛   PostgreSQL mastery projection
掌握度时间线查询     MasteryTimelinePort，可选 Graphiti 投影
长期偏好事实         Mem0
阶段摘要 / 综合画像  自研 L2 / L3
```

Graphiti 不直接决定 `TheoryMastered`、实践解锁、项目状态或权限；Mem0 不保存掌握
level。详细规则以 ADR 0009 为准。

## 历史文档

历史资料统一位于 [`archive/README.md`](./archive/README.md) 和 `archive/legacy-2024-2025/`，不再放在当前文档入口目录。

- [`archive/legacy-2024-2025/AI搭档功能技术设计文档_v2.0.md`](./archive/legacy-2024-2025/AI搭档功能技术设计文档_v2.0.md)：历史 FastAPI/LangGraph/DeepTutor 提案。
- [`archive/legacy-2024-2025/架构速查表.md`](./archive/legacy-2024-2025/架构速查表.md)：历史 AI 搭档架构草图。
- `archive/legacy-2024-2025/文档交付总结_2025-01-09.md`、`任务完成确认_2025-01-09.md`、`项目更新总结_2025-01-09.md`：历史交付总结。
- `archive/legacy-2024-2025/任务分配清单_2025-01-09.md`、`立即执行清单.md`：历史任务和 SQL/模块草案。
- `archive/legacy-2024-2025/AI搭档功能需求澄清_v1.0.md`、`学生与班主任数据库设计_v1.0.md`：历史需求和数据库草案。
- `archive/legacy-2024-2025/任务完成总结_2024-09-29.md`、`三端同步方案_v1.0.md`、`turbo.json优化建议_v1.0.md`：历史总结和工程建议。
- `archive/legacy-2024-2025/DeepTutor功能迁移与AI参与设计文档.docx`：历史参考资料。
- `archive/legacy-2024-2025/AI教育平台四端问题整改与功能优化开发文档_v1.0.md`：历史整改提案，技术栈与当前 NestJS 基线不一致。


修改历史文档时，应先确认是否只是补充历史说明；如果要改变当前架构，必须新增或更新
`docs/decisions/` 中的 ADR，并同步 `ARCHITECTURE.md`、`DATABASE.md` 和本索引。
