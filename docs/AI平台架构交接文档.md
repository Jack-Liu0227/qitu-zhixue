# AI 平台架构交接文档

## 1. 交接目标

本文用于后续 Agent 接手启途智学 AI 平台。默认基线是模块化单体：

```text
apps
  -> contracts / api-client / ai-client / infra
  -> NestJS modular API
  -> PostgreSQL system of record
  -> Redis cache / lock / queue
  -> workers / outbox
  -> ModelGateway
```

不要重新引入一套 Python/FastAPI/LangGraph 业务主链路，也不要让前端直接写项目状态、掌握度、成长档案、模板验证或 project evidence。

## 2. 当前核心模块

| 模块 | 目录 | 单一职责 |
|---|---|---|
| Tutor | `services/api/src/modules/ai-tutor` | Tutor 会话、turn、提示、流式 SSE、授权 |
| Learning Plan | `services/api/src/modules/learning-plan` | 4/8 周计划、题目、判分、掌握度、TheoryMastered |
| Templates | `services/api/src/modules/templates` | 模板读取、版本治理、验证和发布 |
| Knowledge | `services/api/src/modules/knowledge` | 作用域知识文档、验证、检索 |
| Growth | `services/api/src/modules/growth` | 成长事实、学生/家长投影 |
| Works | `services/api/src/modules/works` | 作品、版本、发布、项目证据 |
| Redis/Queue | `services/api/src/common/redis`, `common/queue` | 缓存、锁、队列和 outbox 投递基础设施 |
| Model Registry | `services/api/src/modules/model-registry` | Provider → Model → Usage 和密钥隔离 |
| AI SDK | `packages/ai-client` | 纯策略、上下文、伙伴、检索端口、计划辅助逻辑 |
| Database | `packages/database` | Drizzle schema、数据库 client、迁移边界 |
| Infra | `packages/infra` | Redis/缓存/锁/队列的 framework-agnostic 实现 |

## 3. 数据源和作用域规则

### PostgreSQL 是事实源

PostgreSQL 保存：

- 用户、学校、监护关系、教师分配。
- 模板和不可变模板版本。
- 学习计划、学习目标、课次。
- pending questions、mastery attempts、mastery records。
- Tutor sessions/turns。
- 成长记录、学生记忆。
- 知识文档、知识 chunks。
- 作品、作品版本、项目证据。
- 模板验证报告和验证证据。
- 幂等、审计、outbox。

Redis 不保存最终事实，只用于：

- scoped cache。
- 分布式锁。
- 短期会话/游标状态。
- 限流和队列协调。

### 共享资产

- `project_templates`
- `project_template_versions`
- `knowledge_documents(scope=system|school)`
- 教学规则、目标类型、模型配置
- 平台级 verified 模板和学校级 published 模板

模板版本一旦被项目使用，必须冻结。模板修改创建新版本，不修改旧版本。

### 学生隔离资产

- `learning_plans`
- `mastery_records`
- `mastery_attempts`
- `pending_questions`
- `tutor_sessions`
- `tutor_turns`
- `growth_records`
- `student_memories`
- `artifacts`
- `artifact_versions`
- `project_evidence`
- `knowledge_documents(scope=student)`

学生、家长和教师通过后端 projection 读取，不直接读取所有字段。

### 关系授权

```text
student -> 只能访问自己
parent  -> guardian_links(active) 对应的孩子
teacher -> mentor_assignments(active) 对应的学生
admin   -> 学校治理和审计范围，敏感学生数据需要明确授权
```

关系创建和读取都需要 school scope。`school_id` 当前是应用层约束，RLS 尚未启用。

## 4. 关键 API

### Tutor

```text
GET  /api/v1/tutor/session?projectId=...
GET  /api/v1/tutor/project-context
GET  /api/v1/tutor/templates
POST /api/v1/tutor/stream
GET  /api/v1/tutor/sessions/:id
POST /api/v1/tutor/sessions/:id/turns
GET  /api/v1/tutor/sessions/:id/summary
```

live Tutor session/turn 使用 PostgreSQL；demo/test 使用内存 adapter。SSE 仍是主要传输，Redis 尚未接入 Tutor 回合锁和跨实例 stream replay。

### Learning Plan

```text
POST /api/v1/learning-plans
POST /api/v1/learning-plans/:id/confirm
GET  /api/v1/learning-plans/:id
GET  /api/v1/learning-plans/:id/sessions
POST /api/v1/learning-plans/:id/sessions/:sid/start
GET  /api/v1/learning-plans/:id/sessions/:sid/next-step
POST /api/v1/learning-plans/:id/sessions/:sid/answers
POST /api/v1/learning-plans/:id/sessions/:sid/evidence
```

`POST` 写操作需要 `Idempotency-Key`。答案和 pending question 的持久化通过 store 完成；当前最新修复已将 pending 状态、mastery attempt、mastery record 收拢为原子完成操作。

### Templates

```text
GET  /api/v1/project-templates
GET  /api/v1/project-templates/:id
GET  /api/v1/project-templates/:id/versions
GET  /api/v1/project-templates/:id/versions/:versionId

GET  /api/v1/admin/project-templates
POST /api/v1/admin/project-templates
PATCH /api/v1/admin/project-templates/:id
POST /api/v1/admin/project-templates/:id/versions
POST /api/v1/admin/project-templates/:id/versions/:versionId/verify
POST /api/v1/admin/project-templates/:id/versions/:versionId/publish
POST /api/v1/admin/project-templates/:id/archive
POST /api/v1/admin/project-templates/:id/rollback
```

