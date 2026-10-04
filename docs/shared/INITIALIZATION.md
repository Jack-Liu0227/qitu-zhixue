# 初始化与演示数据（demo → live）

> 目标：让任何人从零把平台跑起来，并且明确区分「演示」与「正式」两条初始化路径。
> 关联：ADR 0005、`docs/shared/DATABASE.md`、`docs/admin/PLATFORM_CONTROL_PLANE.md`、`database/README.md`、`docs/shared/DEPLOYMENT_AND_AGENTS.md`。
>
> 变更说明（Wave 4）：数据模式改为显式 `QITU_DATA_MODE`（默认 `live`）。本次只改代码/脚本/文档，
> **未重启任何正在运行的服务**；若要让新默认生效，需在配置好 `DATABASE_URL` 后由操作者自行重启。

## 1. 两条路径 + 数据模式，不混用

| 路径 | `QITU_DATA_MODE` | 用途 | 迁移 | 演示种子 | 允许环境 |
|---|---|---|---|---|---|
| `demo` | `demo` | 本地开发、联调、演示 | ✅ | ✅ | 本地 / 共享演示库（非 production） |
| `live` | `live`（默认） | 预发、生产 | ✅ | ❌ | 预发 / 生产 |

**硬规则**：

- 应用启动**不会**自动建表、自动灌种子；`live` 初始化**只跑迁移**。种子脚本必须由人显式调用。
- `QITU_DATA_MODE` 未设置时默认为 `live`（生产与普通 dev 都不得静默退回内存）。
- 只有**显式** `QITU_DATA_MODE=demo`（或 `test`）**且非 production** 才允许内存 Directory 引擎。
- `production` + `demo`/`test`、非法模式值、`live` 缺 `DATABASE_URL` 一律 **启动失败（fail-fast）**。

## 2. 前置条件

- Node.js ≥ 22（`.node-version`），`pnpm` 10。
- 一个 PostgreSQL 实例（本地或容器）。
- 环境变量：
  - `QITU_DATA_MODE`：`live | demo | test`，默认 `live`。
  - `DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/qitu_dev`：`live`（默认）**必填**；
    `demo` / `test` 可缺省以使用内存引擎（仅非 production）。
  - 其它端口见 `tooling/qitu-ports.env.example`。
- **口令只从环境变量读取**，仓库内不保存任何凭据（`.env`、`.env.*` 已被 `.gitignore` 覆盖）。
- `tooling/start-qitu-services.sh start|restart` 在启动 API 前只检查 `DATABASE_URL` **是否存在**
  （不读取/打印其值），缺失则给出中英文错误并退出；`stop` / `status` 不受影响。

## 3. demo 初始化（复制即用）

```bash
# 0) 依赖
pnpm install

# 1) 建库（名称自定，与 DATABASE_URL 一致）
createdb qitu_dev
export DATABASE_URL=postgresql://127.0.0.1:5432/qitu_dev
export QITU_DATA_MODE=demo   # 显式声明演示路径；默认是 live

# 2) 按序重放迁移（forward-only，可对空库执行；已到 0013）
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue;; esac
  psql "$DATABASE_URL" -f "$f"
done

# 3) 灌入确定性演示数据（幂等，可重复执行）
pnpm --filter @qitu/database seed

# 4) 构建运行时依赖包（services/api 运行时要 require dist）
pnpm --filter @qitu/database build

# 5) 一键启动全部服务（内部会再确保 @qitu/database 已 build）
bash tooling/start-qitu-services.sh start
bash tooling/start-qitu-services.sh status
```

### 演示账号（固定 fixture，可写入文档）

| 角色 | 邮箱 | 口令 | id |
|---|---|---|---|
| 学生 | `student@qtzx.local` | `student123` | `student-demo` |
| 学生 | `student2@qtzx.local` | `student123` | `student-demo-2` |
| 学生 | `student3@qtzx.local` | `student123` | `student-demo-3` |
| 学生 | `student4@qtzx.local` | `student123` | `student-demo-4` |
| 家长 | `parent@qtzx.local` | `parent123` | `parent-demo` |
| 家长 | `parent2@qtzx.local` | `parent123` | `parent-demo-2` |
| 班主任 | `teacher@qtzx.local` | `teacher123` | `teacher-demo` |
| 班主任 | `teacher2@qtzx.local` | `teacher123` | `teacher-demo-2` |
| 管理员 | `admin@qtzx.local` | `admin123` | `admin-demo` |

