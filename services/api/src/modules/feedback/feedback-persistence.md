# 反馈工单持久化与通知事件（ISSUE-FEEDBACK / #11）

家长反馈闭环的**服务端真相**：把原先进程内的 `feedback_tickets` 落到 PostgreSQL，
并让「业务写入 + 审计 + 通知事件」在同一事务内完成。目标是既补齐持久化与幂等，
又**不假装**尚未实现的投递 / 对象存储。

## 契约

契约在 `@qitu/contracts`：`SubmitParentFeedbackRequest` / `SupplementParentFeedbackRequest` /
`ConfirmParentFeedbackRequest` / `ReplyTeacherFeedbackRequest`，以及读模型
`ParentFeedbackTicket`（含 `entries` 时间线、`owner`、`handledIn`）与班主任列表行
`TeacherFeedbackRow`。`source` 为 `general | message | project`，`status` 为
`processing | replied | resolved | reopened`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/parent/feedback` | 提交反馈，要求 `Idempotency-Key`，返回 `{ ticketId, status, createdAt }` |
| `GET` | `/parent/children/:childId/feedback` | 家长读某孩子的工单列表（对象级授权） |
| `GET` | `/parent/feedback/:ticketId` | 工单详情 |
| `POST` | `/parent/feedback/:ticketId/supplements` | 家长补充 |
| `POST` | `/parent/feedback/:ticketId/confirmations` | 家长确认解决 / 重开 |
| `GET` | `/teacher/feedback` | 当前班主任名下学生工单列表 |
| `GET` | `/teacher/feedback/:ticketId` | 班主任读详情（非本班 → 403 `STUDENT_NOT_ASSIGNED`） |
| `POST` | `/teacher/feedback/:ticketId/replies` | 班主任回复 |

## 持久化

迁移 `0005_nostalgic_shotgun` 新增两张表：

- `feedback_tickets`：工单头（`child_user_id` 可空、`parent_user_id`、`source`、
  关联对象、`status`、`problem` 快照、时间戳）；
- `feedback_ticket_entries`：不可变时间线（同工单内 `seq` 唯一递增、`kind`、
  作者、正文、`attachment_refs`、`resolved`）。

`FeedbackStore` 是抽象端口，服务层只依赖它：

- `PostgresFeedbackStore`（live，必需 `DATABASE_URL`）；
- `InMemoryFeedbackStore`（仅 `demo` / `test`）。

`feedback.module.ts` 按 `DATABASE_TOKEN` / `DATA_MODE_TOKEN` 选择实现；`live` 却无
连接时**直接抛错**，不退化成内存假装持久化（与 `ExplorationStore` 同思路）。并发
同 id 写入由主键唯一约束兜底，捕获 `23505` 后回读已存在记录。

## 写入原子性

`createTicket` / `appendEntry` 把业务行、审计与 outbox 事件一起在**同一个
`withTransaction`** 内提交：

- 审计由 `AuditWriter.write(entry, tx)` 写入（只记过程事实：谁、对哪张工单、什么
  动作，**不含反馈原文**）；
- 通知事件由 `OutboxWriter.write(event, tx)` 写入 `outbox` 表，初态 `pending`。

任一环节失败则整个事务回滚——不会出现「工单落库但审计 / 通知丢失」的裂缝。

## 幂等

写操作全部经 `IdempotencyStore.execute`（`(scope, key)` 唯一、同 key 异载荷
`IDEMPOTENCY_CONFLICT`）。此外工单 id 与时间线事件 id 由**请求指纹**派生
（`ft-` / `fe-` + `requestHash`）：即使「业务事务已提交、幂等结果因崩溃未写回」，
重放同一幂等键也会得到同一 id，由 store 识别为已存在而**不追加**第二条记录、不
重复写审计与 outbox。非法状态迁移（`FEEDBACK_TRANSITION_INVALID`）在 handler 内
判定，因此失败可被重试而不是永久占用幂等键。

## 通知事件语义（重要）

`common/outbox/` 只提供**事件写入与状态判定**，不接线任何消费者：

- 主题：`feedback.ticket.submitted | supplemented | replied | confirmed | reopened`；
- 载荷**最小化**：`ticketId / childId / entryId / status / source`，不放反馈正文与
  附件；写入前再经 `redactSensitive` 递归脱敏；
- 状态：新事件恒为 `pending`（`attempts=0`、`lastError=null`）。`decideOutboxFailure`
  在每次失败后决定回到 `pending`（可重试）还是进入终态 `failed`（可观测），失败
  原因里的明文凭据会被值级擦除。

**当前没有 worker**（`services/workers` 仍是初始化桩），因此事件会诚实地停留为
`pending`，不会假装已发送。这是本切片的已知阻塞，而不是隐藏的降级。

## 附件

附件归属仍走 `FeedbackAttachmentRegistry` 端口，**不**实现对象存储：

- `demo` / `test`：`InMemoryFeedbackAttachmentRegistry`；
- `live`：`RejectingFeedbackAttachmentRegistry` **失败关闭**——无法证明归属时一律拒绝
  非空 `attachmentRefs`，绝不退回进程内登记表（多实例下不共享，会静默放过越权引用）。

## 如何运行测试

`node:test`，不依赖 Postgres（用进程内 store 替身）：

```bash
cd services/api
pnpm test   # tsc 编译到 .tmp/test-dist，再跑 common/access、common/outbox、modules/feedback
```

覆盖：对象级授权（家长 / 班主任、无孩子队列）、状态机、幂等重放与冲突、崩溃后
确定性 id 重放不追加记录、审计失败整单回滚、审计与通知事件不含原文、附件归属、
outbox 初态与 failed 终态判定。

## 已知阻塞（不在本切片内）

- **worker 与通知投递**：`services/workers` 未实现消费者，`outbox` 行停留 `pending`；
  投递、重试调度、`notifications` 投影与幂等消费需要独立的 worker 切片。
- **对象存储与附件归属表**：`packages/file-uploader` 只有类型；live 下附件按失败
  关闭处理，接入真实上传服务后替换 `FeedbackAttachmentRegistry` 实现即可。
- **无孩子工单的受理队列**：`general` 且无 `childId` 的工单当前只绑定提交家长，
  进入受限队列；普通班主任不可见（403 `STUDENT_NOT_ASSIGNED`），工单池的分配 /
  认领流程待产品确认。
