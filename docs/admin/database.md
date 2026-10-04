# 数据库与表归属

> PostgreSQL 是唯一 system of record。掌握度时间线是领域能力；Graphiti 仅是异步、
> 可重建的查询投影，**不是事务真源**。
> 相关：[`initialization.md`](./initialization.md)、[`permissions.md`](./permissions.md)、
> `database/README.md`、`packages/database/`。

## 1. 分工：代码包 vs 产物目录

| 位置 | 角色 | 内容 |
|---|---|---|
| `packages/database/` | **代码包**（schema + client） | Drizzle schema、`createDb()`、`withTransaction()`、`seed.ts` |
| `database/migrations/` | **产物目录** | `drizzle-kit generate` 产出的前向 SQL 与 `.down.sql` |
| `database/seeds/` | **产物目录** | 确定性演示数据（唯一种子真源） |
| `database/fixtures/` | **产物目录** | 隔离测试 fixture，禁止生产数据 |

schema 是可被 API import 的代码，迁移是可逐行评审的 SQL 产物。

> **运行时规则**：`packages/database` 导出运行时值（`createDb` / `withTransaction`），
> 因此 `services/api` 运行时 require 它的 `dist/`，**必须先 build**；
> `tooling/start-qitu-services.sh` 已内置。纯类型的 `@qitu/contracts` 不需要 build。

## 2. Schema 约定

- **主键**：`text`（便于内联固定 id 与迁移 / 种子对齐）。
- **时间**：一律 `timestamp with time zone`，默认 `now()`。
- **状态**：`text` + 应用层枚举，不使用数据库 enum。
- **JSONB**：草稿内容、模板阶段数组、context packet、审计 detail。
- **大小写不敏感唯一**：`users` 用 `uniqueIndex('users_email_lower_idx').on(sql\`lower(email)\`)`，不依赖 `citext`。
- **迁移前向**：只增不改；每个迁移配 `.down.sql` 回滚说明。
- **幂等 DDL**：`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`、
  `ADD CONSTRAINT ... EXCEPTION WHEN duplicate_object`，保证空库可重放。

### 2.1 硬约束（真实存在于迁移）

```sql
-- 一个学生同一时间只能有一个当前班主任
CREATE UNIQUE INDEX mentor_assignments_one_active_per_student_idx
  ON mentor_assignments (student_user_id) WHERE status = 'active';

-- 同一父/学生只允许一条 active 监护关系
CREATE UNIQUE INDEX guardian_links_active_unique_idx
  ON guardian_links (parent_user_id, student_user_id) WHERE status = 'active';

-- 邮箱大小写不敏感唯一
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- 审计幂等键 / 业务幂等键唯一
CREATE UNIQUE INDEX audit_logs_idempotency_key_idx ON audit_logs (idempotency_key);
CREATE UNIQUE INDEX idempotency_keys_scope_key_idx ON idempotency_keys (scope, key);

-- 同一供应商下模型 id 唯一：PRIMARY KEY (provider_id, model_id)
-- 删除供应商 / 模型不得静默破坏用途绑定：外键均 ON DELETE RESTRICT

-- 同一学生同一目标只有一条掌握度状态
CREATE UNIQUE INDEX mastery_records_student_objective_unique_idx
  ON mastery_records (student_user_id, objective_id);

-- 同一学习路径同时只有一道未答题
CREATE UNIQUE INDEX pending_questions_awaiting_unique_idx
  ON pending_questions (student_user_id, plan_id) WHERE status = 'awaiting';

-- 同一事实只物化一行项目证据（重复聚合不会产生第二条）
CREATE UNIQUE INDEX project_evidence_fact_unique_idx
  ON project_evidence (project_id, column_kind, source_kind, source_id);

-- 作品版本序号在作品内唯一
CREATE UNIQUE INDEX artifact_versions_artifact_ordinal_unique_idx
  ON artifact_versions (artifact_id, ordinal);
```

### 2.2 硬业务规则与强制方式

| 规则 | 强制方式 |
|---|---|
| 一名学生同一时间只能有一个当前班主任 | `mentor_assignments` 部分唯一索引（DB 级） |
| 学生未确认意图不得创建正式项目 | 服务端状态机：`intent_confirmations` + `learning_plans.confirmed_at`；确认后才写 `projects` / `learning_plans.project_id` |
| `TheoryMastered` 之前不得进入实践 | 服务端按 `mastery_records` 判定；`learning_sessions.practice_objective_ids` 只在门槛达成后由服务端解锁 |
| 项目 / 计划绑定冻结模板版本 | `projects.template_version_id` / `learning_plans.template_version_id` 外键指向 `project_template_versions` |
| 同一学习路径同时只有一道未答题 | `pending_questions` 部分唯一索引 |
| 项目证据只能由服务端聚合产生 | `project_evidence` 无客户端写路径 + 唯一索引 |
| 模板验证结论与证据不可变 | `template_verification_runs` 无 `updated_at`，`idempotency_key` 唯一；证据行随 run 级联 |
| 平台共享 vs 校域隔离 | `project_templates` 部分唯一 slug；`knowledge_documents.scope` |

