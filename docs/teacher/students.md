# 学生管理

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
| 处理卡顿 / 升级提醒 | 写 `TheoryMastered` / 掌握度 |
| 添加人工指导或复核意见 | 改学生画像事实 |
| 创建 / 回复反馈工单 | 发布知识库 / 模板 / 模型配置 |
| 记录干预动作（经 owner + 审计） | 执行数据库迁移 |

## 5. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 列表 / 详情骨架 |
| empty | 未分配学生 → 说明「暂无负责学生」 |
| error | 重试 |
| offline | 只读；禁止干预 / 回复 |
| permission-denied | 403，不泄露学生存在性 |

## 6. 未决事项

- [ ] 掌握度安全投影对学生详情页的字段范围。
- [ ] 干预动作的完整语汇与幂等范围。
- [ ] 反馈工单与 `feedback` 模块的合并 / 归属。

## 7. 相关文档

- [`issues.md`](./issues.md)
- [`dashboard.md`](./dashboard.md)
- [`../admin/directory-and-relationships.md`](../admin/directory-and-relationships.md)
