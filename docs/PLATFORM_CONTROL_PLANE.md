# 平台控制面：AI 运行时投影与初始化

> 状态：当前基线（第一切片，只读投影 + 受限幂等初始化）。
> 关联：`docs/ARCHITECTURE.md`、`docs/INITIALIZATION.md`、`docs/PERMISSIONS.md`、
> `docs/DEPLOYMENT_AND_AGENTS.md`、ADR 0008（管理员与班主任边界）。
>
> 本文描述**已经实现**的行为。尚未实现的能力在 §7 明确标注为「未实现」。

## 0. 一句话

管理后台提供 Admin-only 的知识库、模板库和 AI 运行时可视化；运行时页只展示已加载的 Tutor policy、`.agents/skills`、Tutor Partner、真实工具描述和初始化状态。控制面不读取 `.pi` 开发协作元数据、仓库 MCP 配置或数据库凭据。

## 1. 边界与不变量

- **读写分离**：`GET` 是投影，`POST` 只执行 4 个固定 area 中的受限 foundation
  操作，且必须带 `Idempotency-Key`。
- **数据库 schema 迁移永远不通过 HTTP 执行**：`/database/execute` 恒定返回
  `409 INITIALIZATION_OPERATOR_REQUIRED`。
- **仅 admin**：两个 controller 的每个路由都调用 `requireRole(auth, cookie, 'admin', ...)`；
  前端隐藏入口不是授权。
- **运行时元数据可见**：`skills` 只从 `.agents/skills/*/SKILL.md` 读取；`agents` 只来自
  Tutor Partner/服务端 Agent Registry；`.pi` 开发角色永远不进入快照；MCP 在安全 Registry 接入前为空。
  `policy` 显示 `AGENTS.md` 的版本/hash/加载状态，不返回全文。
- **脱敏**：投影不得返回 API Key、MCP 凭证、完整系统提示词或未成年人原始对话。
- **无法证实即 `unknown`**：前端不得把 `unknown` 渲染成 `ready`。

## 2. 管理 API

| 方法 | 路径 | 权限 | 幂等键 | 响应 `data` |
|---|---|---|---|---|
| `GET` | `/api/v1/admin/ai-runtime` | admin | 不需要 | `AdminRuntimeSnapshot` |
| `GET` | `/api/v1/admin/initialization` | admin | 不需要 | `AdminInitializationStatus` |
| `POST` | `/api/v1/admin/initialization/knowledge/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/template/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/tutor/execute` | admin | **必填** | `InitializationExecutionResult` |
| `POST` | `/api/v1/admin/initialization/database/execute` | admin | **必填** | 恒为 `409`（见下） |

`InitializationExecutionResult` = `{ area, status: 'ready', completedAt, replayed }`。

实现位置：`services/api/src/modules/platform-registry/`、`services/api/src/modules/initialization/`。
运行服务会从当前工作目录向上寻找包含 `AGENTS.md` 的项目根；部署时可用 `QITU_PROJECT_ROOT` 显式指定根目录。

### 2.1 错误码

| code | HTTP | 触发条件 |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 缺 `Idempotency-Key`，或去空白后为空，或长度 > 200 |
| `INITIALIZATION_AREA_INVALID` | 400 | area 不属于 `database/knowledge/template/tutor` |
| `INITIALIZATION_OPERATOR_REQUIRED` | 409 | 调 `database/execute`；或所需表结构尚不可用（需先由部署/CLI 跑迁移） |
| `INITIALIZATION_DATABASE_UNAVAILABLE` | 503 | 内存模式（无 `DATABASE_URL`）或数据库当前不可达 |
| `INITIALIZATION_EXECUTION_FAILED` | 503 | 事务执行失败；同一幂等键可重试 |

错误码定义在 `packages/contracts/src/errors.ts`，前缀 `INITIALIZATION_*` 为本控制面专属。

### 2.2 幂等、审计与事务

三条 `*/execute` 命令的行为一致：

- 幂等 scope = `admin:initialization:<area>`，请求哈希由该 scope 生成；同键重放返回
  首次结果并把 `replayed` 置为 `true`；同键换 payload 被拒绝（幂等错误映射为 HTTP 错误）。
- 种子写入与审计写入在**同一事务**内：`audit_logs.action = admin.initialization.<area>.execute`，
  `target_type = 'initialization'`，`target_id = <area>`，`detail.foundationVersion = 'v1'`。
  `audit_logs.action` 同时是 `GET` 状态里 `lastRun` 的证据来源。
- 所有 foundation 写入都用 `onConflictDoNothing()`，可重复执行。

各 area 写入的 foundation 行（固定 id，便于状态检查）：

