# 初始化与演示数据（demo → live）

> 目标：从零启动平台，并明确区分本地演示、自动化测试和正式 live 环境。
>
> 相关：[`database.md`](./database.md)、[`control-plane.md`](./control-plane.md)、[`authentication.md`](./authentication.md)、`database/README.md`。

## 1. 数据模式

| 模式   | 数据库   | 用途                            | 生产允许 |
| ------ | -------- | ------------------------------- | -------- |
| `live` | 必须     | 正式环境，业务真源在 PostgreSQL | 是       |
| `demo` | 推荐有库 | 本地或共享演示，执行确定性 seed | 否       |
| `test` | 可选     | 自动化测试或内存边界验证        | 否       |

`services/api` 默认 `live`。live 缺少 `DATABASE_URL` 会 fail-fast；`demo`/`test` 在没有数据库时只能使用明确标识的本地测试引擎，不能伪造持久化成功或真实审计。

## 2. 前置条件

- Node.js `>=22`、pnpm `10.10.0`、PostgreSQL 和可选 Redis。
- `DATABASE_URL`、`QITU_DATA_MODE`、端口配置来自受限环境变量，不提交 `.env`。
- live 模式配置 `QITU_MODEL_SECRET_KEY`，Provider API Key 由管理端或受限导入写入加密存储。
- 需要 Graphiti 时另行启动 Docker/Neo4j；Graphiti 关闭不影响 PostgreSQL 业务真源。

## 3. demo 初始化

```bash
createdb qitu_dev
export DATABASE_URL=postgresql://127.0.0.1:5432/qitu_dev
export QITU_DATA_MODE=demo

# 0000 到 0021，按 journal 顺序 forward-only 执行
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue ;; esac
  psql "$DATABASE_URL" -f "$f"
done

pnpm --filter @qitu/database seed
pnpm --filter @qitu/database build
bash tooling/start-qitu-services.sh start
bash tooling/start-qitu-services.sh status
```

### 3.1 演示身份

`database/seeds/demo-identities.sql` 创建学生、家长、班主任和管理员的确定性身份，并通过 `seed id` 维护关系。邮箱和口令由受限 seed 或 `DEMO_*` 环境变量提供；文档、Git 和生产日志不保存明文口令。

| 角色   | 示例邮箱              | seed id          |
| ------ | --------------------- | ---------------- |
| 学生   | `student@qtzx.local`  | `student-demo`   |
| 学生   | `student2@qtzx.local` | `student-demo-2` |
| 家长   | `parent@qtzx.local`   | `parent-demo`    |
| 班主任 | `teacher@qtzx.local`  | `teacher-demo`   |
| 管理员 | `admin@qtzx.local`    | `admin-demo`     |

登录页可以一键填入共享演示环境的测试身份，但仍然提交真实 `/api/v1/auth/login`，不能把填充动作当成登录成功。

## 4. live 初始化

```bash
export DATABASE_URL='postgresql://db-host:5432/qitu'  # 认证由受限环境或 .pgpass 提供
export QITU_DATA_MODE=live
export QITU_MODEL_SECRET_KEY='set-in-secret-manager'

# 只执行迁移，不执行演示身份 seed
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue ;; esac
  psql "$DATABASE_URL" -f "$f"
done

bash tooling/start-qitu-services.sh start
```

正式账号通过受控创建或邀请流程进入。Provider 和模型由管理员在 `/admin/settings/model-providers` 配置并连接测试，Agent 再在 `/admin/settings/ai-runtime` 选择直接模型；不要复制本地 `auth.json`、OAuth 文件或 API Key 到 Git。

## 5. 管理端初始化 API

以下接口只允许管理员执行，写操作需要 `Idempotency-Key`；数据库 schema migration 永远通过部署 CLI 完成：

```http
GET  /api/v1/admin/initialization
GET  /api/v1/admin/ai-runtime
POST /api/v1/admin/initialization/knowledge/execute
POST /api/v1/admin/initialization/template/execute
POST /api/v1/admin/initialization/tutor/execute
POST /api/v1/admin/initialization/database/execute  # 恒定拒绝，必须走 CLI
```

初始化服务只负责受限的 foundation 写入、状态投影、审计和重复执行保护，不接受浏览器提交 SQL、迁移文件、模型凭证或任意表名。

## 6. 空态、错误和回滚

- 数据库不可达时 API 返回 unavailable/error，前端显示明确状态，不回退到共享 demo 数据。
- Provider 或模型不可用时显示未配置/同步失败，不能伪造连接成功或静默切换模型。
- seed 可重复执行；冲突由唯一约束和 `DO UPDATE` / `DO NOTHING` 处理。
- 迁移只向前执行；回滚在受控环境使用备份或对应 `.down.sql`，不通过 HTTP 初始化接口完成。

## 7. 验收

```bash
pnpm typecheck
pnpm test
pnpm build
bash tooling/start-qitu-services.sh status
```

至少验证 API、workers、auth、student、parent、teacher、admin 的健康状态，Provider/model 连接测试，以及一次真实 Team Run 的任务、事件和错误码回传。

## 8. 未决事项

- [ ] 完成 live 用户邀请、密码轮换、MFA 和持久化 session 撤销。
- [ ] 为初始化任务补充可观测性、重试窗口和管理员审计查询。
- [ ] 建立生产数据保留、删除和恢复演练记录。