## 3. 表归属（单一写入者）

每个模块只能写自己 owner 的表；跨模块写走命令 / 事件 / outbox。**加粗**为当前已建表。

| 模块（owner） | 表 |
|---|---|
| Identity & Access | **`users`**、**`households`**、**`guardian_links`**、**`mentor_assignments`**、`roles`、`identities`、`sessions`、`student_profiles`、`mentor_profiles`、`consents` |
| Tenancy（校域） | **`schools`**、**`users.school_id`**（可空）、`student_profiles.school_id`（待建） |
| Cross-cutting Operations | **`audit_logs`**、**`outbox`**、**`idempotency_keys`** |
| Projects & Learning | **`project_templates`**、**`project_template_versions`**、**`exploration_sessions`**、**`intent_confirmations`**、**`projects`**、**`learning_plans`**、**`learning_modules`**、**`learning_objectives`**、**`learning_sessions`**、**`pending_questions`**、**`mastery_events`**、**`mastery_objective_mappings`**、**`mastery_records`**、**`mastery_attempts`**、**`mastery_graph_receipts`** + 规划表 |
| AI Tutor | **`tutor_sessions`**（含 `exploration_id`）、**`tutor_turns`**、**`tutor_partners`**、**`tutor_learner_profiles`**、**`tutor_memories`**、**`tutor_growth_signals`**、**`tutor_knowledge_documents`**、**`tutor_template_documents`**、`context_snapshots` |
| Works | **`artifacts`**、**`artifact_versions`**、**`project_evidence`**（服务端聚合只读）、`review_records` |
| Growth | **`growth_records`**、**`student_memories`**、`growth_snapshots`、`milestones` |
| Mentor Ops | **`mentor_reviews`**、**`knowledge_documents`**、**`knowledge_chunks`**、`alerts`、`interventions`、`feedback_tickets` |
| Parent Experience | **`parent_growth_exports`**、`notifications`（读取投影） |
| Admin & Compliance | **`audit_logs`**、**`outbox`**、**`template_verification_runs`**、**`template_verification_evidence`**、`ai_jobs`、`ai_runs`、`ai_events`、`ai_artifacts`、`ai_approvals`、`model_usage` |
| Model Registry | **`model_providers`**、**`model_models`**、**`model_usage_bindings`** |
| Agent Memory | **`agent_memory_records`**（`(source_event_id, version)` 唯一，`index_status` 驱动外部索引重建） |

### 3.1 校域（school_id）与共享 / 私有边界

- `schools` 为校域根表；`school_id` 可空，`NULL` = 平台共享。
- 已带 `school_id`：`users`、`project_templates`、`knowledge_documents`、`learning_plans`、
  `mastery_records`、`mastery_attempts`、`growth_records`、`student_memories`、`mentor_reviews`、
  `artifacts`、`project_evidence`、`pending_questions`、`template_verification_*`、`mastery_events`、`mastery_objective_mappings`。
  `agent_memory_records` **无** `school_id`（只有 `student_id` / `partner_id`）。
- **学生私有事实**（成长记录、学生记忆、掌握度）默认 `visibility='student_private'`，由服务端写入；
  家长 / 班主任只能读取允许投影的字段。
- **服务端写入专属**：`artifacts` / `artifact_versions`、`project_evidence`（派生）、
  `pending_questions`（题面与 `expected_answer` 由服务端持有，下发前经 `PublicQuestion` 投影）、
  `template_verification_*`。**学生与客户端不能直接写。**
- **尚未实现**：RLS / `SET LOCAL`、跨校写入强制校验、多校租户切换。

### 3.2 领域真源 vs AI 工作区适配层（并存）

0007 的 `tutor_*` 表是 AI 搭档工作区适配层，仍被 `tutor-workspace.service.ts` 使用：

| 领域真源 | 工作区适配层 |
|---|---|
| `project_templates` / `project_template_versions` | `tutor_template_documents` |
| `knowledge_documents` / `knowledge_chunks` | `tutor_knowledge_documents` |
| `growth_records` | `tutor_growth_signals` |
| `student_memories` | `tutor_memories` |

合并方向：先双写 / 迁移再下线适配层，**不在无迁移计划的情况下直接删表**。

### 3.3 掌握度时间线表

