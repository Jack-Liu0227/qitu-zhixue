# 数据库与表归属

> 状态：PostgreSQL 为唯一 system of record（ADR 0001 第 5 条、产品文档 1.2 / 8.2）。
> 本文描述**目标结构**与**当前已落地部分**，未实现的部分明确标注。
> 关联：`docs/decisions/0003-database-access-layer.md`（Drizzle 选型）、
> `docs/decisions/0006-domain-module-storage.md`（表归属）、`database/README.md`。

## 1. 分工：代码包 vs 产物目录

| 位置 | 角色 | 内容 |
|---|---|---|
| `packages/database/` | **代码包**（schema + client） | Drizzle schema、`createDb()`、`withTransaction()`、`seed.ts` |
| `database/migrations/` | **产物目录** | `drizzle-kit generate` 产出的前向 SQL 与 `.down.sql` |
| `database/seeds/` | **产物目录** | 确定性演示数据（唯一种子真源） |
| `database/fixtures/` | **产物目录** | 隔离测试 fixture，禁止生产数据 |

分工原则来自 ADR 0003：schema 是可被 API import 的代码，迁移是可逐行评审的 SQL 产物。

> **运行时规则**：`packages/database` 导出了运行时值（`createDb` / `withTransaction`），
> 因此 `services/api` 在运行时 require 的是它的 `dist/`，**必须先 build**。
> `tooling/start-qitu-services.sh` 已内置这一步。纯类型的 `@qitu/contracts` 不需要 build。
>
> **数据模式**：`services/api` 由 `QITU_DATA_MODE=live|demo|test` 决定引擎（默认 `live`）。
> `live` 必须有 `DATABASE_URL`，缺失或 client 无法创建则 **fail-fast**；只有显式 `demo`/`test`
> 且非 production 才允许无库的内存 Directory 引擎。详见 `docs/INITIALIZATION.md` §5。

## 2. Schema 约定

- **主键**：`text`（便于内联固定 id 与迁移/种子对齐；不强制 UUID）。
- **时间**：一律 `timestamp with time zone`，默认 `now()`。
- **状态**：`text` + 应用层枚举，不使用数据库 enum（便于手工迁移与灰度）。
- **JSONB**：草稿内容、模板阶段数组、context packet、审计 detail。
- **部分唯一索引**：用于业务硬约束（见下）。
- **大小写不敏感唯一**：`users` 用 `uniqueIndex('users_email_lower_idx').on(sql\`lower(email)\`)`，
  不依赖 `citext` 扩展。
- **迁移前向**：`database/migrations/` 只增不改；每个迁移配 `.down.sql` 回滚说明。
- **幂等 DDL**：`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`、
  `ADD CONSTRAINT ... EXCEPTION WHEN duplicate_object`，保证空库可重放。

### 已落地的硬约束（真实存在于迁移，非仅 schema 代码）

```sql
-- 一个学生同一时间只能有一个当前班主任
CREATE UNIQUE INDEX mentor_assignments_one_active_per_student_idx
  ON mentor_assignments (student_user_id) WHERE status = 'active';

-- 同一父/学生只允许一条 active 监护关系
CREATE UNIQUE INDEX guardian_links_active_unique_idx
  ON guardian_links (parent_user_id, student_user_id) WHERE status = 'active';

-- 邮箱大小写不敏感唯一
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- 审计幂等键唯一
CREATE UNIQUE INDEX audit_logs_idempotency_key_idx ON audit_logs (idempotency_key);

-- 同一个业务作用域和幂等键只保存一个结果
CREATE UNIQUE INDEX idempotency_keys_scope_key_idx
  ON idempotency_keys (scope, key);

-- 同一供应商下模型 id 唯一（Provider 内自然主键，0002 建表时内联声明）
-- CONSTRAINT model_models_pkey PRIMARY KEY (provider_id, model_id)

-- 删除供应商 / 模型不得静默破坏用途绑定：以下外键均为 ON DELETE RESTRICT
--   model_models.provider_id                  -> model_providers.id
--   model_usage_bindings.provider_id          -> model_providers.id
--   model_usage_bindings (provider_id, model_id) -> model_models (provider_id, model_id)
```

