# 学生管理

2026-10-24 产品修订：教师只读学生学习记录、自动评价和问题。学生提交后由服务端自动评价、按反馈修订并推进，不再等待教师逐活动评价、作品批准或人工恢复。旧审批入口退役。策略与验证见 [自主学习评价](../../Plan/issues/20261024-autonomous-learning.md)。

> Teacher 第 2 项（`/teacher/students`，详情 `/teacher/students/[id]`）。
> 实现入口：`apps/teacher-workspace/app/(workspace)/students/**`、
> `services/api/src/modules/teacher`、`services/api/src/modules/directory`。

## 1. 页面构成

| 页面 | 内容 |
|---|---|
| 列表 | 当前有效 mentor assignment 覆盖的学生；脱敏摘要 |
| 详情 | 项目进度、学习摘要、掌握度安全投影、干预历史、反馈工单 |

## 2. 接口

```http
GET /api/v1/teacher/roster                       负责学生列表
GET /api/v1/teacher/students/:studentId          学生详情（授权后）
GET /api/v1/teacher/interventions                干预待办列表
GET /api/v1/teacher/interventions/:id            干预详情
POST /api/v1/teacher/interventions/:id/actions   干预动作（幂等）
GET /api/v1/teacher/feedback                     反馈工单列表
GET /api/v1/teacher/feedback/:ticketId           工单详情
POST /api/v1/teacher/feedback/:ticketId/replies  工单回复（幂等）
```

## 3. 授权与数据

- `roster` 只返回 `mentor_assignments` 中 `status='active'` 且 `mentor_user_id=本人` 的学生。
- 每个 `students/:studentId` 请求重新校验归属，越权返回 403。
- 能看到的成长上下文来自**服务的授权投影**（`growth` / `mastery`），不是直接读表。
- 家长或其他学生的信息不在可见范围。

## 4. 可做的与不可做的

| 可做 | 不可做 |
|---|---|
| 查看授权学习摘要 | 推进项目阶段 |
| 查看卡顿 / 升级记录 | 写 `TheoryMastered` / 掌握度 |
| 查看自动评价和问题记录 | 添加审批意见或改学生画像事实 |
| 创建 / 回复反馈工单 | 发布知识库 / 模板 / 模型配置 |
| 查看问题诊断与时间线 | 记录教学干预动作或执行数据库迁移 |

## 5. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 列表 / 详情骨架 |
| empty | 未分配学生 → 说明「暂无负责学生」 |
| error | 重试 |
| offline | 只读；禁止干预 / 回复 |
| permission-denied | 403，不泄露学生存在性 |

[相关计划与执行记录](../../Plan/maintenance/usage-records-20261028.md)。

## 7. 相关文档

- [`issues.md`](./issues.md)
- [`dashboard.md`](./dashboard.md)
- [`../admin/directory-and-relationships.md`](../admin/directory-and-relationships.md)
