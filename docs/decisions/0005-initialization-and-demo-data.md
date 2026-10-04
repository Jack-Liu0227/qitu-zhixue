# ADR 0005：初始化与演示数据（demo → live）

- 状态：**Accepted**
- 日期：2026-09-27
- 范围：空库初始化、演示种子、内存引擎与 Postgres 引擎的切换、凭据处理
- 关联：ADR 0001（第 5 条：PostgreSQL 通过基础设施边界接入）、ADR 0003（数据库访问层）、`database/README.md`、`docs/shared/INITIALIZATION.md`、`docs/shared/DATABASE.md`

## 背景

平台要在「没有人手工建表、没有人手工灌数据」的前提下，让新同学一条命令把本地环境跑起来；
同时必须能接住真实用户，而不是把演示数据带进生产。

当前事实（Stage 1，主工作树未提交）：

- `packages/database` 已存在，schema 用 Drizzle ORM 声明；迁移产物落在 `database/migrations/`。
- 已有迁移 `0000_clever_kang.sql`：建 `users / households / guardian_links / mentor_assignments / audit_logs / outbox`。
- 已有迁移 `0001_cheerful_colossus.sql`：建 `idempotency_keys` 并补充 `outbox.last_error`；业务服务尚未接入持久化幂等和 outbox 发布。
- 已有确定性种子 `database/seeds/demo-identities.sql`，可重复执行且幂等。
- `services/api` 的 `DatabaseModule` 在 `DATABASE_URL` 未设置时**不报错**，提供 `null`，
  业务继续走内存引擎；设置后走 Postgres。
- `DirectoryService` 同时实现内存引擎与 Postgres 引擎，两者输出形状一致。

## 决策

1. **初始化分两档，显式区分，绝不隐式混用**：
   - `demo`：迁移 + 确定性种子。用于本地开发、联调、演示。
   - `live`：只跑迁移，不灌任何演示账号。用于预发与生产。
2. **迁移与种子是两个独立命令**。迁移属于 schema，种子属于数据。
   生产部署只允许执行迁移；种子脚本必须由人显式调用，不允许挂在启动流程里。
3. **demo 数据必须幂等且可自我纠正**：
   - `users` 冲突时 `DO UPDATE`（身份与口令是固定 fixture，必须与文档一致）；
   - `guardian_links` / `mentor_assignments` 冲突时 `DO NOTHING`（运行期关系，不得复活）。
4. **引擎由配置决定，不由代码分支决定**：`DATABASE_URL` 存在即 Postgres，否则内存。
   内存引擎是演示/无库降级，不是第二套业务逻辑；两者语义必须一致，改动其中一个必须同步另一个。
5. **演示凭据是公开 fixture，不是秘密**：可以写入仓库与文档，但必须满足：
   - 口令只用于本地/演示库；
   - 正式库上线前必须重置为带盐 KDF（scrypt/argon2），当前 `sha256(明文)` 仅作为 Stage 2 平滑过渡。
6. **禁止把演示数据带进 live**：`live` 初始化不执行 `pnpm seed`，且种子脚本对非本地库需显式二次确认（见 `docs/shared/INITIALIZATION.md` 的护栏）。

## 后果

**正面**

- 新环境初始化 = `createdb` + 迁移 + （可选）种子，命令确定、可脚本化。
- 演示账号与代码严格一致，避免「登录一直 401 又查不出原因」。
- demo 与 live 的边界是可审计的：只要 CI 检查「生产流水线不调用 seed」即可。

**负面 / 风险**

- 幂等种子需要维护语义表（哪些 `DO UPDATE`、哪些 `DO NOTHING`），新表加入时必须更新说明。
- 内存引擎与 Postgres 引擎有漂移风险；当前靠「同一份种子数据 + 输出形状测试」约束，尚未有自动一致性测试。
- `sha256(明文)` 口令方案在切到查库校验前不能上线真实用户（见「未决事项」）。

## 落地步骤

1. 保留 `database/migrations/` 作为唯一迁移真源；`packages/database` 用 `drizzle-kit generate` 生成。
2. `packages/database/src/seed.ts` 只读取并执行 `database/seeds/demo-identities.sql`，不在 TS 里另写一份数据。
3. `docs/shared/INITIALIZATION.md` 给出 demo 与 live 两套命令、空态行为与验收。
4. CI 增加一步：对空库重放全部迁移；再连跑两次种子，第二次必须无新增。

## 明确不做

- 不在应用启动时自动建表或自动灌种子。
- 不把演示凭据（哪怕哈希）用于真实用户。
- 不允许业务模块自行连接数据库或绕过 `withTransaction()`。

## 未决事项

- [ ] 正式凭据 KDF（scrypt/argon2）与迁移脚本，尚未实现。
- [ ] `DATABASE_URL` 已设置但库不可达时的降级策略尚未定稿：当前会保留非空 client，
      查询在运行时报错，不会回退内存引擎。需要决定「启动即 fail-fast」还是「显式降级」。
- [ ] 内存引擎与 Postgres 引擎的一致性测试尚未编写。