> 上表口令以 `database/seeds/demo-identities.sql` 的哈希为准；文档与种子必须同步维护。
> **切勿用于正式环境。**

演示关系（由种子写入）：
- 班主任：`teacher-demo → student-demo / student-demo-3`，`teacher-demo-2 → student-demo-2 / student-demo-4`。
- 家长：`parent-demo → student-demo / student-demo-3`，`parent-demo-2 → student-demo-2`。

## 4. live 初始化

```bash
export DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/qitu   # live 必填；仅从环境读取
# 注意：不要在仓库内保存连接串/口令。
export QITU_DATA_MODE=live   # 默认值，显式写出

pnpm install
pnpm --filter @qitu/database build
# 只跑迁移，不执行 seed；显式按序重放（已到 0013）
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue;; esac
  psql "$DATABASE_URL" -f "$f"
done
# 不执行 seed；真实账号通过邀请/注册流程创建（M1 后续）
```

- `live` 缺少 `DATABASE_URL` 或在 `production` 下使用 `demo`/`test`，API **拒绝启动**。
- 生产凭据方案（带盐 KDF）尚未实现，**在实现前不得上线真实用户**（见 ADR 0005）。
- 生产密钥（模型 API Key）应来自密钥管理服务，不写入数据库明文列。

### 4.1 管理后台 HTTP 初始化（受限，**不**执行迁移）

除了操作者跑迁移，管理员还可以从管理后台执行三类 **foundation 初始化**。
这些端点只写固定 id 的 foundation 行，**永远不执行 schema migration**：

```text
GET  /api/v1/admin/ai-runtime                              # 只读运行时投影
GET  /api/v1/admin/initialization                          # 只读初始化状态
POST /api/v1/admin/initialization/knowledge/execute        # 需 Idempotency-Key
POST /api/v1/admin/initialization/template/execute         # 需 Idempotency-Key
POST /api/v1/admin/initialization/tutor/execute            # 需 Idempotency-Key
POST /api/v1/admin/initialization/database/execute         # 恒 409，必须走部署/CLI
```

| area | 写入 | foundation id |
|---|---|---|
| `knowledge` | `knowledge_documents` + `knowledge_chunks` | `foundation-knowledge-theory-gate` |
| `template` | `project_templates` + `project_template_versions` | `foundation-template-project-learning` |
| `tutor` | `agent_memory_records` + `outbox` | `foundation-agent-memory-strategy` |

硬规则：

- 每个路由只向 `admin` 开放（`requireRole`），前端隐藏入口不构成授权。
- 三条 `execute` 必须带 `Idempotency-Key`（去空白后非空、≤200 字符）；同键重放返回首次结果
  并置 `replayed: true`；种子与 `audit_logs` 写入同事务，action 为
  `admin.initialization.<area>.execute`。
- 内存模式（无 `DATABASE_URL`）执行返回 `503 INITIALIZATION_DATABASE_UNAVAILABLE`；
  表结构未就绪返回 `409 INITIALIZATION_OPERATOR_REQUIRED`；未知 area 返回 `400 INITIALIZATION_AREA_INVALID`。
- `GET /api/v1/admin/initialization` 只读状态来自 `platform-registry` 的只读投影；
  `database.schema` 恒为 `unknown`，`migrationVersion` 恒为 `null`（API 不探测迁移）。

完整字段语义、检查项判定和界面状态见 `docs/admin/PLATFORM_CONTROL_PLANE.md`。

## 5. 数据模式与引擎切换机制（重要）

`services/api/src/database/database.module.ts` 由环境变量 `QITU_DATA_MODE` 决定接线：

| `QITU_DATA_MODE` | `NODE_ENV` | `DATABASE_URL` | 结果 |
|---|---|---|---|
| 未设置 / `live` | 任意 | 有 | Postgres 引擎（`withTransaction()` 可用） |
| 未设置 / `live` | 任意 | 缺 | **启动失败**（`DataModeError`），绝不退回内存 |
| `demo` / `test` | 非 production | 缺 | 内存 Directory 引擎（镜像种子行） |
| `demo` / `test` | 非 production | 有 | Postgres 引擎 |
| `demo` / `test` | `production` | 任意 | **启动失败**（内存引擎不得进 production） |
| 其它值 | 任意 | 任意 | **启动失败**（非法模式） |

