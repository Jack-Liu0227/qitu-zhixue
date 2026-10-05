# AI 运行时投影与受限初始化（平台控制面）

> 状态：当前基线（只读投影 + 受限幂等初始化）。
> 实现：`services/api/src/modules/platform-registry/`、`services/api/src/modules/initialization/`、
> `apps/admin-console/app/(console)/settings/ai-runtime/`。

## 1. 一句话

管理后台提供 Admin-only 的知识库、模板库与 AI 运行时可视化；运行时页只展示已加载的
Tutor policy、`.agents/skills`、Tutor Partner、真实工具描述和初始化状态。
控制面**不读取** `.pi` 开发协作元数据、仓库 MCP 配置或数据库凭据。

## 2. 边界与不变量

- **读写分离**：`GET` 是投影；`POST` 只执行 4 个固定 area 中的受限 foundation 操作，且必须带 `Idempotency-Key`。
- **数据库 schema 迁移永远不通过 HTTP 执行**：`/database/execute` 恒定返回 `409 INITIALIZATION_OPERATOR_REQUIRED`。
- **仅 admin**：两个 controller 的每个路由都调用 `requireRole(auth, cookie, 'admin', ...)`；前端隐藏入口不是授权。
- **运行时元数据可见性**：`skills` 只从 `.agents/skills/*/SKILL.md` 读取并在 Admin 展示已加载定义；`agents` 只来自 Tutor Partner / 服务端 Agent Registry；`.pi` 开发角色永远不进入快照；MCP 在安全 Registry 接入前为空。`policy` 显示并提供只读查看仓库根 `AGENTS.md`，修改仍经仓库评审与部署发布。
- **角色治理**：Admin 可编辑 Tutor Partner 的显示名称、独立角色定义、能力范围、启用状态和模型用途；写入通过 `Idempotency-Key` 与同事务审计。私有 `soul`/system prompt 不返回，编辑后的 role definition 每轮从 PostgreSQL 读取并进入 Tutor context；模型用途经 ModelRegistry 解析，未配置时仍 fail closed。
- **无法证实即 `unknown`**：前端不得把 `unknown` 渲染成 `ready`。

## 3. 管理 API

| 方法 | 路径 | 权限 | 幂等键 | 响应 `data` |
|---|---|---|---|---|
| `GET` | `/api/v1/admin/ai-runtime` | admin | 不需要 | `AdminRuntimeSnapshot` |
| `PATCH` | `/api/v1/admin/ai-runtime/agents/:agentId` | admin | **必填** | `AdminRuntimeAgent` |
| `GET` | `/api/v1/admin/initialization` | admin | 不需要 | `AdminInitializationStatus` |
| `POST` | `/api/v1/admin/initialization/knowledge/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/template/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/tutor/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/database/execute` | admin | **必填** | 恒为 `409` |

`InitializationExecutionResult` = `{ area, status: 'ready', completedAt, replayed }`。

运行服务从当前工作目录向上寻找包含 `AGENTS.md` 的项目根；部署时可用 `QITU_PROJECT_ROOT` 显式指定。

### 3.1 错误码

| code | HTTP | 触发条件 |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 缺 `Idempotency-Key`，或去空白后为空，或长度 > 200 |
| `INITIALIZATION_AREA_INVALID` | 400 | area 不属于 `database/knowledge/template/tutor` |
| `INITIALIZATION_OPERATOR_REQUIRED` | 409 | 调 `database/execute`；或所需表结构尚不可用 |
| `INITIALIZATION_DATABASE_UNAVAILABLE` | 503 | 内存模式（无 `DATABASE_URL`）或数据库当前不可达 |
| `INITIALIZATION_EXECUTION_FAILED` | 503 | 事务执行失败；同一幂等键可重试 |

错误码定义在 `packages/contracts/src/errors.ts`，前缀 `INITIALIZATION_*` 为本控制面专属。

### 3.2 幂等、审计与事务

- 幂等 scope = `admin:initialization:<area>`；同键重放返回首次结果并把 `replayed` 置为 `true`；同键换 payload 被拒绝。
- 种子写入与审计写入在**同一事务**内：`audit_logs.action = admin.initialization.<area>.execute`，`target_type='initialization'`，`target_id=<area>`，`detail.foundationVersion='v1'`。`lastRun` 即从审计读取。
- 所有 foundation 写入都用 `onConflictDoNothing()`，可重复执行。

| area | 写入 | foundation id |
|---|---|---|
| `knowledge` | `knowledge_documents` + `knowledge_chunks` | `foundation-knowledge-theory-gate` |
| `template` | `project_templates` + `project_template_versions` | `foundation-template-project-learning` |
| `tutor` | `agent_memory_records` + `outbox`（`agent-memory.index`） | `foundation-agent-memory-strategy` |

> `tutor` area 初始化的是**会话记忆 / 策略记忆**基础数据 + 一条索引 outbox，不是「学生会话」。

## 4. `AdminRuntimeSnapshot` 投影语义

契约：`packages/contracts/src/admin.ts`。