验证流程会向 `template_verification_runs` 和 `template_verification_evidence` 写入不可变报告。发布必须满足五项检查。

### Knowledge

```text
GET  /api/v1/knowledge/search
GET  /api/v1/knowledge/documents/:id
POST /api/v1/knowledge/documents
POST /api/v1/knowledge/documents/:id/verify
```

当前为 bounded keyword retrieval。`knowledge_chunks.embedding` 仍是 JSONB 占位；EmbeddingProvider 当前未配置，pgvector/HNSW/IVFFlat 尚未实现。

### Works

```text
POST /api/v1/files/presign
POST /api/v1/artifacts
GET  /api/v1/artifacts
GET  /api/v1/artifacts/:id
GET  /api/v1/artifacts/:id/versions
PATCH /api/v1/artifacts/:id       # If-Match revision
POST /api/v1/artifacts/:id/publish
POST /api/v1/artifacts/:id/withdraw
GET  /api/v1/projects/:projectId/evidence
```

客户端没有 project evidence 写接口。作品发布必须经过导师审核，作品正文/文件走对象存储适配器。

## 5. AI SDK 扩展规则

不要在业务模块中直接调用 PostgreSQL、Redis 或模型 Provider。优先通过 Port：

```text
Read ports
  retrieveTutorContext
  searchTemplates
  searchKnowledge
  loadLearnerProfile

Fact write ports
  appendLearningFact
  appendGrowthSignal
  appendMemory

Pure engines
  curriculum validation
  mastery
  questions
  grading

Model ports
  complete
  stream
  embed
  structured output
```

新增 AI 能力时遵守：

1. 模型输出必须视为不可信。
2. 结构化输出先 schema 校验，再持久化。
3. AI 不能直接设置阶段、掌握度、TheoryMastered 或模板验证状态。
4. 学生事实追加而不是覆盖。
5. 画像由事实和证据异步投影生成。
6. 所有写操作有幂等键和审计。
7. Context Packet 分开标识共享知识、模板证据、学生记忆和项目证据。

## 6. 环境配置

```bash
QITU_DATA_MODE=live
DATABASE_URL=postgresql://...
QITU_MODEL_SECRET_KEY=...
REDIS_URL=redis://...
REDIS_KEY_PREFIX=qitu
```

初始化：

```bash
pnpm --filter @qitu/database generate
DATABASE_URL=postgresql://... pnpm --filter @qitu/database seed
```

seed 顺序固定：

```text
demo-identities.sql
  -> tutor-workspace.sql
  -> domain-foundation.sql
```

生产环境不应使用 demo/test 内存模式。

## 7. 未完成事项和接手顺序

### P1

1. 将 Tutor Redis lock 和跨实例 stream cursor 接入 `ai-tutor`。当前 Tutor 依赖 PostgreSQL seq/idempotency，但 Redis coordination 代理没有产生 commit。
2. 将作品、project evidence 和 pending question 的 `school_id` 从 null fallback 改为服务端用户作用域解析。
3. 将 RLS 或 `SET LOCAL school_id` 防线加入 PostgreSQL，应用层授权继续保留。
4. 将 outbox queue 接入真实 worker consumer；当前 queue facade 已有，但 workers 仍未消费。
5. 将模板验证证据的 `student_user_id` 从 null 丰富为来源事实对应学生。

### P2

1. pgvector extension、embedding dimension、HNSW/IVFFlat index、hybrid rerank。
2. pending question unique scope 从 `(student, plan)` 评估是否需要改为 `(student, plan, session)`，并在 PublicQuestion 中暴露 session identity 或保持服务端映射。
3. pending answer 的 keywords 列和更丰富的题库模型。
4. `artifact_likes`、`artifact_stats`。
5. `task_submissions`、`reflections`、升级/错误分类表，补全 project evidence 三列。
6. Growth snapshot 从启动 hydration 改为异步/分页直接读 canonical 表。
7. 旧 `tutor_*` 工作区表与 canonical knowledge/growth/memory 表双写、迁移、切读、下线。
8. 模型原生 streaming、embedding、structured output 和调用 trace。
9. 学校级 RLS、备份恢复演练、读副本和 worker 水平扩展。

## 8. 接手工作流

接手 Agent 应先运行：

```bash
pnpm install --offline
pnpm typecheck
pnpm --filter @qitu/api test
pnpm --filter @qitu/database generate
pnpm --filter @qitu/database exec tsx src/seed.ts --check
```

修改数据 schema 前：

1. 先更新 `docs/DATABASE.md` 表归属。
2. 只允许一个 schema writer 修改 `packages/database/src/schema/**`。
3. 生成 forward/down migration 和 snapshot。
4. 做空库 replay、down/up 和 seed 幂等测试。
5. 在 API owner 模块接入 adapter 和权限测试。

修改 AI 能力前：

1. 先确定读 Port / 写 Port。
2. 明确事实源和缓存边界。
3. 补充 answer leakage、cross-student、cross-school、idempotency 测试。
4. 不要从客户端传入服务端状态字段。

## 9. 当前交接结论

当前系统已经具备继续迭代 AI 功能的基础，但还不是完整的多实例生产部署版本。最优先的下一步是把 Redis 协调、school_id 服务端解析、RLS 和 worker 消费补齐，然后再投入 pgvector 和更复杂的 AI 画像/知识检索能力。
