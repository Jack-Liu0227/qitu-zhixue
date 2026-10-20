# 学情画像与成长轨迹 Projection

本目录解决“根据学生输出、项目、对话和助手调用生成个人画像与成长轨迹”的第二个问题。

## 现有代码分析

- 学生端 `/student/profile` 已经改为只读 API 页面，并覆盖 loading、empty、offline、error、permission-denied：
  `apps/student-center/features/profile/**`。
- API 已提供 `GET /api/v1/students/me/profile`，只读取 `agent_projection_candidates.status = accepted`：
  `services/api/src/modules/growth/growth.controller.ts`、`growth.service.ts`。
- Team Runtime 已把 `tutor.turn.completed` 路由到 `learner-profile`，把项目/作品/反思/mastery 事件路由到
  `growth-analyst`，并把模型输出暂存为 `proposed`：
  `services/workers/src/team-runtime-projection-source.ts`、`team-runtime-mailbox-source.ts`。
- 当前最大缺口是：没有明确的 domain-owner acceptance/revision 流程，候选会长期停在 `proposed`；因此页面诚实地显示“画像正在形成”，但不会自动得到新的已确认结果。
- 另一个合同风险是前端 `StudentProfileProjection.trajectory` 需要 `evidenceRefs`，API 组合投影目前没有稳定返回该字段；必须在同一 PR 修复，不允许让 UI 猜证据。

## 设计原则

1. Tutor 只产生学习证据引用和教学回合，不直接写画像结论。
2. `learner-profile` 与 `growth-analyst` 各自生成候选；Growth owner 负责验证、接受、版本化和审计。
3. 学生端和家长端都读取同一份已接受 projection 的不同最小投影；不返回原始对话、语音、内部风险标签或模型 prompt。
4. 候选输出必须是闭合 schema，未知字段、超长文本、无证据引用和跨学生引用全部拒绝。

## 文件任务

- `01-evidence-contract.md`：事件、证据引用和两个助手的输入输出合同。
- `02-owner-acceptance.md`：候选验证、接受、冲突、重放和审计流程。
- `03-profile-read-model.md`：学生/家长读取模型和前端展示状态。
- `04-verification.md`：Worker、API、权限和数据最小化验收。
- `TODO.csv`：任务拆分。

## Implementation status (2026-10-21)

- Closed contracts, opaque evidence filtering, worker minimization, and the Growth owner validate/accept/reject/supersede path are implemented.
- The student read model only composes accepted `learner_profile` and `growth_trajectory` rows.
- Parent-specific profile projection and the full event-to-page E2E regression remain before production acceptance; see `TODO.csv`.
