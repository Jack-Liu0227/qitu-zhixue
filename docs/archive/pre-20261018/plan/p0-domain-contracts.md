# P0：领域合同与时间模型（Planned）

## 目的

把“4–8 周、每周约 2 小时”的实际教学安排编码成稳定合同，消除当前 `LearningPlanWeeks = 4 | 8` 与 session 数量语义混淆。

## 工作项

- 在 `packages/contracts` 定义计划时间模型：`durationWeeks: 4 | 8`、`weeklyMinutes`、`sessionsPerWeek`、`sessionMinutes`；首期允许总投入 8–16 小时。
- 明确 `ProjectTemplateSpec`、`CurriculumPlan`、`LessonPlan`、`EvidenceRequirement`、`RubricCriterion` 的字段、版本和状态。
- 将项目阶段统一为 `exploration`、`concept_mastery`、`guided_practice`、`deliverable_review`，并为每一阶段定义唯一门禁。
- 为模板、计划、课程和 rubric 增加不可变版本号；重新生成只能创建新草稿，不能覆盖已激活计划。
- 定义错误码、幂等作用域、对象级权限和敏感证据的可见性规则。

## 验收标准

- 合同能表达每周 1 次 120 分钟或每周 2 次 60 分钟。
- 计划总时长、session 数量、阶段产出和目标依赖可以被服务端校验。
- 合同不允许客户端提交 `stage`、`mastery`、`theoryMastered`、`passed` 或审计字段。
- `pnpm --filter @qitu/contracts typecheck` 和相关合同测试通过。

## 依赖与交付物

- 依赖：无。
- 交付物：合同类型、校验器、错误码表、迁移说明、面向其他任务的字段示例。
- 风险：现有学习计划 API 已使用 `weeks` 和固定 session 规则；迁移必须保留兼容读取或提供明确版本迁移。

## 当前进度（2026-10-14）

- 已完成：`packages/contracts/src/pbl-learning.ts` 的版本化时间、模板、课程、证据和 rubric 合同。
- 已完成：学习计划生成器支持 `1 x 120` 和 `2 x 60` 两种每周 120 分钟排课，同时保留旧的 `weeks * 5 x 60` 请求。
- 已完成：合同包类型检查和差异空白检查。
- 待完成：数据库迁移和模板实体持久化；这属于后续 P1 模板任务，当前 schedule 通过 session 投影兼容读取。