| 表 | 作用 | 写入规则 |
|---|---|---|
| `mastery_events`（0011） | 不可变评估事实：有效时间、记录时间、level、证据、算法版本、因果关系 | 只追加；`idempotency_key` 唯一；按学生 + KnowledgePoint 校验序列 |
| `mastery_objective_mappings`（0011） | objective → KnowledgePoint 显式映射 | `(objective_id, knowledge_point_id)` 唯一；**不推断映射** |
| `mastery_records` | 当前掌握度投影与项目门槛读取模型 | 只能由评估事务更新；必须能从 `mastery_events` 重建 |
| `mastery_snapshots`（规划） | 按日 / 按事件序列的时间切片缓存 | 可删除重建 |
| `mastery_graph_receipts`（0012）/ `graph_projection_receipts`（规划） | Graphiti 投影版本、租约、状态、失败原因、最后成功序列 | Worker 通过 owner 命令幂等更新；**不作为业务授权依据** |

Graphiti、Neo4j / FalkorDB 与外部 embedding **不属于** PostgreSQL 业务真源。
Graphiti 只能通过 `mastery.assessed` outbox 事件异步写入；丢失后必须能从 `mastery_events` 完整重建。

## 4. 迁移顺序

```text
第 0 批  扩展与基础设施：audit_logs / outbox / idempotency_keys（0000、0001）
第 1 批  身份与关系（M1）：users / households / guardian_links / mentor_assignments
第 2 批  项目与学习（M2/M3）：project_templates → projects(_stages/_tasks) → learning_* → theory_* / practice_* → artifacts
第 3 批  AI 与成长（M4/M5）：tutor_sessions / tutor_turns → knowledge_documents / chunks → growth_*
第 4 批  运营与模型（M7/M8）：alerts / interventions / feedback_tickets → parent_growth_exports（0003）→ model_*（0002）
第 5 批  单一学校领域基础层（0008）：schools → templates → knowledge → learning_plans → mastery_* → growth_* → mentor_reviews
第 6 批  验证 / 作品 / 待答题（0009，纯增量）
第 7 批  代理记忆（0010）
第 8 批  掌握度时间线（0011、0012）
第 9 批  统一导师探索上下文（0013：tutor_sessions.exploration_id + 探索/项目部分唯一索引）
```

**规则**：迁移编号单调递增；合并到主线后不可修改历史迁移；新迁移必须能对空库重放。
Postgres 标识符上限 63 字符，长外键名必须用显式短名。

## 5. 迁移与种子工作流

```bash
# 生成迁移（schema 改在 packages/database/src/schema/）
pnpm --filter @qitu/database generate

# 对空库重放迁移（forward-only）
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue;; esac
  psql "$DATABASE_URL" -f "$f"
done

# 确定性演示数据（幂等，可重复执行）——demo-identities → tutor-workspace → domain-foundation
pnpm --filter @qitu/database seed
```

- 迁移产物必须与 owner 模块一起评审；每个 `.sql` 需配 `.down.sql`。
- `packages/database/src/seed.ts` 的 `SEED_FILES` 依次执行三个种子文件。
- 种子幂等：`users` / `schools` / 领域 fixture 冲突 `DO UPDATE`；
  `guardian_links` / `mentor_assignments` / 运行期记录冲突 `DO NOTHING`。
- `0013` 的 Drizzle `meta/_journal.json` 仍停在 `0009`，重放用裸 `psql`。

## 6. 空态、幂等与回滚

- **空态**：无数据时 API 必须返回空列表 / 空结构，而不是报错；前端展示 empty 状态。
  种子缺失时登录失败（无演示账号）是预期行为。
- **幂等**：所有写操作携带 `Idempotency-Key`；横切结果落 `idempotency_keys`
  （`scope + key` 唯一，保存 request hash 和原响应）；业务表的部分唯一约束作为最终兜底。
- **回滚**：迁移只前向；回滚以 `.down.sql` 为载体，人工评审后在受控环境执行。
  关系表不做物理删除，用 `status=ended` + `endedAt` 保留历史。

## 7. 数据模式

`services/api` 由 `QITU_DATA_MODE=live|demo|test` 决定引擎（默认 `live`）：
`live` 必须有 `DATABASE_URL`，缺失或 client 无法创建则 **fail-fast**；
只有显式 `demo`/`test` 且非 production 才允许无库的内存 Directory 引擎。
详见 [`initialization.md`](./initialization.md)。

## 8. 未决事项

- [ ] 库不可达但 `DATABASE_URL` 已设置时的行为（当前 fail-fast 仅覆盖「未配置 / 无法创建 client」，不含连接探活）。
- [ ] `roles` / `identities` / `sessions` 的正式结构与迁移。
- [ ] pgvector 维度与索引类型（HNSW / IVFFlat）；`knowledge_chunks.embedding` 当前为 JSONB 占位。
- [ ] `tutor_*` 适配层与领域真源的合并 / 下线顺序（双写迁移方案）。
- [ ] `school_id` 的 RLS 与会话变量策略；多校租户切换。
- [ ] `mastery_records` 模型字段（difficulty / stability / retrievability）与间隔复习算法对接。
- [ ] 数据保留与删除策略、匿名化方案落表。