- `live` 下 `createDb()` 抛错同样会让启动失败（不再捕获后降级为 inert）。
- 环境变量在 Nest provider 工厂（依赖注入阶段）读取，不在模块 import 时读取。
- `DirectoryService` 仍以 `DATABASE_TOKEN` 是否为空选择引擎，并在 live + 空 token 时兜底抛错。

> `DirectoryService` 的内存引擎镜像了种子行，Postgres 引擎读取同一批表，
> 两者输出形状一致（ADR 0005）。修改其中一个必须同步另一个。

### 已知风险（仍有未决）

`createDb()` 是惰性连接：`DATABASE_URL` 已设置但库**不可达**时，`DatabaseModule` 返回非空 client，
查询在**运行时报错**，不会自动回退内存引擎（这一层不在本次 fail-fast 范围内）。
「库不可达」的启动策略仍待定稿（见 ADR 0005 / `docs/shared/DATABASE.md` 未决事项）。

## 6. 空态策略

| 场景 | 期望行为 |
|---|---|
| 库为空、未跑种子 | API 正常启动；登录失败（无账号）；列表返回空；前端展示 empty |
| 库为空、已跑种子 | 演示账号可登录，关系与名单可见 |
| 无 `DATABASE_URL` 且 `QITU_DATA_MODE=demo / test`（非 production） | 内存引擎；演示账号仍可登录（镜像数据） |
| 无 `DATABASE_URL` 且 `QITU_DATA_MODE=live`（默认） | API **拒绝启动**（这是配置错误，不是空态） |
| 迁移未跑 | 查询报错（表不存在）——属于配置错误，应在初始化步骤被发现 |

每个页面必须覆盖 loading / empty / error / 断网 / 权限失败状态（AGENTS.md 开发要求）。

## 7. 验收标准

- [ ] 清空数据库后，按 §3 命令可完整启动并登录演示账号。
- [ ] 连续执行两次 seed，`users` 数量不增加（幂等）。
- [ ] `live`（默认）缺 `DATABASE_URL` 时 API 拒绝启动，不退回内存引擎。
- [ ] `production` + `QITU_DATA_MODE=demo/test` 拒绝启动；非法模式值拒绝启动。
- [ ] `live` 流程不产生任何演示账号。
- [ ] 管理后台 `GET /api/v1/admin/ai-runtime` 与 `/admin/initialization` 对非 admin 返回权限错误；
      对 admin 返回脱敏只读投影（`.pi/skills` / `.pi/agents` 摘要、可选 MCP 元数据、内置工具注册表，
      `migrationVersion` 为 `null`）。
- [ ] 缺 `Idempotency-Key` 调 `POST /admin/initialization/*/execute` 返回 `400 IDEMPOTENCY_KEY_REQUIRED`；
      调 `database/execute` 返回 `409 INITIALIZATION_OPERATOR_REQUIRED`；同键重放为 `replayed: true`。
- [ ] `bash tooling/start-qitu-services.sh status` 六个服务全部 `ok`。
- [ ] `bash tooling/start-qitu-services.sh stop` / `status` 在缺 `DATABASE_URL` 时仍可用。

## 8. 回滚

- 迁移前向；回滚使用对应 `.down.sql`，人工评审后在受控环境执行。
- 演示库可整体 `dropdb` 后重放，不承载真实数据。
- 关系数据不做物理删除，结束时写 `status=ended`（可追溯）。

## 9. 未决事项

- [ ] 正式凭据 KDF（scrypt/argon2）与迁移脚本。
- [ ] 库不可达（`DATABASE_URL` 有值但连不上）时的启动策略：当前仍是查询期报错，未做启动时探活。
- [ ] 内存引擎与 Postgres 引擎的自动化一致性测试。
- [ ] 邀请/注册流程（`live` 账号创建）尚未实现。
- [ ] 迁移执行工具（Drizzle migrate vs 裸 `psql`）在 CI/CD 中的统一。
- [ ] 迁移版本探测：`initialization.migrationVersion` 目前恒为 `null`，`database.schema` 恒为 `unknown`。
- [ ] 可执行的运行时 skill / MCP 配置写入口与 MCP 健康探测；当前只提供安全的只读发现和内置工具注册表。
