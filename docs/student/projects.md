# 我的项目

> 学生端第 4 项（`/student/projects`，详情 `/student/projects/[projectId]`）。
> Projects & Learning 是项目状态的**唯一写入者**（ADR 0002）。
> 实现入口：`apps/student-center/features/projects/**`、
> `services/api/src/modules/projects`、`services/api/src/modules/learning-plan`。

## 1. 页面构成

| 页面 | 内容 |
|---|---|
| 列表 `/projects` | 标签 **进行中 / 草稿 / 已完成** + 搜索 + 项目卡（封面 / 标题 / 副标 / 第 N 阶段共 M 阶段 / 进度条 / 进度% / 标签） + 右侧「下一步」橙卡 + 「创建新项目」→ 灵感空间 |
| 详情 `/projects/[projectId]` | 阶段条（4 步展示视图）+ 阶段卡 + 任务列表 + 提交面板 + 班主任注记 |
| 理论 `/projects/[projectId]/theory` | 理论学习模块 + `TheoryCheck`（服务端判分） |
| 实践 `/projects/[projectId]/practice` | `PracticeChecklist` + `ArtifactUploader` + `SubmissionPanel` |
| 反思 `/projects/[projectId]/reflection` | `ReflectionForm` |
| 工作台 `/projects/[projectId]/workbench` | 见 [`workbench.md`](./workbench.md) |

列表标签 ↔ `ProjectStage` 的映射是一层展示映射，**不参与权限判定**。

## 2. 服务端状态机（唯一权威）

```text
exploration
  → intent_confirmed
  → theory_learning → theory_check          （TheoryMastered 门禁在此）
  → practice_ready → practice_building
  → artifact_review → reflection → published → completed
```

10 个英文状态定义在 `packages/contracts/src/project.ts` 的 `ProjectStage`。
`StageProgressDisplay`（`currentStageIndex` / `stageTotal` / `progressPercent`）标注
**ILLUSTRATIVE ONLY**，只能展示，不能用于授权或阶段门。

## 3. 硬规则

1. **学生未确认意图不得创建正式项目**：唯一入口是 `confirm-intent`（幂等）；
   重复确认只产生一个项目。
2. **`TheoryMastered` 前不得进入实践**：由 `learning-plan` 计算并落事件，`projects` 只读该事件；
   服务端再次校验。
3. 实例创建后 `templateVersionId` **不可变**；阶段名来自模板，不进全局常量。
4. `ProjectStatus`、`progressPercent`、`currentStageIndex` 一律服务端计算，客户端不可写。
5. 所有写操作（提交、确认、关闭、推进）携带 `Idempotency-Key`。
6. 推进判定只调用 `checkThreshold()`（见 [`../sdk/domain-facade.md`](../sdk/domain-facade.md)）。

## 4. 接口

```http
GET   /api/v1/projects/:id                项目详情（授权）
PATCH /api/v1/projects/:id                更新可写字段（标题 / 标签等）
POST  /api/v1/projects/:id/confirm-intent 确认意图（幂等，唯一建项目路径）
POST  /api/v1/projects/:id/close          关闭
GET   /api/v1/projects/:projectId/can-advance   是否可推进（只读门槛）
POST  /api/v1/projects/:projectId/advance       推进（幂等，服务端判定 stageAfter）
GET   /api/v1/projects/:id/next-step            右栏「下一步」
GET   /api/v1/projects/:id/evidence             项目证据三列（服务端聚合，只读）
```

学习计划 / 答题 / 掌握度接口见 [`learning-plan.md`](./learning-plan.md)。

## 5. 项目证据（服务端聚合，只读）

三列：**我独立完成的** / **AI帮助我的** / **我遇到的困难**。

- `independent` 必须从 `TaskSubmission` 推导。
- `aiHelped` 必须从 `TutorTurn`（hint level ≥3 / scaffold / explain）推导。
- `difficulties` 来自卡顿 / 升级事件 + 错误分类 + 反思。

**学生与客户端都不能直接 POST 证据**——否则成长档案可被手填伪造。

## 6. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 卡片 / 阶段条骨架 |
| empty | 「创建新项目」空态 → 灵感空间 |
| error | 重试 |
| offline | 只读列表；禁止提交，保留未提交 draft |
| permission-denied | 403 页面，不泄露项目存在性 |

## 7. 未决事项

- [ ] 「进行中 / 草稿 / 已完成」↔ `ProjectStage` 的正式映射。
- [ ] 项目创建唯一路径：是否删除 `POST /api/v1/projects`，只留 `confirm-intent`。
- [ ] 列表标签语义与排序（最近活跃 vs 创建时间）。

## 8. 相关文档

- [`workbench.md`](./workbench.md)
- [`learning-plan.md`](./learning-plan.md)
- [`growth.md`](./growth.md)
- [`../admin/platform-governance.md`](../admin/platform-governance.md)
