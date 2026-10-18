# 学习计划、掌握度与先理论后实践

> 文档基线：`2026-10-19`，版本标识：`v2026.10.19`。
> 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**。驱动探究双循环与分步解锁机制。
> 「兴趣 → 4/8 周学习计划 → 先理论后实践 → 完成作品」的服务端能力。
> 不新增导航、不新增页面概念，落在既有「项目实例」之上。
> 实现入口：`packages/ai-client/src/curriculum.ts`、
> `packages/ai-client/src/{mastery,questions,grading}/**`、
> `services/api/src/modules/learning-plan`。

## 1. 模型

```text
LearningGoal（兴趣 + 目标作品 + 4|8|16 次课 + 每节 60|120 分钟）
└── Outline（确认时派生的大纲，确认后不可变，逐节列出目标与分块）
    └── Session（第 N 次课）
        ├── reviewBlock    复习 / 导入
        ├── theoryBlock    objectives: memory | concept
        ├── checkBlock     检查（出题 + 服务端判分，汇入掌握度证据）
        ├── practiceBlock  objectives: procedure | design，产出 evidence
        └── reflectBlock   反思复盘
```

- `KnowledgeType = 'memory' | 'concept' | 'procedure' | 'design'`。
- **课次是单元**：`sessionCount: 4 | 8 | 16` 是显式输入，`weeks` 只是排期容器。
  不再由 `weeks` 乘出课次数。
- 每节分块合计**恰好等于** `minutesPerSession`（60 或 120）。
- 理论课不排 `practice` 分块（该节没有实践目标），其时长并入理论讲解。
- `sessionBlockShapeFor(sessionMinutes, ordinal)` 是**唯一**的分块策略；入参是
  单节时长与课次序号，不是周索引。

### 1.1 既有生成器基线（2026-10-15 历史实现记录）

以下记录描述既有 4/8 课次生成器，不代表当前所有排期。当前服务端 `PlanSessionCount` 和生成输入已接受 `4 | 8 | 16`；这不证明 16 课时已完整消费冻结模板内容/hash、绑定及 IMA 合同。最新治理要求和接线缺口以 [`../plan/codex/theme-session-team-ima-design.md`](../plan/codex/theme-session-team-ima-design.md) 为准；16 课时必须使用新模板版本与 bootstrap identity，不原地改变 `optics-physical-inquiry:v1`。

**已实现**（`curriculum.ts`，纯函数、无 DB / 无网络）：

- 两阶段 `explore → plan`：`exploreCurriculumInterest` / `planCurriculum` / `generateCurriculumPlan`。
- 五段分块策略 `sessionBlockShapeFor(sessionMinutes, ordinal)`（60 / 120 分钟、
  任意课次序号下五段皆为**正整数**且合计恰好）；`blockShapeFor(weeks, week, firstSession)`
  是它在旧周索引网格上的投影，供 `planCurriculum` 与既有测试使用。
- 常量：`SESSIONS_PER_WEEK = 5`、`MINUTES_PER_SESSION = 60`、
  `CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1'`。
- 确定性 `seed`；`now` 缺省回落 `CURRICULUM_EPOCH`（**不用系统时钟**）。
- **理论门禁实践**：实践 objective 的 `prerequisiteIds` 指向理论 objective，
  同节理论再由 `check` 分块卡住；实践中必须携带非空 `prerequisiteObjectiveIds`，
  实践节必须声明 `theoryObjectiveIds`——结构上不可能「实践排在其理论之前」。
- 严格校验 `validateCurriculumPlan()` / `assertValidCurriculumPlan()`：**只报错、不修补**。
- 确定性推进 `selectNextCurriculumStep()`：优先级固定
  `answer_pending → review → 首个未完成课次 → complete`；`practiceUnlocked` 恒等于
  `theoryMastered`，调用方不能绕过。
- 意图确认与冻结 `confirmCurriculumPlan()`：计划必须 `projectId === null`；确认时间不得早于
  `exploredAt`；同幂等键重放返回 `replayed: true`；模板版本漂移拒绝。**纯函数，不落库**。
- 兼容层 `toLegacyLearningPlanDraft()` / `validateLearningPlanDraft()`。
- 追问字段 `missingIntakeFields` / `clarifyingQuestions`：缺字段降级但留痕，不静默丢弃。

**服务端（`services/api/src/modules/learning-plan`）**：

