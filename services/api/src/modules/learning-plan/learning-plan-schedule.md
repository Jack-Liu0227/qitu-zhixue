# Learning plan schedule：次课数量、单节时长与间隔复习假设

`plan-generator.ts` 接受显式的 `sessionCount: 4 | 8`，以及可选的版本化 `PblSchedule`。
**课次是单元**，`weeks` 只是排期容器——不再由 `weeks` 乘出课次数。

## 1. 三种入参形状

| 请求 | 课次数 | 单节时长 | 每周节数 |
| --- | ---: | ---: | ---: |
| `{ interest, weeks, sessionCount: 4 }` | **4**（显式） | 60（默认） | `4 / weeks` |
| `{ interest, weeks, sessionCount: 8 }` | **8**（显式） | 60（默认） | `8 / weeks` |
| 旧 `{ interest, weeks, goal }` | `weeks × 5`（20 / 40） | 60 | 5 |
| `{ schedule: { sessionsPerWeek: 1, sessionMinutes: 120, ... } }` | `durationWeeks × 1` | 120 | 1 |
| `{ schedule: { sessionsPerWeek: 2, sessionMinutes: 60, ... } }` | `durationWeeks × 2` | 60 | 2 |

不变量：

- `sessionCount` 给出时必须与 `weeks × 每周节数` 一致；同时给出 `schedule` 时还要与
  `schedule.sessionsPerWeek` 一致，否则 400 `LEARNING_PLAN_INVALID`。
- `schedule.durationWeeks` 必须等于 `weeks`，且满足共享的 `PblSchedule` 校验
  （`weeklyMinutes` 恒为 120，`sessionsPerWeek × sessionMinutes === weeklyMinutes`）。
- 合法的课次数集合因此比 `{4, 8}` 更大：`4`（4 周 1 节）、`8`（4 周 2 节 / 8 周 1 节）、
  `16`（8 周 2 节）、`20` / `40`（遗留 5 节/周）。

## 2. 每节五段

每节课由五个分段组成：`review`（复习/导入）、`theory`（理论学习）、`check`（检查）、
`practice`（实践）、`reflect`（反思）。

- 唯一的分块策略是 `sessionBlockShapeFor(sessionMinutes, ordinal)`——入参是单节
  时长与**课次序号**（不是周索引），两部分块形状必须一致。
- 理论课不排 `practice` 分块（该节没有实践目标，而实践分块必须携带非空
  `prerequisiteObjectiveIds`），其时长并入理论讲解，分块合计仍恰好等于
  `minutesPerSession`。
- 旧的 `activity` 投影**不可逆**：`check` 与 `reflect` 都投成 `reflect`。需要区分
  时必须读分块的 `kind`。

## 3. 间隔复习的**课次序号**假设（重要）

复习间隔（`memory: 0,1,3,7,14,30,60`，`design: 14,28`）是按**课次索引**而非自然日
映射的。这一假设只在「1 天 ≈ 1 课次」的旧密度（5 节/周）下近似成立。

在 `1 × 120` 排期下每周只有一节课，因此**一个间隔值 7 意味着七周，而不是七天**。
这是当前实现的既有语义，本轮**未**重新解释这些序列——按排期重算间隔需要单独评审
（涉及复习调度与掌握度门槛的交互）。此处显式记录该假设，避免它继续隐含在代码里。

同理，`weeks` 与课次序号的换算只在 `sessionsPerWeek` 已知时才有意义；本模块的
校验器因此要求两者自洽，而不是从其中一个推另一个。

## 4. 大纲（outline）阶段

计划与「每节教学计划」之间新增一层持久化产物：`plan-outline.ts` 的 `PlanOutline`。

- 在**确认计划**时由 `buildPlanOutline` 从计划结构推导（纯函数，服务端写），
  逐节记录课次序号、周/日、目标 id、分块类型与分钟数。
- 确认后**不可变**：`assertOutlineMutable` 拒绝重建已确认计划的大纲。
- 教学计划**按课次惰性展开**：`generateSessionTeachingPlan(outline, plan, sessionIndex)`
  一次只产出一节，8 节课的计划不会预先物化 8 份教学计划。
- 幂等键：大纲 `outline:<planId>`，教学计划 `session-plan:<planId>:<sessionIndex>`。
- 只保留结构；不含任何学生作答、对话或语音原文。

## 5. 遗留路径

旧 5 节/周网格（`weeks × 5`）仍然生成并校验，靠 `blockShapeFor` 的周索引表与
`validateLearningPlanDraft` 兼容层对齐。新的按课次形状走
`sessionBlockShapeFor`；两处不再各写一套规则。
