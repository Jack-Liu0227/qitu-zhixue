# 班主任工作台 · 总览

> Teacher 面向班主任和平台导师，负责**已分配学生**的日常支持、问题处理、人工干预、
> 项目复核和统计。不负责平台知识库、模板库、数据库迁移、模型凭证或 AI runtime 治理。
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
- 干预、反馈、复核和升级必须经 owner 服务、幂等键和审计记录。
- 默认显示脱敏摘要和必要证据，不显示不必要的原始对话或原始音频。
- 无权学生不得通过错误消息、分页计数或空状态推断其存在。

## 3. 可执行工作流

```text
负责学生列表
  → 查看授权学习摘要
  → 处理卡顿 / 升级提醒
  → 添加人工指导或复核意见
  → 领域服务写入干预命令
  → 审计 + 通知 / outbox
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