## 3. 表归属（单一写入者）

每个模块只能写自己 owner 的表；跨模块写走命令 / 事件 / outbox。**加粗**为当前已建表。

| 模块（owner） | 表 |
|---|---|
| Identity & Access | **`users`**、**`households`**、**`guardian_links`**、**`mentor_assignments`**、`roles`、`identities`、`sessions`、`student_profiles`、`mentor_profiles`、`consents` |
| Cross-cutting Operations | **`audit_logs`**、**`outbox`**、**`idempotency_keys`** |
| Projects & Learning | `project_templates`、`project_template_versions`、`recommendation_sessions`、`recommendation_items`、`exploration_sessions`、`exploration_turns`、`intent_confirmations`、`projects`、`project_stages`、`project_tasks`、`learning_sessions`、`learning_events`、`theory_modules`、`theory_checks`、`practice_tasks` |
| AI Tutor | `tutor_sessions`、`tutor_turns`、`context_snapshots` |
| Works | `artifacts`、`artifact_versions`、`evidence`、`review_records` |
| Growth | `growth_snapshots`、`milestones` |
| Mentor Ops | `alerts`、`interventions`、`feedback_tickets`、`knowledge_documents`、`knowledge_chunks` |
| Parent Experience | `notifications`（读取投影，不建独立业务表）、**`parent_growth_exports`**（0003，家长成长导出任务 + 脱敏正文快照） |
| Admin & Compliance | **`audit_logs`**、**`outbox`**、`ai_jobs`、`ai_runs`、`ai_events`、`ai_artifacts`、`ai_approvals`、`model_usage` |
| Model Registry | **`model_providers`**、**`model_models`**、**`model_usage_bindings`**（对应 Provider / Model / Usage，0002 已建） |

> `model_usage`（产品文档 8.1）目前未建，由 `model_usage_bindings` 承担用途绑定。
> 三层配置表结构已建（0002）；但 `model-registry` service 仍只写进程内存，尚未读写这些表，
> 密钥加密 / secret manager 也未接入（`secret_ref` / `encrypted_api_key` 仅为存储槽）。

## 4. 迁移顺序

顺序服从 `database/README.md`「M1 先 identity，后 projects」与依赖关系：

```text
第 0 批  扩展与基础设施
  ├─ CREATE EXTENSION IF NOT EXISTS vector;        （待 M3/M4，pgvector）
  ├─ audit_logs / outbox                            （0000，已建）
  └─ idempotency_keys + outbox.last_error           （0001，已建）

第 1 批  身份与关系（M1）
  ├─ users / households                             （已建）
  ├─ guardian_links / mentor_assignments            （已建，含部分唯一索引）
  └─ roles / identities / sessions / consents / profiles （待建）

第 2 批  项目与学习（M2 / M3）
  └─ project_templates(_versions) → projects(_stages/_tasks)
     → learning_sessions/events → theory_* / practice_* → artifacts / reviews

第 3 批  AI 与成长（M4 / M5）
  └─ tutor_sessions / tutor_turns / context_snapshots
     → knowledge_documents / knowledge_chunks（pgvector）
     → growth_snapshots / milestones → ai_jobs / ai_runs / ai_events

第 4 批  运营与模型（M7 / M8）
  └─ alerts / interventions / feedback_tickets / notifications
     → parent_growth_exports （0003，已建，ISSUE-T5）
     → model_providers / model_models / model_usage_bindings （0002，已建）
```

**规则**：迁移编号单调递增；合并到主线后不可修改历史迁移；新迁移必须能对空库重放。

## 5. 迁移与种子工作流

```bash
# 生成迁移（schema 改在 packages/database/src/schema/）
pnpm --filter @qitu/database generate

# 对空库重放迁移（forward-only）
psql "$DATABASE_URL" -f database/migrations/0000_clever_kang.sql
psql "$DATABASE_URL" -f database/migrations/0001_cheerful_colossus.sql
psql "$DATABASE_URL" -f database/migrations/0002_light_miracleman.sql
psql "$DATABASE_URL" -f database/migrations/0003_glamorous_ulik.sql

# 确定性演示数据（幂等，可重复执行）
pnpm --filter @qitu/database seed
```

