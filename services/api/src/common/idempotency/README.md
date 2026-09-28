# 持久化幂等基础（IdempotencyService）

> 范围：仅提供**基础能力**与全局模块。本任务**未**接入任何现有控制器，现有写接口的
> 进程内 Map / platformData 幂等逻辑保持原样，由后续 PR 按本文指引迁移。

## 1. 文件与职责

| 文件                      | 职责                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `idempotency.types.ts`    | 类型契约（`IdempotentHandler` / `IdempotencyResult` / 选项）。纯类型。               |
| `idempotency.hash.ts`     | 稳定序列化 + SHA-256 指纹（`hashRequest` / `hashIdempotentInput`）。纯函数。         |
| `idempotency.decision.ts` | 记录状态机判定 `replay / conflict / reclaim`。纯函数。                               |
| `idempotency.errors.ts`   | `IdempotencyError`（`ApiErrorCode` 子集）与 HTTP 翻译。                              |
| `idempotency.service.ts`  | 持久化读写、认领 / 重放 / 回收、脱敏、清理。                                         |
| `idempotency.module.ts`   | `@Global()` 的 `IdempotencyModule`，导出 `IdempotencyStore` / `IdempotencyService`。 |
| `idempotency.*.test.ts`   | 纯函数单测 + 真实 Postgres 集成测试（无 `DATABASE_URL` 时自动 skip）。               |

数据库侧已存在（**本任务未改动**）：
`packages/database/src/schema/idempotency.ts`、迁移 `database/migrations/0001_cheerful_colossus.sql`
（`idempotency_keys` 表 + `(scope, key)` 唯一索引 + `expires_at` 索引）。

## 2. API

```ts
import { IdempotencyStore } from '../../common/idempotency';

constructor(private readonly idempotency: IdempotencyStore) {}

const result = await this.idempotency.execute(
  'POST /api/v1/projects',          // scope：操作身份
  idempotencyKey,                    // 来自 Idempotency-Key 请求头
  hashIdempotentInput('POST /api/v1/projects', {}, body), // 请求指纹
  async () => ({ status: 201, body: createdProject }),
  { retentionMs: 24 * 60 * 60 * 1000, processingLeaseMs: 60 * 1000 }, // 可选
);
// result = { status, body, replayed }
```

- `execute` 保证：首次执行 handler 并持久化 `response_status` / `response_body`；
  同 scope + key + hash 重放首次响应且**不重复执行**；同 scope + key 但 hash 不同抛
  `IDEMPOTENCY_CONFLICT`。
- `cleanupExpired(now?)` 删除过期的**终态**记录（`succeeded` / `failed`），返回删除行数；
  可由外部定时任务调用（本任务不引入调度器）。

## 3. 并发语义（为什么不会双执行）

底座是 `idempotency_keys (scope, key)` **唯一索引**，配合两条单语句原子操作：

1. **认领**：`INSERT ... ON CONFLICT (scope, key) DO NOTHING RETURNING id`
   （autocommit）。并发时 Postgres 唯一索引串行化：只有一个请求插入成功成为执行者，
   其余请求返回空集后走「已存在记录」分支。
2. **回收**：`UPDATE ... SET status='in_progress', expires_at=now()+lease
WHERE scope=? AND key=? AND request_hash=? AND (status='failed' OR
(status='in_progress' AND expires_at <= now())) RETURNING id`。
   条件写在 `WHERE` 里，行锁保证并发回收只有一个成功，其余视为冲突。

状态机（纯函数 `decideIdempotencyAction`）：

| 已存 status            | hash 相同                         | hash 不同  |
| ---------------------- | --------------------------------- | ---------- |
| `succeeded`            | `replay`（返回首个 response）     | `conflict` |
| `failed`               | `reclaim`（无成功结果，允许重试） | `conflict` |
| `in_progress` 租约未到 | `conflict`                        | `conflict` |
| `in_progress` 租约已到 | `reclaim`                         | `conflict` |

- **`expires_at` 双重用途**：`in_progress` 阶段是执行租约，回收判定用它；完成后改写为
  保留期截止，`cleanupExpired()` 用它。
- **租约调参**：`processingLeaseMs` 默认 60s，**必须长于 handler 最坏耗时**。若 handler
  超时且被并发回收，两个执行者都可能有副作用；此时 `markSucceeded` 更新 0 行，仅打
  warn 日志，不抛错。对慢调用（外部模型）请显式调大。
