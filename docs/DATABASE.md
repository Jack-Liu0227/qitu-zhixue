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

-- 同一学生同一目标只有一条掌握度状态（0008）
CREATE UNIQUE INDEX mastery_records_student_objective_unique_idx
  ON mastery_records (student_user_id, objective_id);

-- 幂等键唯一（0008）：重试不会产生第二条业务记录
--   learning_plans_idempotency_unique_idx / growth_records_idempotency_unique_idx /
--   student_memories_idempotency_unique_idx / mentor_reviews_idempotency_unique_idx

-- 同一学习路径同时只有一道未答题（0009）
CREATE UNIQUE INDEX pending_questions_awaiting_unique_idx
  ON pending_questions (student_user_id, plan_id) WHERE status = 'awaiting';

-- 同一事实只物化一行项目证据（0009）：重复聚合不会产生第二条
CREATE UNIQUE INDEX project_evidence_fact_unique_idx
  ON project_evidence (project_id, column_kind, source_kind, source_id);

-- 作品版本序号在作品内唯一（0009）
CREATE UNIQUE INDEX artifact_versions_artifact_ordinal_unique_idx
  ON artifact_versions (artifact_id, ordinal);

-- 幂等键唯一（0009）：
--   template_verification_runs_idempotency_unique_idx（验证报告只落一条）/
--   template_verification_evidence_ref_unique_idx（run + 检查 + 来源唯一）/
--   artifacts_idempotency_unique_idx / pending_questions_idempotency_unique_idx
```

### 硬业务规则与其落表方式

| 规则 | 强制方式 |
|---|---|
| 一名学生同一时间只能有一个当前班主任 | `mentor_assignments` 部分唯一索引（DB 级） |
| 学生未确认意图不得创建正式项目 | 服务端状态机：`intent_confirmations` + `learning_plans.confirmed_at`；确认后才写 `projects` / `learning_plans.project_id` |
| `TheoryMastered` 之前不得进入实践 | 服务端根据 `mastery_records`（`mastery_basis_points >= threshold_basis_points` 或 `qualitative_mastered`）判定；`learning_sessions.practice_objective_ids` 只在门槛达成后由服务端解锁 |
| 项目 / 计划绑定冻结模板版本 | `projects.template_version_id` / `learning_plans.template_version_id` 外键指向 `project_template_versions` |
| 同一学习路径同时只有一道未答题 | `pending_questions` 部分唯一索引 `(student_user_id, plan_id) WHERE status='awaiting'`（DB 级兜底） |
| 项目证据只能由服务端聚合产生 | `project_evidence` 无客户端写路径；`(project_id, column_kind, source_kind, source_id)` 唯一 |
| 模板验证结论与证据不可变 | `template_verification_runs` 无 `updated_at`，`idempotency_key` 唯一；证据行随 run 级联，`(run_id, check_key, source_kind, source_id)` 唯一 |
| 平台共享 vs 校域隔离 | `project_templates` 部分唯一 slug；`knowledge_documents.scope`（见 §3.1） |

## 3. 表归属（单一写入者）

每个模块只能写自己 owner 的表；跨模块写走命令 / 事件 / outbox。**加粗**为当前已建表。

| 模块（owner） | 表 |
|---|---|
| Identity & Access | **`users`**、**`households`**、**`guardian_links`**、**`mentor_assignments`**、`roles`、`identities`、`sessions`、`student_profiles`、`mentor_profiles`、`consents` |
| Tenancy（校域） | **`schools`**、**`users.school_id`**（可空；`NULL` = 平台共享）、`student_profiles.school_id`（待建） |
| Cross-cutting Operations | **`audit_logs`**、**`outbox`**、**`idempotency_keys`** |
| Projects & Learning | **`project_templates`**、**`project_template_versions`**、**`exploration_sessions`**、**`intent_confirmations`**、**`projects`**、**`learning_plans`**、**`learning_modules`**、**`learning_objectives`**、**`learning_sessions`**、**`pending_questions`**（0009，跨轮待答题）、**`mastery_records`**、**`mastery_attempts`**、`recommendation_sessions`、`recommendation_items`、`exploration_turns`、`project_stages`、`project_tasks`、`learning_events`、`theory_modules`、`theory_checks`、`practice_tasks` |
| AI Tutor | **`tutor_sessions`**、**`tutor_turns`**、**`tutor_partners`**、**`tutor_learner_profiles`**、**`tutor_memories`**、**`tutor_growth_signals`**、**`tutor_knowledge_documents`**、**`tutor_template_documents`**（0007 工作区适配层）、`context_snapshots` |
| Works | **`artifacts`**、**`artifact_versions`**、**`project_evidence`**（0009，服务端聚合只读）、`review_records` |
| Growth | **`growth_records`**、**`student_memories`**、`growth_snapshots`、`milestones` |
| Mentor Ops | **`mentor_reviews`**、**`knowledge_documents`**、**`knowledge_chunks`**、`alerts`、`interventions`、`feedback_tickets` |
| Parent Experience | `notifications`（读取投影，不建独立业务表）、**`parent_growth_exports`**（0003，家长成长导出任务 + 脱敏正文快照） |
| Admin & Compliance | **`audit_logs`**、**`outbox`**、**`template_verification_runs`**、**`template_verification_evidence`**（0009，模板验证报告与证据）、`ai_jobs`、`ai_runs`、`ai_events`、`ai_artifacts`、`ai_approvals`、`model_usage` |
| Model Registry | **`model_providers`**、**`model_models`**、**`model_usage_bindings`**（对应 Provider / Model / Usage，0002 已建） |

> `model_usage`（产品文档 8.1）目前未建，由 `model_usage_bindings` 承担用途绑定。
> 三层配置表结构已建（0002）；但 `model-registry` service 仍只写进程内存，尚未读写这些表，
> 密钥加密 / secret manager 也未接入（`secret_ref` / `encrypted_api_key` 仅为存储槽）。

### 3.1 校域（school_id）与共享 / 私有边界

- `schools` 为校域根表；`school_id` 可空列约定：**`NULL` = 平台共享**，非空 = 该校私有。
- 已带 `school_id` 的落地表：`users`、`project_templates`、`knowledge_documents`、
  `learning_plans`、`mastery_records`、`mastery_attempts`、`growth_records`、`student_memories`、
  `mentor_reviews`；0009 新增 `artifacts`、`project_evidence`、`pending_questions`、
  `template_verification_runs`、`template_verification_evidence`（后两者 `NULL` = 平台模板验证）。
- 共享/私有边界：`project_templates` 用部分唯一索引区分平台 slug（`school_id IS NULL`）与
  校域 slug（`school_id IS NOT NULL`）；`knowledge_documents.scope` 取
  `system | school | project | student`，`student` 作用域必须绑定 `owner_user_id`。
- **学生私有事实**（成长记录、学生记忆、掌握度）默认 `visibility = 'student_private'`，
  由服务端写入；家长/班主任只能读取允许投影的字段（`summary_parent` 等）。
- **0009 新增表均为服务端写入**：`artifacts` / `artifact_versions`（作品与版本由项目阶段与发布流程写入）、
  `project_evidence`（由任务提交 / AI turn / 升级事件 / 反思 / 判分**派生**，学生与客户端不能直接写）、
  `pending_questions`（题面与 `expected_answer` / `explanation` 由服务端持有，下发前经 `PublicQuestion` 投影）、
  `template_verification_runs` / `template_verification_evidence`（模板治理写入，只读审计）。
- **尚未实现**：行级安全（RLS）/ `SET LOCAL` 会话变量、跨校写入强制校验、多校租户切换。
  当前 `school_id` 仅供应用层过滤，权限仍由后端逐对象校验。

### 3.2 领域真源 vs AI 工作区适配层（并存）

0008 建立的是**正式领域真源**（`project_templates` / `knowledge_documents` /
`growth_records` / `learning_plans` 等）。0007 的 `tutor_*` 表是 AI 搭档工作区适配层，
当前仍被 `services/api/src/modules/ai-tutor/tutor-workspace.service.ts` 使用：

| 领域真源（0008） | 工作区适配层（0007） | 说明 |
|---|---|---|
| `project_templates` / `project_template_versions` | `tutor_template_documents` | 适配层为单表文本版本，真源含冻结版本与 rubric |
| `knowledge_documents` / `knowledge_chunks` | `tutor_knowledge_documents` | 真源含 scope / 校验状态 / 分块与 embedding |
| `growth_records` | `tutor_growth_signals` | 真源含双份摘要（学生/家长）与可见性 |
| `student_memories` | `tutor_memories` | 真源含置信度与可见性 |

合并方向见 `docs/decisions/0006-domain-module-storage.md`：先双写/迁移再下线适配层，
不在本批直接删表。

### 3.3 0009 表与 API 模块接线映射（数据层已就位，API 待接线）

迁移 0009 只落**存储**；`services/api` 的写入路径由各 owner 模块接入（本批不改 API 代码）：

| 表 | owner 模块 | 服务端写入时机 | 对应 API / 合同 |
|---|---|---|---|
| `template_verification_runs` / `template_verification_evidence` | Admin & Compliance（模板治理） | `verify` / `publish` 时把 `evaluateTemplateVerification()` 的确定性报告与证据冻结为一行 | `services/api/src/modules/templates/*`（`templates.module.ts` 注释标注待迁移）；形状与 `VerificationReport` / `VerificationCheck` 一致 |
| `artifacts` / `artifact_versions` | Works | 项目阶段提交、学生确认发布时追加版本 / 置 `published_at` | Works 合同的 `Artifact` / `ArtifactVersion`（`docs/agents/student-frontend-backend-design.md`） |
| `project_evidence` | Projects & Learning / Growth | 由任务提交、`tutor_turn`、升级事件、反思、判分等真实事实**派生**（重复聚合 `ON CONFLICT DO NOTHING`） | 当前 `template-evidence.store.postgres.ts` 只读聚合；接表后改为物化 |
| `pending_questions` | Projects & Learning（学习计划） | 出题时写题面 + 服务端私密 `expected_answer`；作答后置 `answered` 并追加 `mastery_attempts` | `learning-plan.service.ts` 的 `PublicQuestion` / `NextAction='answer_pending'` / 错误码 `QUESTION_NOT_AWAITING` |

接线前，`pending_questions` 只经 `toPublicQuestion` 投影下发，**不得**把 `expected_answer` / `explanation` 序列化给客户端。

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

第 5 批  单一学校领域基础层（0008，已建）
  └─ schools
     → project_templates / project_template_versions
     → knowledge_documents / knowledge_chunks
     → learning_plans / learning_modules / learning_objectives / learning_sessions
     → mastery_records / mastery_attempts
     → growth_records / student_memories
     → mentor_reviews
     并回填 users.school_id 与 projects / exploration_sessions.template_version_id 外键。
     注意：Postgres 标识符上限 63 字符，长外键名必须用显式短名（见 0008 的
     `exploration_sessions_template_version_id_fk` / `learning_plans_template_version_id_fk`）。

第 6 批  验证 / 作品 / 待答题（0009，已建，纯增量）
  ├─ template_verification_runs → template_verification_evidence
  ├─ artifacts → artifact_versions
  ├─ project_evidence
  └─ pending_questions
  只 CREATE 新表 / 新索引 / 新外键，不改动任何既有表；外键同样用显式短名
  （`artifacts_template_version_id_fk`、`template_verification_runs_template_version_id_fk`）。
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
psql "$DATABASE_URL" -f database/migrations/0004_stormy_korvac.sql
psql "$DATABASE_URL" -f database/migrations/0005_nostalgic_shotgun.sql
psql "$DATABASE_URL" -f database/migrations/0006_yellow_pete_wisdom.sql
psql "$DATABASE_URL" -f database/migrations/0007_tutor_workspace.sql
psql "$DATABASE_URL" -f database/migrations/0008_domain_foundation.sql
psql "$DATABASE_URL" -f database/migrations/0009_verification_evidence.sql

# 确定性演示数据（幂等，可重复执行）
pnpm --filter @qitu/database seed

# 领域基础层 + 验证/作品/待答题演示数据（0008/0009 表；幂等）
# seed.ts 的 SEED_FILES 已包含本文件，随 `pnpm seed` 在 demo-identities.sql 之后自动执行。
psql "$DATABASE_URL" -f database/seeds/domain-foundation.sql
```

- 迁移产物必须与 owner 模块一起评审；每个 `.sql` 需配 `.down.sql`。
- `database/seeds/demo-identities.sql` 是身份种子真源，`tutor-workspace.sql` 为工作区适配层种子，
  `domain-foundation.sql` 为 0008/0009 领域表演示数据；`packages/database/src/seed.ts` 依次执行三者。
- 种子幂等语义：`users` / `schools` / 领域 fixture 冲突 `DO UPDATE`；
  `guardian_links` / `mentor_assignments` / 运行期记录冲突 `DO NOTHING`。详见 `database/README.md`。

## 6. 当前已实现 vs 目标

| 能力 | 状态 |
|---|---|
| Drizzle schema + client + 事务 | **已实现**（Stage 1，未提交） |
| 迁移 `0000_clever_kang`（identity + ops） | **已实现** |
| 迁移 `0001_cheerful_colossus`（幂等键 + outbox 错误字段） | **已实现** |
| 迁移 `0002_light_miracleman`（模型注册表三张表） | **已实现**（仅表结构） |
| 迁移 `0003_glamorous_ulik`（`parent_growth_exports`） | **已实现**（ISSUE-T5；仅任务元数据 + 脱敏正文，未接异步 worker / 对象存储） |
| 迁移 `0004`–`0007`（偏好、反馈工单、模型绑定、AI 工作区） | **已实现** |
| 迁移 `0008_domain_foundation`（学校/模板/知识/计划/掌握/成长/记忆/评审） | **已实现**（表结构 + 外键 + 幂等键；service 读写与 RLS 待接入） |
| 迁移 `0009_verification_evidence`（验证报告/证据、作品与版本、项目证据、待答题） | **已实现**（表结构 + 外键 + 幂等/部分唯一索引；API 接线见 §3.3） |
| 确定性种子与幂等语义 | **已实现** |
| `DatabaseModule` 模式化接入（`QITU_DATA_MODE`，默认 live） | **已实现**：live 缺 `DATABASE_URL` fail-fast；仅 demo/test（非 production）允许内存引擎 |
| 项目 / AI / 成长 / 知识库表 | **部分实现**：0008/0009 已建领域经典表与作品/版本/项目证据/验证/待答题表；`project_stages` / `project_tasks` / `alerts` / `interventions` 等仍待建 |
| 校域隔离（RLS / 跨校强制校验） | **未实现**（`school_id` 列已就位，仅应用层过滤） |
| pgvector 扩展与向量索引 | **未实现**（`knowledge_chunks.embedding` 暂用 JSONB 占位） |
| 会话持久化（当前进程内） | **未实现** |
| 模型注册表持久化 | **部分实现**：表结构已建（0002）；service 仍只写进程内存，尚未读写这些表 |

## 7. 空态、幂等与回滚

- **空态**：无数据时 API 必须返回空列表 / 空箭头，而不是报错；前端展示 empty 状态。
  种子缺失时登录会失败（无演示账号），这是预期行为，见 `docs/INITIALIZATION.md`。
- **幂等**：所有写操作携带 `Idempotency-Key`（项目创建、任务/作品提交、导师分配、干预发送）；
  横切结果落 `idempotency_keys`（`scope + key` 唯一，保存 request hash 和原响应），审计仍通过
  `audit_logs.idempotency_key` 关联；业务表的部分唯一约束继续作为最终一致性兜底。
  0008 新增业务表也内联幂等键唯一索引：`learning_plans`、`growth_records`、`student_memories`、
  `mentor_reviews` 的 `idempotency_key`，以及 `learning_modules` / `learning_objectives` /
  `learning_sessions` 的作用域序号唯一约束、`mastery_records` 的
  `(student_user_id, objective_id)` 唯一约束。0009 继续内联：`template_verification_runs` /
  `artifacts` / `pending_questions` 的 `idempotency_key`，并以标签唯一约束兜底
  （`template_verification_evidence` 的 `(run_id, check_key, source_kind, source_id)`、
  `project_evidence` 的 `(project_id, column_kind, source_kind, source_id)`、
  `artifact_versions` 的 `(artifact_id, ordinal)`、`pending_questions` 的部分唯一索引）。
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
- [ ] pgvector 的维度与索引类型（HNSW / IVFFlat）在知识库接入时确定；
      当前 `knowledge_chunks.embedding` 为 JSONB 占位，接入后需迁移为 `vector` 列。
- [ ] `tutor_*` 适配层与 0008 领域真源的合并/下线顺序（双写迁移方案）。
- [ ] `school_id` 的行级安全（RLS）与会话变量策略；多校租户切换。
- [ ] `mastery_records` 模型字段（difficulty/stability/retrievability）与
      `docs/agents/tutor-curriculum-design.md` 的间隔复习算法对接。
- [ ] 数据保留与删除策略、匿名化方案的落表方式。
