# 学习计划、掌握度与先理论后实践

> 「兴趣 → 4/8 周学习计划 → 先理论后实践 → 完成作品」的服务端能力。
> 不新增导航、不新增页面概念，落在既有「项目实例」之上。
> 实现入口：`packages/ai-client/src/curriculum.ts`、
> `packages/ai-client/src/{mastery,questions,grading}/**`、
> `services/api/src/modules/learning-plan`。

## 1. 模型

```text
LearningGoal（兴趣 + 目标作品 + 4|8 周 + 每节 60 分钟）
└── Module（周）
    └── Session（每节 60 分钟 = 复习 + 理论 + 检查 + 实践）
        ├── reviewBlock    0–15 min  间隔复习
        ├── theoryBlock    objectives: memory | concept
        ├── theoryCheck    出题 + 服务端判分  ──► TheoryMastered
        └── practiceBlock  objectives: procedure | design，产出 evidence
```

- `KnowledgeType = 'memory' | 'concept' | 'procedure' | 'design'`。
- `SessionBlock` 四段之和**恒为 60**。

### 1.1 实现状态（2026-10-04）

**已实现**（`curriculum.ts`，纯函数、无 DB / 无网络）：

- 两阶段 `explore → plan`：`exploreCurriculumInterest` / `planCurriculum` / `generateCurriculumPlan`。
- 常量：`SESSIONS_PER_WEEK = 5`、`MINUTES_PER_SESSION = 60`（4 周 20 节，8 周 40 节）、
  `CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1'`。
- 确定性 `seed`；`now` 缺省回落 `CURRICULUM_EPOCH`（**不用系统时钟**）。
- 60 分钟分块 `blockShapeFor()`：首节课 `0/40/20/0`（不排复习与实践，先立理论门禁）；
  4 周 1–2 周 `10/25/10/15`、3–4 周 `10/20/10/20`；8 周 1–5 周 `10/20/10/20`、6–8 周 `10/15/10/25`。
- **理论门禁实践**：实践 objective 的 `prerequisiteIds` 只指向**更早**课次的理论 objective，
  同节理论再由 `check` 分块卡住——结构上不可能「实践排在其理论之前」。
- 严格校验 `validateCurriculumPlan()` / `assertValidCurriculumPlan()`：**只报错、不修补**。
- 确定性推进 `selectNextCurriculumStep()`：优先级固定
  `answer_pending → review → 首个未完成课次 → complete`；`practiceUnlocked` 恒等于
  `theoryMastered`，调用方不能绕过。
- 意图确认与冻结 `confirmCurriculumPlan()`：计划必须 `projectId === null`；确认时间不得早于
  `exploredAt`；同幂等键重放返回 `replayed: true`；模板版本漂移拒绝。**纯函数，不落库**。
- 兼容层 `toLegacyLearningPlanDraft()` / `validateLearningPlanDraft()`。
- 追问字段 `missingIntakeFields` / `clarifyingQuestions`：缺字段降级但留痕，不静默丢弃。

**未实现 / 待接线**：

- `services/api/src/modules/learning-plan/plan-generator.ts` **仍用旧生成器**，
  尚未切到 `curriculum.ts`；两套实现共存，靠兼容层对齐。
- 数值掌握度门槛与间隔复习调度在 `mastery/` 切片。
- `curriculum.ts` **不计算掌握度**，只消费服务端传来的 `masteredObjectiveIds`。

## 2. 掌握度门槛

| 类型 | 门槛 |
|---|---|
| `memory` / `procedure` | 近期加权掌握度 **≥ 0.9**（权重 `0.5, 0.7, 0.85, 0.95, 1.0`） |
| `concept` / `design` | 质化布尔，由 Feynman 讲解检查置位 |
| 置信上限 | `{1: 0.5, 2: 0.8}`——作答次数不足时即使全对也不能过 0.9 |

- 提示与尝试次数扣分：`min(0.25, hints × 0.08)`、`min(0.2, (attempts − 1) × 0.05)`。
- 间隔序列按类型：`memory: 0,1,3,7,14,30,60`，`design: 14,28`；按**课次索引**而非自然日映射。

## 3. 题库与判分（答案绝不下发）

- `PendingQuestion` 服务端持有，含 `expectedAnswer` / `explanation`；下发前经 `PublicQuestion` 投影
  **剥离答案**。
- 判分确定：选择精确；短答 ≤30 字符精确或相似度 ≥0.85；开放题关键词重合 ≥0.6。
- 每路径同时只有一道未答题（`pending_questions` 部分唯一索引 `WHERE status='awaiting'`）；
  `answer_pending` 是最高优先级。
- 错误分类：`structural / deviation / application / metacognitive` → 生成补练 → 班主任可见。

## 4. 接口

```http
POST /api/v1/learning-plans/:id/confirm                          确认计划（幂等，冻结版本）
GET  /api/v1/learning-plans/:id                                  计划详情
GET  /api/v1/learning-plans/:id/sessions                         课次列表
POST /api/v1/learning-plans/:id/sessions/:sessionId/start        开始课次
GET  /api/v1/learning-plans/:id/sessions/:sessionId/next-step    下一动作
POST /api/v1/learning-plans/:id/sessions/:sessionId/answers      提交答案（幂等，服务端判分）
POST /api/v1/learning-plans/:id/sessions/:sessionId/evidence     提交实践证据
```

## 5. 硬规则映射

| 硬规则 | 处理 |
|---|---|
| `TheoryMastered` 前不得实践 | `practiceBlock` 在理论目标未达标时不排入；服务端再次校验 |
| 未确认意图不得创建正式项目 | 计划先生成 `LearningPlan`，`confirm-intent` 后才创建 `projectId` 并冻结 `templateVersion` |
| 状态 / 掌握度 / 审计不可客户端写 | 判分、掌握度、`stageAfter`、`TheoryMastered`、升级全服务端计算 |
| 未成年人数据最小可见 | 题面投影不含答案；成长快照不含原始对话 |
| 写操作幂等 | `answers` 用幂等键；计划生成用 `(studentId, interest, weeks)` 去重 |

## 6. 未决事项

- [ ] 课时密度：`SESSIONS_PER_WEEK = 5` 已定，产品侧确认待登记。
- [ ] 「先理论后实践」是每节课内（默认）还是整个项目前后分段。
- [ ] 计划宿主页面（工作台内 vs 今天页露出今日课）。
- [ ] 首期是否只支持 Python / 编程类兴趣，还是通用目标词表。
- [ ] `plan-api` 切换到 `curriculum.ts` 的迁移与下线 `plan-generator.ts`。
- [ ] 数值门槛 / 间隔复习调度在 `mastery/` 的具体实现与 FSRS 字段。

## 7. 相关文档

- [`tutor.md`](./tutor.md)
- [`projects.md`](./projects.md)
- [`growth.md`](./growth.md) §3
- [`../sdk/domain-facade.md`](../sdk/domain-facade.md)
