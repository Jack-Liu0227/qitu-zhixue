# 成长档案持久化（迁移 0008 / `growth_records`）

本切片把成长轨迹从「仅进程内演示」迁移到**规范表 `growth_records`**（`packages/database/src/schema/growth-records.ts`，迁移 `0008_domain_foundation`，归属见 ADR 0006）。范围仅 `services/api/src/modules/growth/**`；未改动 schema、tutor、knowledge、templates、learning-plan 与任何 UI。

## 契约与投影（未变）

HTTP 与内部读契约保持同步返回，投影字段未变：

- 学生投影 `/students/me/growth`、`/students/me/growth/summary`、`/students/me/projects/summaries`；
- 家长投影 `/parent/children`、`/parent/children/:childId/growth`；
- 管理后台 / 家长导出继续调用 `GrowthService.getTimeline` / `getParentPage`（同步）。

`StudentGrowthEntry`、`ParentGrowthEntry`、`StudentGrowthSummary` / `ParentGrowthSummary` 字段集合与语义均未扩展。家长投影仍**不含** `evidenceIds` / `observationState` / 原始文本 / 风险标签。

## 持久化行为

`GrowthService` 依赖端口 `GrowthRecordStore`（`growth.persistence.ts`）：

| 模式 | 实现 | 读 | 写 |
|---|---|---|---|
| `live`（有 `DATABASE_URL`） | `PostgresGrowthRecordStore` | 启动 `onModuleInit` 从 `growth_records` **水合只读内存快照**，既有同步投影无需改 async | 先 `insert ... onConflictDoNothing(idempotency_key)` 落库，成功后同步更新快照 |
| `demo` / `test`（无 DB） | `InMemoryGrowthRecordStore` | 构造时灌入确定性演示 fixture | 只写进程内存 |
| `live` 却无 DB | 模块工厂直接抛错 | — | 绝不退化成内存假装持久化（`DatabaseModule` 已 fail-fast，这里再挡一层） |

- **只追加**：端口没有 update / delete；`growth_records` 只 `INSERT`。
- **幂等**：`idempotency_key` 唯一索引由数据库保证。同一键重试 `.returning()` 为空，回读既有行并返回 `replayed=true`，不产生第二条、不重复更新快照。
- **确定性 id**：`id = growth-<sha256(idempotencyKey)[:24]>`，崩溃后重放同一键得到同一 id。
- **幂等键来源**：调用方传入 `idempotencyKey`；缺省由内容按类型派生（`deriveGrowthIdempotencyKey`）——阶段完成用 `project+stage`、作品发布用 `artifactRef`、目标掌握用排序后的 `objectiveTitles`、反思用 `occurredAt`。
- **证据白名单**：写入前与**读回时**都跑 `normaliseEvidenceIds`（`growth.evidence.ts`）。未知来源（如 `raw_conversation`、`voice_transcript`、`risk_signal`）一律丢弃，历史脏数据也不会投影出去。
- **来源 / 可见性归一化**：`source ∈ {server, tutor, mentor}`，`visibility ∈ {student_private, guardian_visible, mentor_visible}`；未知值回落到 `server` / `student_private`（最小可见）。
- **演示 fixture 仅非 live**：`buildDemoRecords` 只在 `!store.persistent` 时构造并由 `seed()` 幂等灌入，正式环境永不写演示数据。

## 权限

- 学生读：作用域来自**会话**（`requireStudent` → `user.id`），不接受请求参数里的学生 id。
- 家长读：每次 `:childId` 路由先过 `canParentReadChild`（active 监护关系真源在 `DirectoryService`），越权 403。
- 模块**没有写路由**：两个控制器只有 `GET`（`growth.controller.readonly.test.ts` 断言）。
- 存储端口 `listByStudent(studentId)` 必须带学生参数，禁止无作用域读；`listAll()` 仅启动水合使用，返回内容只进服务端内存快照。

## 错误码 / 日志

- **无新增客户端错误码**：读接口沿用既有 401 / 403；存储故障表现为 500（live 下水合失败会 fail-fast，而非返回空档案）。
- **日志**：新增一条启动水合日志 `GrowthService：已从 growth_records 水合 N 条记录（只读快照）`，只含计数，不含任何记录正文、证据或未成年人数据。

## 测试

`services/api` 下 `node:test`，无需真实数据库：

```bash
pnpm typecheck
pnpm test   # 含 .tmp/test-dist/modules/growth/**/*.test.js
```

- `growth.evidence.test.ts`：证据白名单与「无证据 → 待观察」纯函数。
- `growth.service.test.ts`：证据往返、待观察、学生 / 家长投影禁字段扫描、演示数据证据完整。
- `growth.controller.readonly.test.ts`：无客户端写路径、AI搭档不引用 `GrowthService`。
- `growth.persistence.test.ts`（新增）：只追加 + 幂等重放、`listByStudent` 作用域、来源 / 可见性 / 证据归一化、Postgres 行 ↔ 领域记录纯映射（含读回再白名单）、`GrowthService` 写库与启动水合。

## Dual-write / cutover 说明

- **本切片 = 阶段 1（写切换 + 快照读）**：规范表成为写入真相；读仍走内存快照以保证同步契约。相当于「快照作为读缓存」的受控双读，不存在向两处业务表双写的分叉。
- **多实例局限**：每个实例启动时水合、写入后只更新**本实例**快照；其他实例要等各自重启才看到新记录。当前单节点模块化单体可接受。
- **阶段 2（读切换）**：把 `getTimeline` / `getParentPage` 改为 async 直查 `growth_records`，控制器与导出服务相应改为 `await`，然后移除内存快照与 `onModuleInit` 水合。届时 `listAll()` 可删除。
- **已知缺口（需另立 schema 迁移，不在本切片）**：`growth_records` 未建 `encouragement` 列，读回时为 `null`；如需持久化即时鼓励语，应新增列并回填，再让 `toGrowthStoredRecord` 读取。
- **未做**：RLS / `SET LOCAL` 租户隔离（`school_id` 目前仅由服务端写入并在类型层保留）、outbox 事件、跨模块（tutor / projects）调用 `record` 的接线。这些保持显式未实现，不以假成功代替。
