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
| Platform Registry | `services/api/src/modules/platform-registry` | 管理后台 AI 运行时**只读**投影（skills / MCP / agents / 内置工具 / 初始化状态） |
| Initialization | `services/api/src/modules/initialization` | 受限、幂等的 foundation 初始化（knowledge / template / tutor；database 恒拒绝） |
| AI SDK | `packages/ai-client` | 纯策略、上下文、伙伴、检索端口、计划辅助逻辑（含 `curriculum.ts`） |
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

### 开发期制品与运行时边界

`.pi/skills/**`、`.pi/agents/*.md`、`.pi/settings.json` 和 `.pi/extensions/student-workflow.ts` 是
Pi/Herdr **开发期**工作流与角色元数据，本次清理明确保留；控制面只读取它们的安全
frontmatter 摘要，不投影完整 skill 正文或 agent system prompt。
仓库内当前没有 MCP server 注册文件，因此 `mcpServers` 为空；内置工具由
`platform-registry/built-in-tools.ts` 提供脱敏注册表。持久化会话（`tutor_sessions` /
`tutor_turns`）与 `agent_memory_records` 保留不变。

### 掌握度时间线（ADR 0009）

掌握度时间线是 Projects & Learning 的一等领域能力，但 Graphiti 不是掌握度权威层。

```text
mastery_events（不可变事实）
  -> mastery_records（当前投影 / TheoryMastered 门槛）
  -> mastery timeline API / growth projections
  -> outbox -> Graphiti（可选、异步、可重建读模型）
```

当前代码已实现（尚未提交）：

- `mastery_events`、显式 objective→KnowledgePoint mapping、0011 migration；
- quiz / practice evidence 的 assessment transaction 和 `TheoryMastered` audit/outbox 同事务；
- 五个只读 mastery API 和 `@qitu/api-client` facade；
- current/snapshot/timeline/threshold 从事件账本按 `validAt`、`knownAt` 派生，课程版本独立；
- `LearningPlanModule` 导出同一个 `LearningPlanStore`，demo/test 不重复创建 store。

- `mastery_graph_receipts`、`services/workers/src/mastery-projection-worker.ts` 和 `services/graphiti/bridge.py` scaffold 已落地；外部 Graphiti 未配置时保持 disabled，receipt、租约、失败重试和重建命令有状态边界。

读接口规则：

- 全量 current/snapshot/regressions 可省略知识点筛选，不依赖当前 projection 枚举事件。
- timeline 用事件 ID 游标分页；同一 KP 的不同 courseVersion 不互相关闭有效区间。
- threshold 若有多个课程版本必须指定版本，不任意选择；无已知评估返回 404。
- 撤销/未知保留 null，不能通过门槛，也不解释成实测退步；家长响应移除 evidenceRefs。
- controller 拒绝未知字段、重复参数、掌握写入字段；关系授权在读取前执行。
- 本查询模块提供只读结果，尚未替换项目状态机的现有门槛路径。

所有掌握度时间线任务先读 [`decisions/0009-mastery-timeline-and-graphiti.md`](./decisions/0009-mastery-timeline-and-graphiti.md)。


## 4. 关键 API

### Tutor

```text
GET  /api/v1/tutor/session?projectId=...&explorationId=...
GET  /api/v1/tutor/project-context
GET  /api/v1/tutor/templates
GET  /api/v1/tutor/sessions/:id
POST /api/v1/tutor/sessions
POST /api/v1/tutor/sessions/:id/stream
GET  /api/v1/tutor/sessions/:id/summary
```

live Tutor session/turn 使用 PostgreSQL；demo/test 使用内存 adapter。统一学生端探索与项目入口后，浏览器只使用 `/student/tutor`，通过 `source` + `explorationId/projectId` 选择上下文。SSE 仍是主要传输，Redis 尚未接入 Tutor 回合锁和跨实例 stream replay。

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

`POST` 写操作需要 `Idempotency-Key`。当前 answer/evidence 处理在学生级 assessment
锁内读取与评估，pending（answer）、attempt、mastery、映射存在时的 mastery event 及
commit callback 共用事务；`TheoryMastered` audit/outbox 通过该 callback 写入。
缺少显式映射时保持旧 objective 路径，不伪造 canonical KP 或历史事件。

### Mastery（只读）

```text
GET /api/v1/mastery/current
GET /api/v1/mastery/timeline
GET /api/v1/mastery/snapshot
GET /api/v1/mastery/threshold
GET /api/v1/mastery/regressions
```

API 对 `studentId` 做当前关系授权；浏览器默认 facade 只读当前学生。
授权家长/教师指定学生需由业务调用层传入目标，不能把学生身份当授权凭据。
时间参数要求带时区 ISO 格式。`knownAt` 为记录截止，`validAt` 为业务时刻。
标准 API 测试命令现已包含 mastery 测试；本次复验 250/250 通过。


### Admin 控制面（`platform-registry` + `initialization`）

```text
GET  /api/v1/admin/ai-runtime                                  # AdminRuntimeSnapshot（只读）
GET  /api/v1/admin/initialization                              # AdminInitializationStatus（只读）
POST /api/v1/admin/initialization/knowledge/execute            # 需 Idempotency-Key
POST /api/v1/admin/initialization/template/execute             # 需 Idempotency-Key
POST /api/v1/admin/initialization/tutor/execute                # 需 Idempotency-Key
POST /api/v1/admin/initialization/database/execute             # 恒 409 INITIALIZATION_OPERATOR_REQUIRED
```

全部路由仅向 `admin` 开放；`POST` 写入与 `audit_logs` 同事务，错误码前缀 `INITIALIZATION_*`。
投影当前读取 `.pi/agents/*.md` / `.pi/skills` 的安全摘要并合并 `tutor_partners`，MCP 无配置时为空，
内置工具来自服务端脱敏注册表；尚未提供运行时配置写入口，详见 `docs/PLATFORM_CONTROL_PLANE.md`。
`migrationVersion` 为 `null`（API 不探测迁移）。完整语义见 `docs/PLATFORM_CONTROL_PLANE.md`。

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
  commitGrowthSignal
  recordMemory

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