| area | 写入 | foundation id |
|---|---|---|
| `knowledge` | `knowledge_documents` + `knowledge_chunks` | `foundation-knowledge-theory-gate` |
| `template` | `project_templates` + `project_template_versions` | `foundation-template-project-learning` |
| `tutor` | `agent_memory_records` + `outbox`（`agent-memory.index`） | `foundation-agent-memory-strategy` |

> `tutor` area 初始化的是**会话记忆/策略记忆**基础数据 + 一条索引 outbox，不是「学生会话」。

## 3. `AdminRuntimeSnapshot` 投影语义

`generatedAt` / `overall` / `dataSource` / `skills` / `mcpServers` / `agents` /
`builtInTools` / `initialization`（契约见 `packages/contracts/src/admin.ts`）。

| `policy` | 根目录 `AGENTS.md` 的版本、SHA-256 摘要和加载状态 | 不返回规则全文 |
| `skills` | 发现 `.agents/skills/*/SKILL.md` 的安全 frontmatter | 只展示 Tutor runtime skill 元数据；缺失时为空且不可回退到 `.pi` |
| `mcpServers` | 当前无服务端 MCP Registry 时为空 | 不读取仓库开发配置 |
| `builtInTools` | `platform-registry/built-in-tools.ts` 的服务端注册表 | 注册表只描述能力边界，执行仍由领域服务负责 |
| `agents` | `tutor_partners` 行或未来服务端 Agent Registry | 不返回完整 system prompt；不包含 `.pi` 开发角色 |

`agents` 只读取 Tutor Partner 的持久化运行状态；`.pi` 文件不参与应用运行时。数据库不可达时返回明确的不可用/未知状态，不以开发文件填充运行时列表。

### 3.1 初始化检查项

`initialization.checks` 当前固定返回四项：

| id | area | status 判定 | `operatorRequired` | `executeAllowed` |
|---|---|---|---|---|
| `database.schema` | `database` | 恒为 `unknown`（API 不探测迁移） | `true` | `false` |
| `knowledge.foundation` | `knowledge` | 有 foundation 文档 → `ready`；无 → `missing`；查询异常 → `failed` | `false` | `db 可用且非 failed` |
| `template.foundation` | `template` | 同上（`project_templates`） | `false` | 同上 |
| `tutor.foundation` | `tutor` | 同上（`agent_memory_records`） | `false` | 同上 |

`initialization.overall`：任一 `failed` → `degraded`；否则任一 `missing` → `not_ready`；
否则 `unknown`。`database`：无 client → `in_memory`；探活成功 → `connected`；
探活失败 → `unavailable`。`dataMode` 直接回显服务端模式。

> 结论：在 demo/demo 无库（内存引擎）环境下三个 foundation 检查项为 `missing`，`overall` 是
> `not_ready`，不是 `ready`。前端必须如实显示。

## 4. 管理后台界面

- 页面：`apps/admin-console/app/(console)/settings/ai-runtime/page.tsx`，
  五个 tab：`skills` / `mcp` / `agents` / `tools` / `init`。
- 数据层：`apps/admin-console/lib/api/runtime.ts`，只读。404 或
  `ApiError.status === 404` 抛 `AdminRuntimeUnavailableError`，页面显示「未启用」而不是
  把空数据画成「无配置」。
- 入口：`apps/admin-console/lib/components/SettingsSubNav.tsx` 新增「AI 运行时」子导航，
  `apps/admin-console/app/(console)/settings/page.tsx` 同步。
- 状态覆盖：loading / empty / error / 断网 / 权限失败；未知值渲染为 `unknown` 而不是 `ready`。
- **冻结导航未变**：仍只有 `/admin/settings` 一个设置入口，AI 运行时是它的子导航；
  产品文档 §7.1 与 `系统设置.png` 壳层保持。

### 4.1 保留的开发期制品（不进入 Tutor runtime）

以下制品明确保留，供 Pi/Herdr 开发协作使用，但 Admin 运行时控制面不读取、不展示：

| 制品 | 内容 | 定位 |
|---|---|---|
| `.pi/skills/**` | 2 个 skill（`student-module`、`tutor-engine`，含 `references/`） | Pi/Herdr 开发期工作流 |
| `.pi/agents/*.md` | 30 个角色定义（含 `architect`、`frontend`、`backend-database`、`docs-manager`、`sdk-manager`、`knowledge-base`、`code-cleaner` 等） | Pi/Herdr 子代理角色 |
| `.pi/settings.json` | provider/model 与 `subagents` 角色模型/思考档位覆盖 | Pi/Herdr 运行配置（无密钥） |
| `.pi/extensions/student-workflow.ts` | `/student-module`、`/tutor-engine`、`/learning-plan` 斜杠命令，把 skill 文本注入会话 | Pi/Herdr 开发期编排 |

