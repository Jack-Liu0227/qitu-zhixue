# AI 平台改造任务完成进度

更新时间：2026-09-29
当前主分支：`main`
当前工作树：干净

## 总体结论

本轮已完成启途智学 AI 平台的第一版可持续演进底座：

- 学校作用域与平台共享资产的 PostgreSQL 数据模型。
- Tutor SDK、AI Tutor 会话/回合持久化。
- 4/8 周学习计划、判分、掌握度和 TheoryMastered 门控。
- 验证模板库、知识库作用域和学生作品服务。
- 成长记录持久化。
- Redis、缓存、分布式锁和 at-least-once 队列基础设施。
- 学生端 AI 搭档伙伴式 UI。
- Qwen 3.8 Flash 模型注册预置。
- 迁移、种子、测试和交接文档。

## 已合并提交

| Commit | 内容 |
|---|---|
| `d6efec35` | Tutor SDK、模板/知识工作区和 AI 搭档 UI 基础 |
| `219041bc` | 单校作用域、模板、知识、学习计划、掌握度、成长 schema，迁移 0008 |
| `01635f1f` | GrowthService 接入 canonical `growth_records` |
| `f6f348ef` | 共享项目模板库和治理 API |
| `7b46fcb6` | Tutor session/turn PostgreSQL 持久化和重放幂等 |
| `cf72cf73` | 三阶段数据库种子统一接线 |
| `06d91ea2` | 作用域知识库和检索 API |
| `a2ddc24e` | Redis、缓存、分布式锁、队列基础设施 |
| `99e99459` | 4/8 周学习计划、掌握度、题库和 TheoryMastered |
| `fb3c5bb0` | 验证报告、作品、项目证据、pending question schema，迁移 0009 |
| `92ecb19e` | pending question 生命周期持久化 |
| `30c82e48` | 模板验证报告和证据持久化 |
| `9bcb8eb6` | 作品、版本、发布、签名 URL、服务端 project evidence |
| `306e285b` | 学习回答原子提交、关系同校校验和跨校读取过滤 |

## 已完成能力

### 数据与作用域

- `schools` 作为学校作用域根。
- `users.school_id` 已接入。
- 平台共享模板使用 `school_id = NULL`。
- 校级模板和知识使用明确学校作用域。
- 学生私有成长、记忆、掌握度和作品使用 `student_id`。
- 家长关系通过 `guardian_links`。
- 教师关系通过 `mentor_assignments`。
- 新增关系写入和关系读取的同校校验。

### Tutor 与 AI SDK

- Tutor SDK 已独立封装上下文、伙伴、模板证据、知识证据、记忆和成长信号。
- Tutor session 和 turn 在 live 模式写入 PostgreSQL。
- seq、回合、幂等和服务端授权可跨进程恢复。
- 原始助手输出继续使用结构化 block，不开放 Markdown 绕过答案泄露边界。
- demo/test 保留明确的内存实现，live 缺数据库时 fail-fast。

### 学习计划

- 支持 4 周和 8 周计划。
- 计划结构为 module → objective → session。
- 模型输出必须经过结构校验。
- 学生确认意图前不会创建正式项目。
- 理论未掌握前实践接口返回 `THEORY_MASTERED_REQUIRED`。
- 题目下发时不暴露 `expectedAnswer` 和 `explanation`。
- pending question 已跨回合持久化。
- 回答题目、pending 状态、mastery attempt、mastery record 已使用原子 store 接口。

### 模板库

- 学生只能读取已发布的平台模板和本校模板。
- 管理员可治理平台模板，教师只能治理本校模板。
- 模板版本不可变。
- 支持发布、归档、回滚为新 draft 版本。
- 发布必须同时满足：项目完成、理论掌握、实践掌握、作品通过、班主任复核通过。
- 验证报告和证据已写入 `template_verification_runs` / `template_verification_evidence`。

### 知识库

- 支持 `system | school | project | student` scope。
- 只有 verified 文档进入检索。
- 学生、教师、家长、项目和学校的读取边界在服务端执行。
- 禁止把 tutor 原始对话、原始语音直接写进通用知识库。
- 当前检索为 bounded keyword retrieval。

### 作品与成长

