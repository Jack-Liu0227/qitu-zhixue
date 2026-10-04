# 成长轨迹

> 学生端第 6 项（`/student/growth`），2026-09-26 由 ADR 0004 提升为一级导航（追加在末尾，
> 原五项顺序不变）。责任域：Growth（成长记录与投影）+ Mastery（掌握度时间线）。
> 实现入口：`apps/student-center/features/growth/**`、`services/api/src/modules/growth`、
> `services/api/src/modules/mastery`。

## 1. 页面构成

- `GrowthHeader` + `GrowthSummaryCard` + `FilterBar`。
- `TimelineRail` / `TimelineEntry`：反思、里程碑、作品、观察注记。
- `ObjectiveChip`、`VersionStep`、`ArtifactEntry`。
- 支持 `?projectId=` / `?type=` 深链预筛选，但**该页不得假设**自己带着 `projectId` 进入，
  必须能独立渲染完整时间线。

## 2. 架构形态（关键）

成长轨迹**不是两端同一份数据**，而是**单一服务端成长档案模型 + 三角色投影**：

```text
学生  → 完整时间线（含自己的反思）
家长  → 脱敏快照（不含原始对话）
班主任 → 授权详情（当前有效 mentor assignment 覆盖）
```

| 读法 | 接口 |
|---|---|
| 学生成长汇总 | `GET /api/v1/growth/summary` |
| 学生成长时间线 | `GET /api/v1/growth` |
| 项目摘要 | `GET /api/v1/growth/projects/summaries` |
| 家长 / 孩子投影 | `GET /api/v1/growth/:childId/growth`（经 guardian link 授权） |

## 3. 掌握度时间线（ADR 0009）

```text
PostgreSQL mastery events（不可变事实账本）
  ├── current mastery projection   ← TheoryMastered / 项目门槛 / 实践解锁
  ├── mastery timeline API         ← 曲线、时间切片、退步检测
  └── outbox → Graphiti 时序投影（可选、异步、可重建）
```

权威边界固定：

1. **证据权威**：PostgreSQL 不可变掌握度事件 + 可回查的 Trajectory / L1 证据。
2. **当前状态权威**：PostgreSQL 当前投影。`TheoryMastered`、实践解锁、项目状态只依赖它。
3. **时间线查询投影**：Graphiti 或 PostgreSQL 读模型；Graphiti **不是**项目门槛依赖。
4. **长期偏好记忆**：Mem0 只索引经批准的非掌握类事实，不保存 `level`、`TheoryMastered`、
   项目阶段。

### 3.1 不变量

- 每次掌握度变更必须有唯一事件、算法版本和证据引用。
- 同一事件重试不产生第二个掌握事件 / 审计 / outbox 消息。
- 乱序事件不能让旧评估覆盖新评估；补录事件必须显式携带有效时间与因果关系。
- `aggregateSequence` 在 `(studentId, knowledgePointId)` 聚合内单调递增。
- Graphiti 不可用时答题 / 判分 / 当前掌握 / 项目门槛仍正常；时间线读取必须明确返回
  stale / unavailable，**不能伪装成空数据**。
- 任何 Graphiti 数据都能从 PostgreSQL 事件账本全量重建。
- 面向未成年人的读取先做对象级授权，再做字段投影。

接口（`MasteryTimelinePort`，不暴露 Graphiti 类型）：

```http
GET /api/v1/mastery/current             当前掌握度投影
GET /api/v1/mastery/timeline            时间线（游标已接通）
GET /api/v1/mastery/snapshot            任意 asOf 快照
GET /api/v1/mastery/threshold           门槛判定（只读）
GET /api/v1/mastery/regressions         退步检测
```

## 4. 硬规则

- 成长记录、掌握度、项目阶段、审计**不能由客户端 / 模型 / Mem0 / Graphiti 写入**。
- 家长默认看不到原始 AI 对话和语音；只看到脱敏投影。
- 退步检测的「撤销」和「未知」不填零，也不计入实测退步。

## 5. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 时间线骨架 |
| empty | 无成长记录 → 明确「还没有记录，去完成一个项目」 |
| error | 重试 |
| offline | 只读缓存；不把缓存旧摘要标为最新 |
| permission-denied | 403 页面 |

## 6. 未决事项

- [ ] 掌握度时间线的学生 / 家长 / 班主任字段投影矩阵（最高风险：学生行）。
- [ ] 孩子「自述 / 反思」对家长是否全量可见。
- [ ] 是否向学生展示风险信号（卡顿 / 情绪挫败 / 已升级班主任）——建议不可见。
- [ ] `level` 连续值 vs 离散等级；不同 `knowledgeType` 是否允许不同标尺。
- [ ] 快照生成频率、保留周期和删除策略。
- [ ] Graphiti 选 Neo4j / FalkorDB，以及是否允许外部 LLM / embedding。
- [ ] `KnowledgePoint` 独立表 vs 知识库 verified 文档结构化节点。
- [ ] 「AI 总结与建议」（RAG / `growth.summarize` 用途）接入方式。
- [ ] 六项导航在窄屏下的视觉验证。

## 7. 相关文档

- [`learning-plan.md`](./learning-plan.md)
- [`../parent/progress.md`](../parent/progress.md)
- [`../sdk/agent-memory.md`](../sdk/agent-memory.md)
- [`../admin/database.md`](../admin/database.md) §3.3
