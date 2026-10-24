# 问题处理

2026-10-24 产品修订：教师只读学生学习记录、自动评价和问题。学生提交后由服务端自动评价、按反馈修订并推进，不再等待教师逐活动评价、作品批准或人工恢复。旧审批入口退役。策略与验证见 [自主学习评价](../issues/20261024-autonomous-learning.md)。

> Teacher 第 3 项（`/teacher/issues`，详情 `/teacher/issues/[id]`）。导航徽标
> `openInterventions`。承载学习问题的只读记录与反馈工单。
> 实现入口：`apps/teacher-workspace/app/(workspace)/issues/**`、
> `services/api/src/modules/teacher`、`services/api/src/modules/ai-tutor`（升级来源）、
> `services/api/src/modules/reminders`。

## 1. 问题从哪来

- **卡顿升级**：AI搭档服务端检测到 4 轮卡顿窗口或学生点击「我卡住了」（`stall_signal`），
  记录学习问题并继续自动补救，不暂停课程等待教师。记录由服务端执行，学生不能伪造完成状态。
- **错误分类**：判分后的 `structural / deviation / application / metacognitive` 归类。
- **反馈工单**：来自学生 / 家长的 `feedback` 通道。

## 2. 接口

```http
GET  /api/v1/teacher/interventions                学习问题只读列表
GET  /api/v1/teacher/interventions/:id            详情（含证据引用）
POST /api/v1/teacher/interventions/:id/actions    历史入口，返回 403 TEACHER_LEARNING_READ_ONLY
GET  /api/v1/teacher/feedback                     反馈工单列表
GET  /api/v1/teacher/feedback/:ticketId           详情
POST /api/v1/teacher/feedback/:ticketId/replies   回复（幂等 + 审计）
```

## 3. 只读学习问题

- 教师不能接手、关闭问题、重置教学会话或人工放行；历史动作入口拒绝执行，也不重放旧成功回执。
- 学习评价、补救、课时完成和项目阶段由对应服务端 owner 校验证据后推进。
- 问题读取沿用当前班主任分配的对象权限，撤销分配后立即失去访问权。家校反馈回复独立于学习进度。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 列表骨架 |
| empty | 无待办 → 明确「当前没有学习问题记录」 |
| error | 重试 |
| offline | 只读；禁止提交动作 |
| permission-denied | 403，不泄露对象存在性 |

## 5. 未决事项

- [ ] 「卡顿已正确升级」的可观测验收口径（G3）。
- [ ] 自动问题记录的频控与脱敏。
- [ ] 系统问题状态的来源与只读时间线口径。
- [ ] 反馈工单与学生端 / 家长端 `feedback` 的关联。

## 6. 相关文档

- [`students.md`](./students.md)
- [`../student/tutor.md`](../student/tutor.md) §3.1