- 作品支持草稿、版本、提交、班主任审核、发布、撤回。
- 版本使用 `If-Match`/CAS，旧版本不可原地覆盖。
- 作品数据使用私有对象存储引用和签名 URL 边界。
- `project_evidence` 只能服务端聚合，客户端没有写接口。
- 成长记录改为 append-only canonical `growth_records`，支持幂等和证据白名单。

### Redis 与分布式基础设施

- `@qitu/infra` 提供 Redis adapter、no-op adapter、cache、lock、queue。
- key builder 强制带 global/school/student scope。
- Redis lock 使用 token compare-and-delete。
- 队列支持 at-least-once、重试和死信。
- demo/test 无 Redis 时显式 no-op；live 请求 Redis 能力时 fail-fast。

## 验证结果

```text
pnpm typecheck                              PASS
pnpm --filter @qitu/student-center build   PASS
pnpm --filter @qitu/api typecheck           PASS
pnpm --filter @qitu/api test                234 passed / 0 failed
pnpm --filter @qitu/infra test              36 passed / 0 failed
pnpm --filter @qitu/ai-client test          PASS
pnpm --filter @qitu/database generate       no schema changes
pnpm --filter @qitu/database exec tsx src/seed.ts --check PASS
git diff --check                           PASS
```

## 最终 Review

独立不同模型家族 review 判定为 `FIX-MAJOR`，指出两个 P1：

1. 学习计划回答存在 pending 已完成但 mastery 写入失败的半状态风险。
2. 家长/教师关系缺少 school scope 约束，可能造成跨校关系读取。

两项均已在 `306e285b` 修复，并重新通过 API 234/234 测试。

Review 指出的 P2 仍需后续处理：

- 部分新写入路径的 `school_id` 仍为 null。
- 模板验证 evidence 的 `student_user_id` 尚未细化到每条证据。
- RLS 尚未启用。
- pgvector 尚未启用。
- Tutor Redis 分布式锁接线尚未完成。
- Works likes/stats、task submissions、reflections 尚未建模。

## Worktree 合并状态


## 后续基线（2026-10-02）

掌握度时间线已提升为一等领域能力，但 Graphiti 不作为权威层。后续优先级为：

1. 修复掌握度事件、审计和 outbox 的事务闭环；
2. 增加不可变 `mastery_events`、canonical KnowledgePoint 和历史快照；
3. 将成长轨迹和项目门槛统一接入 `MasteryTimelinePort`；
4. 通过独立 PoC 决定是否启用 Graphiti shadow projection。


## 掌握度时间线接入进度（2026-10-02）

已完成：

- `@qitu/contracts` 掌握度事件、双时态查询、投影和浏览器只读合同；
- `mastery_events`、显式 objective→KnowledgePoint mapping、当前投影字段和 0011 migration；
- `@qitu/api-client` 的 `sdk.mastery` 只读 facade；
- Nest mastery current/timeline/snapshot/threshold/regression 查询模块；
- quiz / practice evidence 的 attempt、mastery、event、audit、outbox 同事务提交；
- 历史 current/threshold、跨课程版本区间、未知/撤销语义、cursor、参数白名单、授权和共享 store 回归测试已纳入标准命令。

- Graphiti projection scaffold 已落地：`services/graphiti/bridge.py`、`services/workers/src/mastery-projection-worker.ts`、`mastery_graph_receipts` 和 0012 migration；外部 Graphiti/Neo4j 未配置时保持 disabled；
- [x] 统一 `QituSDKFactory/createQituSDK`：scope 绑定、mastery/agent/project/profile ports、浏览器只读 facade。
- [x] 项目 can-advance/advance：服务端门槛、幂等、审计和 outbox。
- [x] Graphiti projection scaffold：bridge、receipt、租约、重试、rebuild/reconcile；真实图库环境验收待完成。

未完成：

- 真实 Graphiti/Neo4j round-trip、外部图库备份恢复和生产规模性能；
- canonical KnowledgePoint 的课程治理和历史数据回填；
- 更细粒度的 KnowledgePoint 聚合锁和真实 PostgreSQL 并发压力测试。

当前验证：`pnpm --filter @qitu/api test` 通过 **250/250**（236 项原有/事务用例 + 14 项
mastery 只读回归用例）；API/contracts/api-client/workers typecheck 通过。此前 236 项结果不包含
mastery 查询测试，不能替代本次复验。数据库 `0000..0012` 临时空库 replay、`0011` 和
`0012` down migration 已通过；真实 Graphiti 依赖未安装，因此未声称 round-trip 已通过。