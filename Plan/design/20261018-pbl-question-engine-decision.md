# 决策请求：PBL 动态选题引擎应复用 learning-plan，而非在 ai-tutor 内新建

> 状态：`decision-requested / 待用户拍板`
> 评审基线：2026-10-18
> 责任域：`ai-tutor` / `learning-plan` / `mastery` / `projects`
> 触发：需求 3（基于 OpenMAIC 的动态交互 + DeepTutor 式问题选择）实施时发现设计基线的前提不成立
> 相关：[`./20261018-pbl-dynamic-interaction-openmaic.md`](./20261018-pbl-dynamic-interaction-openmaic.md) §4

## 1. 结论先行

`20261018-pbl-dynamic-interaction-openmaic.md` §4 假设「概念池 = 当前 `PblPhaseSpec.linkedConcepts` ∩ 未达标概念」，并计划在 `ai-tutor`/`mastery` 内新建选题与判分链路。

**该前提在本仓库不成立**，且**要建的能力已经存在**——由 `learning-plan` 领域完整实现并强制了 `AGENTS.md` 的全部相关硬规则。建议需求 3 的选题/判分链路改为**委派 learning-plan**，而不是新建第二套。

## 2. 已核实的事实（含证据位置）

### 2.1 设计基线的前提缺失

| 断言 | 核实结果 |
| --- | --- |
| `PblPhaseSpec.linkedConcepts` 存在 | **不存在**。`database/seeds/admin-ai-config.sql`（`pbl_spec` 的唯一编写面）中 `linkedConcepts` / `linked_concepts` / `concepts` 出现次数均为 **0** |
| 题库可按 Tutor 会话取题 | **不能**。`pending_questions`（`database/migrations/0009_verification_evidence.sql:5-7`）的 `plan_id`、`session_id`、`objective_id` 均 `NOT NULL`，绑定学习计划而非 Tutor 会话 |
| `mastery_objective_mappings` 可直接用于 PBL 阶段 | **不能**。同样 `plan_id NOT NULL`（`database/migrations/0011_mastery_timeline.sql:85`） |
| ai-tutor 当前会生成 quiz 块 | **不会**。`services/api/src/modules/ai-tutor/*.ts` 中 `kind: 'quiz'` 出现 **0** 次；合同里的 `quiz` 块与前端 `HeuristicQuizCard.tsx` 此前只由 fixture 驱动 |

结论：在 `ai-tutor` 内实现动态选题，必须先做跨域数据模型变更（阶段↔概念关联、Tutor 作用域题目存储、掌握度候选写入），并且会新增**第二个掌握度写入者**。

### 2.2 需要的能力已由 learning-plan 实现

`services/api/src/modules/learning-plan/learning-plan.service.ts:108-125` 的领域注释即为证据，逐条对应需求 3 的诉求：

| 需求 3 诉求 | learning-plan 既有实现 |
| --- | --- |
| DeepTutor 式问题选择交互（题面/选项/解析） | `QuestionCard` 含答案与解析，下发前只经 `toPublicQuestion` 结构化投影 |
| 答案泄露防护 | 作答请求只接受 `questionId` + `answer`；答案与解析不出服务端 |
| 服务端判分 + 幂等 | `submitAnswer(actor, planId, sessionId, { questionId, answer }, idempotencyKey)`（`:366`），走 `IdempotencyStore`，重试不追加第二次尝试 |
| 动态取下一题（含门禁） | `getNextStep(actor, planId, sessionId)`（`:350`），内部先 `assertPracticeGate` |
| `TheoryMastered` 前不进实践 | `computeTheoryMastered` 只读服务端掌握记录；实践课/实践分块在理论达标前一律 **403**；客户端传入的 stage/mastery 被控制器白名单丢弃 |
| 掌握度与间隔复习 | `recomputeMastery`（`:980`）、`buildMasteryEvent`（`:1071`）、`reviewCount`（`:1022`） |
| 对象级授权 | 学生只能碰自己的计划；班主任只能读当前在带的学生；越权 403 |
| 审计 | 生成、确认、`TheoryMastered`、证据提交各写一次 |

### 2.3 关键发现：立项存在两条并行管线

| 管线 | 入口 | 项目创建位置 | `projects.source_exploration_id` | 是否产出学习计划 |
| --- | --- | --- | --- | --- |
| A（计划先行） | `learning-plan.confirmPlan` | `learning-plan.store.postgres.ts:284-302` 事务内 `insert(projectsTable)`，并把 `learning_plans.project_id` 回写、`status='active'` | `null` | **是** |
| B（探索先行） | `tutor.confirmExploration`（需求 4 的一键立项走这条） | `projects` 模块 | 有值 | **否** |