- **failed 语义**：失败记录可被同 hash 重试（`reclaim` 后重新执行），成功后转为 `succeeded`。

## 4. 无 `DATABASE_URL` 的行为

`IdempotencyService` 注入 `DATABASE_TOKEN`；为 `null` 时：

- 记 error 日志（只含 scope，不含请求内容）；
- 抛 Nest `ServiceUnavailableException`（HTTP **503**）；
- **绝不**退回内存执行，也不假装成功。宁可写操作不可用，也不能重复执行。

## 5. 响应脱敏与审计边界

- `response_body` 落库前经 `redactSensitive`（复用 `common/audit/audit-redaction.ts`）
  递归脱敏，`apiKey` / `password` / `token` / `authorization` 等命中键整棵子树替换为
  `[REDACTED]`；失败记录的 `error` 文本同样脱敏。
- 本能力**不写任何审计记录**。审计仍是 `AuditWriter` 的职责，两者不要混用。
- 首次执行返回给调用方的也是脱敏后的 body，保证「首响应 == 重放响应」。

## 6. 控制器接入清单（本任务未接入）

以下写接口仍需迁移到 `IdempotencyStore`，迁移时删除各自的进程内逻辑：

| 文件                                                                      | 现状                                                    | 说明                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `modules/admin/directory-admin.controller.ts`                             | 字段 `idempotencyStore = new Map()`（6 个写接口）       | 内存 Map，重启即失效、多实例不共享。**优先迁移**。 |
| `modules/parent/parent.controller.ts`                                     | 依赖 `platformData.recordEncouragement(...)` 等内存幂等 | 3 个写接口（鼓励 / 消息 ack / 反馈）。             |
| `modules/teacher/teacher.controller.ts`                                   | `POST interventions/:id/actions`                        | 干预写入需幂等（AGENTS.md 明确列出）。             |
| `modules/ai-tutor/tutor.controller.ts`                                    | body 携带 `idempotencyKey`                              | session / turn 写入。                              |
| `modules/growth/growth.controller.ts`                                     | 无显式幂等                                              | 成长记录为服务端所有，写入如需幂等再接入。         |
| `modules/model-registry/*`、`modules/settings/model-config.controller.ts` | 无显式幂等                                              | 管理配置写入，按需接入。                           |

接入步骤：

1. 注入 `IdempotencyStore`（模块已 `@Global()`，无需 import 模块）。
2. 校验 `Idempotency-Key`：缺失即抛 `BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' })`。
3. 用 `hashIdempotentInput(scope, pathParams, body)` 计算指纹。
4. 把「校验 + 写业务表」整体包进 `execute` 的 handler，返回值用
   `{ status, body }`（创建类接口显式给 201）。
5. 捕获 `IdempotencyError`，用 `throwHttpForIdempotencyError(error)` 翻译成 400 / 409。
6. 把业务写入与 `execute` 内部记录放在**同一可重试边界**内：若业务写库成功但记录写回失败
   （仅租约超时才会发生），以业务侧唯一约束为最终真相，不要重复建对象。

> 注意：`execute` 的 handler 在独立于 `idempotency_keys` 写语句的边界外执行；若要业务写入
> 与幂等记录原子，需业务侧自行用 `withTransaction` 包裹业务写入，幂等记录仍由本服务管理
> （当前版本未接受外部事务句柄，属后续增强）。

## 7. 错误码

- 复用已冻结的 `IDEMPOTENCY_CONFLICT`（409）与 `IDEMPOTENCY_KEY_REQUIRED`（400），
  **未新增、未修改**任何 `ApiErrorCode`。

## 8. 验证

```bash
# 类型与构建
pnpm --filter @qitu/api typecheck
pnpm --filter @qitu/api build

# 纯函数单测（编译后运行）
cd services/api
npx tsc -p tsconfig.json
node --test dist/common/idempotency/idempotency.hash.test.js \
           dist/common/idempotency/idempotency.decision.test.js \
           dist/common/idempotency/idempotency.service.test.js

# 真实 Postgres（连接串仅 inline，不落盘；无 DATABASE_URL 时自动 skip）
DATABASE_URL='postgres://user:pass@127.0.0.1:5432/qitu_test' \
  node --test dist/common/idempotency/idempotency.integration.test.js
```

集成测试覆盖：首次执行落库、同 hash 重放（handler 只调一次）、不同 hash 冲突、
并发同 key（唯一约束兜底，handler 只调一次）、响应体脱敏、失败重试、过期清理。
