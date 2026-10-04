# 学习进度提醒（ISSUE-T2 / GitHub #6）——安全管线段

> **状态：部分完成 / 受评审门禁阻塞（PARTIAL — BLOCKED ON R-T2）**
>
> 本模块只实现「安全管线」：服务端权威的、白名单的、非医疗的提醒投递 /
> 关闭 / opt-out 数据流。**真实投递默认关闭**，必须等产品 / 隐私评审
> （风险 `R-T2`）出结论后才能显式开启。任何人不得在评审通过前把
> `QITU_REMINDER_DELIVERY_ENABLED` 设为 `true` 上线。

## 为什么是 PARTIAL

`docs/shared/ISSUES.md` 的 `ISSUE-T2` 状态为 `Proposed`，并被评审门禁 `R-T2`
（「提示被误读为医疗建议或对未成年人贴标签」）阻塞。因此本 PR：

- 只落地**管线**与**服务端权威决策**，不落地任何面向真实未成年人的默认投递；
- 门禁默认关闭（fail-closed）；
- 不新增数据库迁移（见下方「未落库」）；
- 不触碰 T3–T6 / T8 / `docs/shared/ISSUES.md` / DeepTutor。

**解除阻塞所需的签核**：产品与隐私评审对以下四点给出书面结论后，才可
（另一个 PR）开启门禁并落库：

1. 文案白名单本身（当前两条：休息建议、求助建议）；
2. 触发频率与上限（当前：每个停滞事实至多一条，24h 过期）；
3. 学生 opt-out 的默认与呈现方式；
4. 未成年人提醒数据的保留期与可见范围。

## 边界（硬约束）

- **不做**情绪 / 心情 / 诊断 / 风险标签 / 挫败推断 / 躯体分类。契约
  `packages/contracts/src/reminder.ts` 里没有这些字段，代码里也没有对应逻辑。
- **唯一触发源**：AI 搭档既有的「连续学习进度停滞」计数
  （`learning_progress_stall`），首次越过阈值（当前 4 轮）时上报一次。
  没有情绪输入、没有模型推断输入。
- **客户端不能提交模板 / 触发源**：`POST /reminders/preference` 的请求体经
  `pickFields` 白名单，只有 `optedOut` 一个字段；`POST /reminders/:id/dismiss`
  只接受路径 id。服务端文案来自白名单模板，客户端只读。
- **对象级权限**：所有读写以会话中的学生 id 为作用域；跨学生访问统一返回
  `REMINDER_NOT_FOUND`（404），不通过 403 / 404 差异探测他人提醒。
- **写操作幂等**：两个写接口都必须带 `Idempotency-Key`；同 key 重放不重复
  执行、不重复审计。
- **审计最小化**：只写 `templateId / source / category` 等元数据，绝不写原始
  对话、语音、模型输出或任何推断标签。
- **fail-closed**：评审门禁未通过、来源非法、轮数不足、存储不可用或学生已
  opt-out 时，一律不生成、不返回提醒。

## 接口

| 方法 | 路径 | 说明 | 需要幂等键 |
|------|------|------|-----------|
| `GET`  | `/api/v1/reminders` | 读取可投递提醒 + 门禁状态 + opt-out 状态 | 否 |
| `POST` | `/api/v1/reminders/:id/dismiss` | 「知道了」 | 是 |
| `POST` | `/api/v1/reminders/preference` | 关闭 / 重新打开提醒 | 是 |

错误码（`packages/contracts/src/errors.ts`，仅新增，不改动既有码）：

- `REMINDER_NOT_FOUND`（404）：不存在或不属于当前学生；
- `REMINDER_ACTION_NOT_APPLICABLE`（409）：提醒已过期；
- `REMINDER_PREFERENCE_INVALID`（400）：`optedOut` 缺失或非布尔；
- `REMINDER_UNAVAILABLE`（503）：存储能力不可用，诚实失败。

## 五态 UI 兼容

`reminder.ui-state.ts` 的纯函数把请求生命周期映射到
`loading / empty / ready / error / offline / permission-denied`，四个平台共用，
单测见 `reminder.ui-state.test.ts`。服务端保证 `empty`（空数组）与
`permission-denied`（401/403）可表达；`loading / error / offline` 由客户端据
网络与状态码推导。

## 未落库（评审通过前的刻意选择）

当前只有 `InMemoryReminderStore`（demo / 单测）。**没有**数据库表与迁移：
在隐私评审结论未定前，不把未成年人相关提醒持久化。后果：

- 进程重启后提醒丢失；
- 多实例间不共享；
- 因此写操作的幂等与审计在未配置 `DATABASE_URL` 时会由底层能力诚实返回
  503——这是预期行为，不是缺陷。

评审通过后需要补：`reminders` 表 + `reminder_preferences` 表 + 迁移 +
`PostgresReminderStore`，并把 `RemindersModule` 的存储 provider 按
`DATABASE_TOKEN` 切换（参考 `ProjectsModule` / `ParentModule` 的写法）。

## 接线

- `RemindersModule` 通过 `LearningStallSignalSink` 抽象对外暴露能力；
- `AiTutorModule` 导入 `RemindersModule`，`TutorService` 在连续卡顿首次越过
  阈值时调用 `ingestStallSignal(...)`，只在**首次**越过时上报一次；
- `TutorService` 对 sink 是**可选依赖**：未接线时回合照常完成（fail-closed）。

## 测试

```
pnpm --filter @qitu/database build   # 首次需要先构建依赖
pnpm --filter @qitu/api test
```

覆盖：门禁 fail-closed、阈值与去重、白名单来源、opt-out、跨学生 404、
dismiss / 偏好幂等、审计无原始内容、模板非医疗断言、五态投影、接缝上报。
