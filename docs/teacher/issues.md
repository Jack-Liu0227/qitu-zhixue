# 问题处理

> Teacher 第 3 项（`/teacher/issues`，详情 `/teacher/issues/[id]`）。导航徽标
> `openInterventions`。承载卡顿升级、干预待办与反馈工单。
> 实现入口：`apps/teacher-workspace/app/(workspace)/issues/**`、
> `services/api/src/modules/teacher`、`services/api/src/modules/ai-tutor`（升级来源）、
> `services/api/src/modules/reminders`。

## 1. 问题从哪来

- **卡顿升级**：AI搭档服务端检测到 4 轮卡顿窗口或学生点击「我卡住了」（`stall_signal`），
  生成班主任待办。升级由服务端执行，学生不能伪造完成状态。
- **错误分类**：判分后的 `structural / deviation / application / metacognitive` 归类。
- **反馈工单**：来自学生 / 家长的 `feedback` 通道。

## 2. 接口

```http
GET  /api/v1/teacher/interventions                干预待办列表
GET  /api/v1/teacher/interventions/:id            详情（含证据引用）
POST /api/v1/teacher/interventions/:id/actions    处理动作（幂等 + 审计）
GET  /api/v1/teacher/feedback                     反馈工单列表
GET  /api/v1/teacher/feedback/:ticketId           详情
POST /api/v1/teacher/feedback/:ticketId/replies   回复（幂等 + 审计）
```

## 3. 处理动作

- 每个动作经 owner 服务写入，**幂等键必填**，写 `audit_logs`，并触发通知 / outbox。
- 动作**不直接**改项目阶段、掌握度或成长事实——这些仍由对应 owner 服务判定。
- 升级待办走既有班主任分配模型；一个学生同一时间只有一个当前班主任。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 列表骨架 |
| empty | 无待办 → 明确「当前没有需要处理的问题」 |
| error | 重试 |
| offline | 只读；禁止提交动作 |
| permission-denied | 403，不泄露对象存在性 |

## 5. 未决事项

- [ ] 「卡顿已正确升级」的可观测验收口径（G3）。
- [ ] 自动升级 vs 手动干预的边界与频控。
- [ ] 干预动作语汇、关闭规则与重新打开。
- [ ] 反馈工单与学生端 / 家长端 `feedback` 的关联。

## 6. 相关文档

- [`students.md`](./students.md)
- [`../student/tutor.md`](../student/tutor.md) §3.1