- 迁移产物必须与 owner 模块一起评审；每个 `.sql` 需配 `.down.sql`。
- `database/seeds/demo-identities.sql` 是种子唯一真源；`packages/database/src/seed.ts` 只执行它。
- 种子幂等语义：`users` 冲突 `DO UPDATE`；`guardian_links` / `mentor_assignments` 冲突 `DO NOTHING`。
  详见 `database/README.md`。

## 6. 当前已实现 vs 目标

| 能力 | 状态 |
|---|---|
| Drizzle schema + client + 事务 | **已实现**（Stage 1，未提交） |
| 迁移 `0000_clever_kang`（identity + ops） | **已实现** |
| 迁移 `0001_cheerful_colossus`（幂等键 + outbox 错误字段） | **已实现** |
| 迁移 `0002_light_miracleman`（模型注册表三张表） | **已实现**（仅表结构） |
| 迁移 `0003_glamorous_ulik`（`parent_growth_exports`） | **已实现**（ISSUE-T5；仅任务元数据 + 脱敏正文，未接异步 worker / 对象存储） |
| 确定性种子与幂等语义 | **已实现** |
| `DatabaseModule` 模式化接入（`QITU_DATA_MODE`，默认 live） | **已实现**：live 缺 `DATABASE_URL` fail-fast；仅 demo/test（非 production）允许内存引擎 |
| 项目 / AI / 成长 / 知识库表 | **未实现**（按阶段推进） |
| pgvector 扩展与向量索引 | **未实现** |
| 会话持久化（当前进程内） | **未实现** |
| 模型注册表持久化 | **部分实现**：表结构已建（0002）；service 仍只写进程内存，尚未读写这些表 |

## 7. 空态、幂等与回滚

- **空态**：无数据时 API 必须返回空列表 / 空箭头，而不是报错；前端展示 empty 状态。
  种子缺失时登录会失败（无演示账号），这是预期行为，见 `docs/INITIALIZATION.md`。
- **幂等**：所有写操作携带 `Idempotency-Key`（项目创建、任务/作品提交、导师分配、干预发送）；
  横切结果落 `idempotency_keys`（`scope + key` 唯一，保存 request hash 和原响应），审计仍通过
  `audit_logs.idempotency_key` 关联；业务表的部分唯一约束继续作为最终一致性兜底。
- **回滚**：迁移只前向；回滚以 `.down.sql` 为载体，人工评审后在受控环境执行。
  关系表不做物理删除，用 `status=ended` + `endedAt` 保留历史。

## 8. 验收标准

- [ ] 空库重放全部迁移成功，无错误。
- [ ] 连跑两次种子，第二次 `users` 数量不变（幂等）。
- [ ] 同一学生插入第二条 active 班主任被数据库拒绝。
- [ ] `live`（默认）缺 `DATABASE_URL` 时 API 拒绝启动（fail-fast），不退回内存引擎。
- [ ] 仅有显式 `QITU_DATA_MODE=demo|test`（非 production）且无 `DATABASE_URL` 时 API 走内存引擎。
- [ ] 设置 `DATABASE_URL` 时 API 走 Postgres 引擎，且两端输出形状一致。

## 9. 未决事项

- [ ] 库不可达但 `DATABASE_URL` 已设置时的行为（启动时探活 fail-fast vs 查询期报错降级）——
      当前的 fail-fast 仅覆盖「未配置/无法创建 client」，不含连接探活。
- [ ] `roles` / `identities` / `sessions` 的正式结构与迁移。
- [x] 模型注册表三张表的字段与迁移（0002，表结构已建；service 读写与密钥加密待实现）。
- [ ] pgvector 的维度与索引类型（HNSW / IVFFlat）在知识库接入时确定。
- [ ] 数据保留与删除策略、匿名化方案的落表方式。