| 字段 | 来源 | 约束 |
|---|---|---|
| `policy` | 根目录 `AGENTS.md` 的版本、SHA-256 摘要、加载状态和有界规则正文 | 规则正文只读，不返回密钥或运行时凭证 |
| `skills` | `.agents/skills/*/SKILL.md` 的安全 frontmatter 与有界正文 | Admin 展示 Tutor runtime 实际加载版本；缺失时为空且**不回退到 `.pi`** |
| `mcpServers` | 无服务端 MCP Registry 时为空 | 不读取仓库开发配置 |
| `builtInTools` | `platform-registry/built-in-tools.ts` 的服务端注册表 | 只描述能力边界，执行仍由领域服务负责 |
| `agents` | `tutor_partners` 行或未来服务端 Agent Registry | 暴露独立、可治理的角色定义；私有 `soul`/完整 system prompt 不返回；不含 `.pi` 开发角色 |

`generatedAt` / `overall` / `dataSource` / `initialization` 同属快照。数据库不可达时返回明确的不可用 / 未知状态，**不以开发文件填充**。

### 4.1 初始化检查项

`initialization.checks` 固定返回四项：

| id | area | status 判定 | `operatorRequired` | `executeAllowed` |
|---|---|---|---|---|
| `database.schema` | `database` | 恒为 `unknown`（API 不探测迁移） | `true` | `false` |
| `knowledge.foundation` | `knowledge` | 有 foundation 文档 → `ready`；无 → `missing`；查询异常 → `failed` | `false` | db 可用且非 failed |
| `template.foundation` | `template` | 同上（`project_templates`） | `false` | 同上 |
| `tutor.foundation` | `tutor` | 同上（`agent_memory_records`） | `false` | 同上 |

`overall`：任一 `failed` → `degraded`；否则任一 `missing` → `not_ready`；否则 `unknown`。
`database`：无 client → `in_memory`；探活成功 → `connected`；探活失败 → `unavailable`。
`dataMode` 直接回显服务端模式。

> 结论：demo 无库（内存引擎）环境下三个 foundation 检查项为 `missing`，`overall` 是 `not_ready`，**不是** `ready`。前端必须如实显示。

## 5. 管理后台界面

- 页面：`apps/admin-console/app/(console)/settings/ai-runtime/page.tsx`，五个 tab：`skills` / `mcp` / `agents` / `tools` / `init`。
- 数据层：`apps/admin-console/lib/api/runtime.ts`，唯一读取路径是 `GET /api/v1/admin/ai-runtime`；角色写入通过 Admin-only `PATCH` 并带幂等键。
- 入口：`SettingsSubNav` 中的「AI 运行时」子导航，`/admin/settings` 页面同步。
- **冻结导航未变**：仍只有 `/admin/settings` 一个设置入口，AI 运行时是它的子导航。

### 5.1 保留的开发期制品（不进入 Tutor runtime）

| 制品 | 内容 | 定位 |
|---|---|---|
| `.pi/skills/**` | `student-module`、`tutor-engine`（含 `references/`） | Pi/Herdr 开发期工作流 |
| `.pi/agents/*.md` | 开发角色定义 | Pi/Herdr 子代理角色 |
| `.pi/settings.json` | provider / model 与 subagent 角色模型档位 | Pi/Herdr 运行配置（无密钥） |
| `.pi/extensions/student-workflow.ts` | `/student-module`、`/tutor-engine`、`/learning-plan` 命令 | Pi/Herdr 开发期编排 |

这些制品与运行时（`tutor_partners`、模型注册表、审计）**不同层，不能互相冒充**。
`.pi/*` 保留的原因是它是本地开发工作流的事实来源，删除会破坏开发与角色分工。

### 5.2 持久化会话与记忆

- **Tutor 会话 / turn**：`tutor_sessions`、`tutor_turns`（PostgreSQL）；demo/test 无库时用内存 adapter。
- **探索上下文**：`0013_tutor_exploration_context.sql` 为 `tutor_sessions` 增加 `exploration_id` 外键与部分唯一索引；探索草稿由 Projects owner 的 `/api/v1/explorations` 幂等创建。
- **Agent 记忆**：`agent_memory_records` 为权威表，外部索引（Mem0 等）由 `agent-memory.index` outbox 异步重建。
- **审计**：`audit_logs` 记录初始化与敏感读取。

## 6. 未实现 / 未决（不得当作已完成）

- 可执行的运行时 Skill / MCP 配置写入口与 MCP 健康探测尚未实现；Tutor Skill 从 `.agents/skills` 读取并以有界规则块装配。
- 知识库与模板库 Admin 可视化已提供；编辑、校验、发布复用服务端幂等治理 API。
- 多 Agent 编排、成长 / 画像异步生成、Worker 消费需分阶段接入。
- `initialization.migrationVersion` 恒为 `null`；`database.schema` 检查恒为 `unknown`。
- `.pi` 制品与 Tutor runtime 永不建立映射。

## 7. 验收

```bash
pnpm --filter @qitu/api test          # platform-registry / initialization 用例
pnpm --filter @qitu/contracts typecheck
pnpm --filter @qitu/admin-console typecheck
```

- [ ] 未认证返回 401，非 admin 返回 403。
- [ ] `database/execute` 恒 409，且不触碰 schema。
- [ ] 三条 `*/execute` 同键重放返回 `replayed:true`，不产生第二行 foundation。
- [ ] 审计 `action` 与 `lastRun` 一致。
- [ ] 快照不含密钥、完整提示词与原始对话。