- `plan-generator.ts`：显式 `sessionCount`、五段生成、`assertGenerateInput` 白名单。
- `session-plan-validator.ts`：**唯一**校验入口，收集全部违规后一次性抛
  `LEARNING_PLAN_INVALID` + `{path,message}` 列表。含覆盖率的两个轴：
  每个模板目标必须被 ≥1 节课引用；每节分块合计必须恰好等于 `sessionMinutes`。
  DAG 环错误给出**环上的顶点路径**（`a → b → a`），不再是裸布尔。
- `plan-outline.ts`：大纲阶段。确认时由计划结构派生并落库，确认后不可变；
  教学计划按课次**惰性**展开，幂等键 `outline:<planId>` /
  `session-plan:<planId>:<sessionIndex>`。只保留结构，不含学生作答或对话原文。



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
POST /api/v1/learning-plans/:id/confirm                          确认计划（幂等，冻结版本，派生大纲）
GET  /api/v1/learning-plans/:id                                  计划详情
GET  /api/v1/learning-plans/:id/sessions                         课次列表
POST /api/v1/learning-plans/:id/sessions/:sessionId/start        开始课次（按课次惰性展开教学计划）
GET  /api/v1/learning-plans/:id/sessions/:sessionId/next-step    下一动作
POST /api/v1/learning-plans/:id/sessions/:sessionId/answers      提交答案（幂等，服务端判分）
POST /api/v1/learning-plans/:id/sessions/:sessionId/evidence     提交实践证据
```

生成入参白名单：`interest` / `weeks` / `goal` / `schedule` / `sessionCount`。
`sessionCount` 是学生可以表达的结构选择（4、8 或 16 次课，仍受服务端模板与排期校验），**不是**服务端状态；
掌握度、阶段、`theoryMastered`、`projectId` 等仍然一律 400。

## 5. 硬规则映射

光学课程有 12 个排程目标、4 个阶段和 4 个质化波动模块。散射与衍射属于实践/非门禁波动模块，不新增 `TheoryMastered` 目标；课时检查点不是完成事实，第 8 节不自动写入 `TheoryMastered`，第 14/16 节不自动批准报告或归档。session/task 完成也不能冒充项目阶段推进；项目、mastery 和作品事实只能由对应服务端 owner 基于证据写入。

| 硬规则 | 处理 |
|---|---|
| `TheoryMastered` 前不得实践 | 实践目标的 `prerequisiteIds` 必含理论目标；实践分块必带非空 `prerequisiteObjectiveIds`；实践节必须声明 `theoryObjectiveIds`；服务端再次 403 |
| 未确认意图不得创建正式项目 | 计划先生成 `LearningPlan`，`confirm-intent` 后才创建 `projectId` 并冻结 `templateVersion` |
| 状态 / 掌握度 / 审计不可客户端写 | 判分、掌握度、`stageAfter`、`TheoryMastered`、升级全服务端计算；大纲与教学计划同样只服务端写 |
| 未成年人数据最小可见 | 题面投影不含答案；大纲只保留结构（课次序号、目标 id、分块类型与分钟数），不含作答 / 对话 / 语音原文 |
| 写操作幂等 | `answers` 用幂等键；计划生成用 `(studentId, interest, weeks, 排期)` 去重；大纲 `outline:<planId>`、教学计划 `session-plan:<planId>:<sessionIndex>` |

## 6. 未决事项

- [ ] 课时密度：`SESSIONS_PER_WEEK = 5` 已定（遗留网格），显式次课数量已落地，
  产品侧确认待登记。
- [ ] 「先理论后实践」是每节课内（默认）还是整个项目前后分段。
- [ ] 计划宿主页面（工作台内 vs 今天页露出今日课）。
- [ ] 首期是否只支持 Python / 编程类兴趣，还是通用目标词表。
- [ ] **间隔复习的课次序号假设**：复习间隔按课次索引而非自然日映射，`1 × 120`
  排期下一个间隔 7 表示七周而不是七天。见
  `services/api/src/modules/learning-plan/learning-plan-schedule.md` §3；
  是否按排期重算序列待评审。
- [ ] 数值门槛 / 间隔复习调度在 `mastery/` 的具体实现与 FSRS 字段。
- [ ] 大纲与教学计划的**持久化落库**（`PlanOutlineStore` 端口已定义，Postgres 实现待接线）。


## 7. 相关文档

- [`tutor.md`](./tutor.md)
- [`projects.md`](./projects.md)
- [`growth.md`](./growth.md) §3
- [`../sdk/domain-facade.md`](../sdk/domain-facade.md)
