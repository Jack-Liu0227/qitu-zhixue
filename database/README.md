# Database boundary

PostgreSQL is the system of record. Database migrations are owned by the API/domain layer and must be reviewed with the module that owns the tables.

Planned responsibilities:

- `migrations/`: forward-only schema migrations with rollback notes
- `seeds/`: deterministic development/test data only
- `fixtures/`: isolated test fixtures, never production data

The initial repository does not create business tables. M1 will introduce identity, household, guardian link, session and audit migrations before project tables are added.

## 操作命令

连接串只从环境变量读取，仓库内不保存任何口令（`.env.local` 已被 `.gitignore` 覆盖）：

```bash
# 建库后按编号顺序重放迁移（对空库可重放，forward-only）
psql "$DATABASE_URL" -f database/migrations/0000_clever_kang.sql
psql "$DATABASE_URL" -f database/migrations/0001_cheerful_colossus.sql
psql "$DATABASE_URL" -f database/migrations/0002_light_miracleman.sql
psql "$DATABASE_URL" -f database/migrations/0003_glamorous_ulik.sql

# 确定性演示数据，幂等，可重复执行
# 身份/口令冲突时会被**修正**（DO UPDATE），关系冲突时**保留**（DO NOTHING）
pnpm --filter @qitu/database seed

# 不连库，只校验证种子文件存在与确定性执行顺序
pnpm --filter @qitu/database exec tsx src/seed.ts --check

# 修改 schema 后重新生成迁移（schema 在 packages/database/src/schema/）
pnpm --filter @qitu/database generate
```

### 种子执行顺序

`packages/database/src/seed.ts` 只负责按下面的**确定性顺序**读取并执行 `seeds/*.sql`，
种子内容只有 .sql 一份真源，不要往 TS 里另写一份数据：

| 顺序 | 文件 | 内容 | 为什么必须在此时执行 |
| --- | --- | --- | --- |
| 1 | `seeds/demo-identities.sql` | `schools` / `users` / `guardian_links` / `mentor_assignments` | 建立 `school-demo` 与 `admin-demo` / `teacher-demo` / `student-demo` 等身份 |
| 2 | `seeds/tutor-workspace.sql` | `tutor_partners` / `tutor_template_documents` / `tutor_knowledge_documents` / synthetic agent session-memory foundation | 领域表的 `student_memories.partner_id` 引用 `tutor_partners`；memory fixture is student-independent and emits one idempotent index outbox event |
| 3 | `seeds/domain-foundation.sql` | 规范化领域表（模板 / 知识 / 计划 / 掌握度 / 成长 / 记忆 / 评审） | `created_by` / `student_user_id` / `mentor_user_id` / `partner_id` 引用前两步 |

种子执行前必须完成 `0010_agent_memory.sql`（以及其前置迁移）；否则 tutor-workspace 的 session-memory foundation 无法落库。管理员初始化 API 也会先检查该 schema，不会静默降级。

`seeds/demo-identities.sql` 是身份种子数据的**唯一真源**；`domain-foundation.sql` 是
规范化领域表的真源（迁移 `0008_domain_foundation`），两者均随 `pnpm seed` 自动执行。

## 横切基础表

- `idempotency_keys`（`0001_cheerful_colossus`）：`Idempotency-Key` 写操作的持久化去重记录。
  `(scope, key)` 唯一，`scope` 标识操作（如 `POST /api/v1/projects`）；`request_hash`
  用于「同键不同载荷」的冲突判定；`status`（`in_progress`/`succeeded`/`failed`）与
  `response_status` / `response_body` 保存已发生的结果以支持重放；`expires_at` 界定保留期。
- `outbox.last_error`（`0001`，可空、向后兼容增量）：记录 `status='failed'` 的失败原因，
  便于运维诊断；未失败前为 `NULL`。
- `parent_growth_exports`（`0003_glamorous_ulik`，ISSUE-T5）：家长成长导出任务。
  保存任务元数据与**服务端白名单投影后的脱敏正文**（无原始 AI 对话 / 语音 / 风险
  标签 / 邮箱 / 模型推断）；下载时重新校验 active 监护关系与有效期。由
  Parent Experience 模块独占写入，见
  `services/api/src/modules/parent/growth-export.md`。
- `user_preferences`（`0005_t4_user_preferences`，ISSUE-T4）：四端账号基础偏好。
  主键即 `user_id`（self-only，无跨账号写入路径）；只存字号 / 主题预设 id / 减弱动效 /
  通知开关，**不存颜色值、不存未成年人敏感数据**；读取无记录时返回契约默认值且不落库。
  由 Account 模块独占写入，见 `services/api/src/modules/account/account-preferences.md`。

> 迁移只前向；每个迁移配 `.down.sql` 回滚说明。`0001` 的 DDL 对空库与已升级库均可重放
> （`CREATE TABLE/INDEX IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`）。schema 改动后必须
> 重新生成迁移，并用 `pnpm exec drizzle-kit generate` 确认「No schema changes」。

## 幂等语义（重要）

| 表 | 冲突时 | 原因 |
| --- | --- | --- |
| `users` | `DO UPDATE`（修正） | 身份与口令是固定 fixture，必须与文档中的登录凭据一致 |
| `guardian_links` / `mentor_assignments` | `DO NOTHING`（保留） | 运行期可变的关系，用户可能已刻意解绑，种子不得复活 |

`users` 用 `DO UPDATE` 是有代价换来的教训：早期某次灌库写入的是占位口令
`$2a$10$dummyhash`，`DO NOTHING` 让这个错误被永久固化，结果所有账号登录
恒为 401，而从代码上看不出问题。身份 fixture 必须能自我纠正。

口令方案：`password_hash` 存 sha256(明文) 十六进制，与
`auth.service.ts` 的 `safePasswordEqual()` 语义等价。
**这是 demo 级方案**，正式用户上线前必须换为带盐 KDF（scrypt/argon2）。
凭据的读取入口只有一个：`DirectoryService.findCredentialByEmail()`
（Postgres 引擎读 `users.password_hash`，内存引擎读同值镜像）。

## 与其他目录的分工

- `packages/database/` 是**代码包**（schema + client）。
  它导出运行时值，因此必须 `pnpm --filter @qitu/database build` 出 `dist/`
  才能被 `services/api` 在运行时 require；原因见
  `docs/admin/database.md` 的「实施补充 1」。
- 本目录（`database/`）是**产物目录**：迁移 / 种子 / fixture。
