> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../../README.md) 和各责任域文档。

# 问题二：个人画像与成长轨迹自动生成

> 状态：2026-10-21 / 已完成本轮代码审计；业务尚未全部完成，未作生产验收。

> 2026-10-21 复核；基线 `61d28fd` 加已有工作树。结论：**尚未全部完成**。

本目录交付审计和实施任务，未生成真实学生画像。先读 [完成情况报告](./00-completion-audit.md)、[统一接线设计](./05-evidence-routing-design.md)、[剩余任务](./06-remaining-tasks.md)、[本轮验证](./07-validation-20261021.md)。

## 现有代码分析

- 学生端 `/student/profile` 已经改为只读 API 页面，并覆盖 loading、empty、offline、error、permission-denied：
  `apps/student-center/features/profile/**`。
- API 已提供 `GET /api/v1/students/me/profile`，只读取 `agent_projection_candidates.status = accepted`：
  `services/api/src/modules/growth/growth.controller.ts`、`growth.service.ts`。
- Team Runtime 声明 `tutor.turn.completed` 到 `learner-profile`、项目/作品/反思/mastery 到
  `growth-analyst` 的消费映射，并把输出暂存为 `proposed`；消费映射不证明生产事件和执行路由接通：
  `services/workers/src/team-runtime-projection-source.ts`、`team-runtime-mailbox-source.ts`。
- Growth owner 的校验、接受、拒绝、替换和审计源码已存在，trajectory 的 evidenceRefs 已返回；旧的“没有 owner”说明不再准确。
- 尚缺：Admin/Worker 身份统一、event/delegate 路由一致、领域事件桥接、有界证据内容装配、自动审核/候选列表入口，以及独立成长轨迹页消费。

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

## 本轮复核状态

- 闭合 schema、最小化输入、候选 owner 和 accepted-only 画像读取已实现。
- “只剩家长投影和 E2E”的旧总结不完整；本轮按实际调用链修正了 [TODO.csv](./TODO.csv)。
- Worker 15 项定向单测通过，但不覆盖事件生成到双页面的真实闭环；API 在本轮新依赖构建下因 TS2542 失败。
- 实施顺序：身份/路由 → 事件/证据 → 版本/审核接入 → 双页面 → 隔离验收。不另建画像事实库。
