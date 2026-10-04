# 消息与反馈

> Parent 第 3 项（`/parent/messages`）。班主任 / 系统消息、家长回复、反馈工单。
> 实现入口：`apps/parent-companion/app/(protected)/messages/**`、
> `services/api/src/modules/parent`、`services/api/src/modules/feedback`。

## 1. 内容

- 来自班主任或系统的消息与反馈。
- 需要家长配合的提醒与明确行动。
- 反馈工单：提交、补充、确认。

## 2. 接口

```http
GET  /api/v1/parent/children/:childId/messages     消息列表
POST /api/v1/parent/children/:childId/messages/:messageId/ack   已读（幂等）
POST /api/v1/parent/feedback                       提交反馈（幂等）
GET  /api/v1/parent/children/:childId/feedback     反馈工单列表
GET  /api/v1/parent/feedback/:ticketId             工单详情
POST /api/v1/parent/feedback/:ticketId/supplements 补充（幂等）
POST /api/v1/parent/feedback/:ticketId/confirm     确认（幂等）
```

## 3. 规则

- 消息与工单都按 `guardian_link` 授权，只展示本人孩子相关内容。
- 家长回复 / 补充 / 确认均为写操作，必须携带 `Idempotency-Key` 并记审计。
- 家长**不能**通过消息修改孩子项目阶段、掌握度或成长事实。
- 家长提交的反馈进入工单流，由班主任在问题处理页处理。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 列表骨架 |
| empty | 无消息 → 明确「暂无消息」 |
| error | 重试 |
| offline | 只读；禁止提交，保留草稿 |
| permission-denied | 403 页面 |

## 5. 未决事项

- [ ] 通知渠道（站内 / 邮件 / 其他）与偏好设置。
- [ ] 消息模板与班主任发送入口。
- [ ] 工单 SLA 与升级规则。

## 6. 相关文档

- [`home.md`](./home.md)
- [`../teacher/issues.md`](../teacher/issues.md)