- **MCP 注册**：仓库开发配置不属于 Tutor runtime。只有未来接入服务端安全 MCP Registry 后，才允许在控制面展示脱敏元数据。
- **内置工具注册表**：`services/api/src/modules/platform-registry/built-in-tools.ts` 提供服务端脱敏注册表，列出能力、风险和理论门禁；它不替代实际领域服务，也不暴露函数实现。
- **运行时 Skill**：`.agents/skills/**` 是 Tutor runtime 的源文件；加载由 `services/api/src/common/tutor-runtime/runtime-source.ts` 完成，缺失时不回退到 `.pi`。

> `.pi/*` 的保留原因：它是 Pi/Herdr 开发工作流的事实来源，删除会破坏本地开发与
> 角色分工。它与应用运行时（`tutor_partners`、模型注册表、审计）**不同层**，
> 不能互相冒充。

### 4.2 持久化会话与记忆

- **Tutor 会话/turn 持久化**：`tutor_sessions`、`tutor_turns`（PostgreSQL），
  demo/test 无库时用内存 adapter。清理没有删除会话存储。
- **探索上下文**：迁移 `database/migrations/0013_tutor_exploration_context.sql` 为 `tutor_sessions` 增加
  `exploration_id` 外键与部分唯一索引（`source` 列在 0007 已存在）；探索草稿由 Projects owner 的
  `/api/v1/explorations` 幂等创建。
- **Agent 记忆**：`agent_memory_records` 为权威表，外部索引（Mem0 等）由
  `agent-memory.index` outbox 异步重建；`tutor` area 初始化只写基础策略记忆。
- **审计**：`audit_logs` 记录初始化与敏感读取；初始化的 `lastRun` 从审计读取。

## 5. 兼容入口清理记录（删除项均附调用方证据）

| 删除项 | 调用方证据 |
|---|---|
| 前端 `POST /api/v1/tutor/stream` 调用 | 服务端已无该路由；`apps/student-center/features/tutor/data/tutorApiDataSource.ts` / `apps/student-center/features/tutor/data/tutorStream.ts` 改调 `POST /api/v1/tutor/sessions/:id/stream`；`grep -rn "/tutor/stream" apps services packages` 仅命中注释 |
| 自由探索页面 `/student/inspiration/explore/[sessionId]` | 页面已删；`grep -rn "inspiration/explore" apps services packages` 无命中；推荐卡改指 `/student/inspiration/recommended/<id>`，自由探索改指 `/student/tutor` |
| `FREE_EXPLORE_SESSION_ID` 与 `freeExploreHref(sessionId)` 带参签名 | `grep -rn "FREE_EXPLORE_SESSION_ID" apps services packages` 无命中；`freeExploreHref()` 现为无参、返回 `/student/tutor` |
| 语音模块 `apps/student-center/features/voice/**` | `grep -rn "features/voice" apps services packages` 无命中 |
| `CapabilityRail` / `CapabilityTile` / `useCapabilityInvoke` | `grep -rn "CapabilityRail\|CapabilityTile\|useCapabilityInvoke" apps services packages` 无命中 |
| 历史内存辅助函数 | 已删除；记忆写入只由服务端领域 owner 负责 |

**残留不一致（未在本切片修代码）**：`services/api/src/modules/ai-tutor/tutor.controller.ts`、
`apps/student-center/features/tutor/data/tutorApiDataSource.ts`、
`apps/student-center/features/tutor/data/tutorStream.ts` 中仍有「`/tutor/stream` 是服务端别名」的注释，但该路由已不存在。
注释与实现不一致，应随下一次触碰这些文件时修正。

## 6. 验证命令

```bash
# 只读投影与权限
pnpm --filter @qitu/api test            # 含 platform-registry / initialization 用例

# 契约类型
pnpm --filter @qitu/contracts typecheck

# 管理后台
pnpm --filter @qitu/admin-console typecheck   # 需要本地可见的 @qitu/ui / react 依赖

# 全仓类型
pnpm typecheck

# 迁移（操作者路径，不走 HTTP）
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue;; esac
  psql "$DATABASE_URL" -f "$f"
done
```

## 7. 未实现 / 未决（不得当作已完成）

- 可执行的运行时 Skill/MCP 配置写入口和 MCP 健康探测尚未实现；当前 Tutor Skill 从 `.agents/skills` 读取并以有界规则块装配。
- 知识库和模板库 Admin 可视化已提供；编辑、校验、发布仍复用服务端幂等治理 API。
- Agent SDK 已冻结首版前后端协同合同；多 Agent 编排、成长/画像异步生成和 Worker 消费仍需后续分阶段接入。
- 迁移版本探测：`initialization.migrationVersion` 恒为 `null`；`database.schema` 检查恒为 `unknown`。
- `.pi` 制品与 Tutor runtime 永不建立映射；`.agents/skills`、Tutor Partner、Tool Registry 和安全 MCP Registry 才是未来运行时来源。