`learning_plans.project_id` 有外键与索引（`database/migrations/0008_domain_foundation.sql:319,463`），但 **`generatePlan` 的入参只有 `{ interest, lessonCount, lessonMinutes, goal?, sessionCount? }`，不接受 projectId**；计划与项目的关联只在 `confirmPlan` 时由管线 A 建立。

因此：**走管线 B 立项的项目没有学习计划，也就拿不到需求 3 的选题引擎。**

### 2.4 需求 3 与需求 4 其实是同一个问题

`generatePlan` 的入参与需求 4 已冻结的 `TutorIdeaCard` 几乎一一对应：

| `TutorIdeaCard` | `generatePlan` 入参 |
| --- | --- |
| `suggestedInterest` | `interest` |
| `suggestedGoal` | `goal` |
| `lessonCount`（课时总数） | `lessonCount` |
| `templateId` | 计划生成时冻结的 `templateVersion` |

即：想法卡片已经携带了生成学习计划所需的全部输入。

## 3. 建议方案（推荐）

**让对话内一键立项走「生成计划 → 确认计划」，由 learning-plan 在事务内创建项目。**

1. `idea_cards` 的「一键创建」在服务端等价于：`generatePlan(actor, { interest, lessonCount, lessonMinutes, goal })` → `confirmPlan(...)`，复用其既有幂等签名 `(studentId, interest, lessonCount, lessonMinutes, templateVersion)` 与 `IdempotencyStore`。
2. 立项成功后项目**天然带有学习计划**，Tutor 的 `quiz` 块由 `getNextStep` 投影而来，作答端点作为 `submitAnswer` 的**薄门面**（保持已冻结的 `AnswerInteractiveQuizRequest/Response` 合同不变，前端无需改动）。
3. 无计划时（历史项目、或计划生成失败）**不下发 quiz 块**，给明确的空状态；**绝不编造题目**。
4. 不在 `ai-tutor` 内新建第二个掌握度写入者；掌握度事实仍只由 learning-plan/mastery 领域 owner 写。

收益：零新表、零新迁移；需求 3 与需求 4 合并为一条链路；消除重复的立项管线；所有硬规则由已经强制它们的领域继续强制。

代价与风险：
- 立项的服务端归属从 `projects`/`ai-tutor` 侧移到 `learning-plan` 侧，属于**跨域流程变更**，需要产品确认。
- 管线 B 已创建的历史项目没有计划，需要决定是补齐（为存量项目生成计划）还是仅对新项目生效。
- `generatePlan` 目前不接受 `projectId`/`templateId` 显式入参，模板由计划生成器冻结；若要求想法卡片的 `templateId` 决定项目模板，需要确认二者一致性来源，避免「卡片写 A 模板、计划冻结 B 模板」。

## 4. 备选方案

| 方案 | 内容 | 评价 |
| --- | --- | --- |
| B：按原设计新建 | 加迁移做阶段↔概念关联 + Tutor 作用域题目表 + 掌握度候选写入 | 与 learning-plan 大量重复；新增第二个掌握度写入者，违反单一 owner；工作量大 |
| C：仅在有计划时委派 | 不改立项链路，Tutor 只在项目恰好有计划时下发 quiz | 改动最小，但走管线 B 立项的项目永远没有计划 → 需求 3 对主流程实际不可用 |
| D：本次降级交付 | 只交付已完成的 `board`/`milestone` 与既有 `options`/`interactive_experiment` 块，选题引擎另开 Issue | 诚实但不满足需求 3 的核心诉求 |

## 5. 本次已交付（不受决策影响）

- `board` 块：服务端从已授权项目的真实阶段投影生成只读 Mermaid 阶段图；标签经 `escapeMermaidLabel` 剥除 `< > | ; " \` [ ] { }` 并截断 120 字符，不接受也不转发任意 HTML。
- `milestone` 块：投影真实阶段、交付物与门禁状态；当活动阶段属于实践且 `TheoryMastered` 未通过时，**改为投影 `concept_mastery`**，不泄露实践入口。
- 二者随回合以 `tutor.block` SSE 帧下发并持久化；探索会话因 `project: null` 不生成项目块。
- 位置：`services/api/src/modules/ai-tutor/tutor-interactive-blocks.ts`（+ 同目录测试）

## 6. 需要用户回答

1. 是否采纳建议方案（一键立项改为经 learning-plan 生成并确认计划）？
2. 存量项目（管线 B 创建、无计划）是补齐计划，还是仅新项目生效？
3. 想法卡片的 `templateId` 与计划生成器冻结的 `templateVersion`，以哪一方为准？
