# 班主任工作台 · 总览

2026-10-24 产品修订：教师只读学生学习记录、自动评价和问题。学生提交后由服务端自动评价、按反馈修订并推进，不再等待教师逐活动评价、作品批准或人工恢复。旧审批入口退役。策略与验证见 [自主学习评价](../../Plan/issues/20261024-autonomous-learning.md)。

2026-10-24 问题处理中的家长反馈已支持私有附件：当前班主任可下载已提交工单中的文件，也可在回复中添加 PNG/JPEG/PDF/UTF-8 文本，每文件最多 2 MiB、每条回复最多 5 个。家长未提交的草稿文件不可见，分配撤销后立即停止访问。实现与验收见 [家校反馈附件](../../Plan/issues/20261024-feedback-attachments.md)。

> 文档基线：`2026-10-19`，版本标识：`v2026.10.19`。
> 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**。作为已分配学生学习记录与问题的只读观察工作面。
>
> Teacher 面向班主任和平台导师，负责**已分配学生**的学习记录查看、问题查看、
> 项目进展观察和统计。后台控制权全在 Admin，班主任工作台不负责全局模板库、模型凭证或 AI runtime 治理。
> 实现入口：`apps/teacher-workspace`、`services/api/src/modules/teacher`、
> `services/api/src/modules/reminders`、`services/api/src/modules/directory`。

## 1. 业务导航（冻结 4 项）

| 顺序 | 名称 | 路由 | 说明 |
|---|---|---|---|
| 1 | 工作台 | `/teacher/dashboard` | 概述 |
| 2 | 学生管理 | `/teacher/students` | 列表 + 详情 |
| 3 | 问题处理 | `/teacher/issues` | 待办徽标 `openInterventions` |
| 4 | 数据统计 | `/teacher/statistics` | 聚合视图 |

账号与安全属于跨角色账户面，**不属于** Teacher 业务导航。平台治理和 AI 设置归 Admin。
「知识库」在 ADR 0008 中被提及为潜在第 5 项，但代码中**不存在**——标记为 planned，
新增前必须先改产品文档并评审（冻结 IA）。

## 2. 权限边界

- 只能读取当前有效 `mentor_assignments` 覆盖的学生。
- **一个学生同一时间只能有一个当前班主任**（`mentor_assignments_one_active_per_student_idx`）。
- 后端每个请求重新执行对象级授权；前端隐藏入口不构成权限。
- 学生成长、掌握度、项目阶段、审计和原始对话**不是** Teacher 可直接写入的对象。
- 学习评价、作品批准和教学干预写入口均已关闭；家校通信不构成学习进度的前置条件。
- 默认显示脱敏摘要和必要证据，不显示不必要的原始对话或原始音频。
- 无权学生不得通过错误消息、分页计数或空状态推断其存在。

## 3. 可执行工作流

```text
负责学生列表 → 查看授权学习记录 → 查看自动评价、学习问题与进展
```

Teacher **不能**直接：

- 推进项目阶段；
- 写入 `TheoryMastered` 或掌握度事件；
- 修改学生画像事实或 Agent 全局策略；
- 发布知识库、模板库或模型配置；
- 通过 HTTP 执行数据库迁移。

## 4. 页面状态

每个页面必须覆盖 `loading` / `empty` / `error` / `offline` / `permission-denied`。

## 5. 相关文档

- [`students.md`](./students.md)
- [`issues.md`](./issues.md)
- [`statistics.md`](./statistics.md)
- [`knowledge.md`](./knowledge.md)
- [`../admin/permissions.md`](../admin/permissions.md)
- [`../admin/platform-governance.md`](../admin/platform-governance.md)
## 2026-10-24 接入补充

名册、学生详情和统计复用 `learning-activity.v1`。学习时长标为估算；兼容字段 `weeklyTasks`/`tasksCompletedThisWeek` 当前只计服务端课时完成回执，界面统一显示“完成课时”。成长摘要使用已有安全投影。

学习支持请求读取当前分配学生项目中的 `escalation_event` 证据。教师只读问题、诊断和时间线；历史接手、关闭与教学恢复入口拒绝写入，换班主任后旧教师失去访问权。反馈继续复用已有 Feedback owner。
