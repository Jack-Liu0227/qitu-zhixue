# ADR 0003：数据库访问层与迁移工具

- 状态：**Proposed**（待确认；确认后改 Accepted）
- 日期：2026-09-25
- 范围：M1 前置——`packages/database`、`database/migrations/`、`services/api` 持久化接入
- 关联：ADR 0001（第 5 条：PostgreSQL 等通过基础设施边界接入）、ADR 0002（领域边界与单一写入者）、`database/README.md`

## 背景与既定约束

以下不是选项，是仓库已经定下的事实，选型必须服从：

| 来源 | 约束 |
|---|---|
| 产品文档 1.2 / 8.2 | 主数据库 **PostgreSQL**；缓存 Redis；文件走私有对象存储 + 签名 URL；向量检索 **pgvector** |
| `database/README.md` | PostgreSQL 是 system of record；迁移**前置单向（forward-only）SQL + 回滚说明**；迁移由拥有该表的模块**一起评审**；`seeds/` 只放确定性开发数据 |
| `database/README.md` | **M1 先建 identity / household / guardian link / session / audit 迁移，再建项目表** |
| ADR 0001 第 5 条 | 初始化阶段**不绑定具体云厂商** |
| ADR 0002 | 领域模块是各自数据的**单一写入者**；`projects` 独占项目状态转换 |
| `pnpm-workspace.yaml` | pnpm 10 默认**不执行依赖的 postinstall**，`onlyBuiltDependencies` 只白名单了 `@nestjs/core`、`esbuild`、`sharp` |
| 工程约定 | `pnpm typecheck` / `pnpm test` 是每个模块的验证门；多个 agent 并行写代码，**类型必须能自己站住** |

业务侧对持久化层的硬需求（来自学生端设计文档）：

1. **部分唯一索引**：「一个学生同一时间只有一个当前班主任」→
   `CREATE UNIQUE INDEX ... ON mentor_assignments(student_id) WHERE status = 'active'`（产品文档 3.3 已给出 SQL）。
2. **行级锁**：项目状态转换必须事务化（`SELECT ... FOR UPDATE`），且只能经 `projects` 领域。
3. **Outbox**：提交成功后事件可靠投递（产品文档第 1425 行），消费者幂等。
4. **JSONB**：工作台草稿内容、模板阶段数组、context packet、审计 detail。
5. **pgvector**：理论材料检索（`knowledge_chunks`）。
6. **修订号乐观锁**：工作台草稿 `revision` + `If-Match`。
7. **幂等键唯一约束**：`TaskSubmission`、`confirm-intent`、`ArtifactLike`。

## 决策

采用 **Drizzle ORM + drizzle-kit**，驱动 `node-postgres`（`pg`）：

```
packages/database/
├── src/
│   ├── schema/            # 按领域分文件，一个 barrel；唯一 schema 作者
│   │   ├── identity.ts    # users / roles / identities / sessions / households /
│   │   │                  # guardian_links / mentor_assignments
│   │   ├── projects.ts    # project_templates / _versions / projects / _stages / _tasks
│   │   ├── learning.ts    # learning_sessions / learning_events / theory_* / practice_*
│   │   ├── tutor.ts       # tutor_sessions / tutor_turns / context_snapshots
│   │   ├── works.ts       # artifacts / versions / evidence / stats / likes
│   │   ├── ops.ts         # alerts / interventions / notifications / ai_jobs / outbox / audit_logs
│   │   └── index.ts
│   ├── client.ts          # createDb(DATABASE_URL) + withTransaction()
│   └── index.ts
└── drizzle.config.ts      # out: '../database/migrations'
```

- **Schema 代码在 `packages/database`**（可被 `services/api` 直接 import 类型），
- **迁移产物落在 `database/migrations/`**（遵守 `database/README.md` 指定的位置）。
- 两者不冲突：`database/` 是**产物目录**（migrations / seeds / fixtures），`packages/database` 是**代码包**。
- `database/` 未列入 `pnpm-workspace.yaml` 的 globs，因此**不需要改 workspace 配置**。

## 理由

1. **迁移形态与仓库约定完全一致。** `database/README.md` 要求单向 SQL 迁移 + 回滚说明；
   `drizzle-kit generate` 产出的就是可读、可手改、可逐行评审的 `.sql` 文件。
   每个领域的 schema 是一个独立 TS 文件，正好对应「迁移必须与拥有该表的模块一起评审」。
2. **Schema 包不引入生命周期脚本。** Drizzle 是纯 TS，没有 postinstall。
   选 Prisma 必须把 `@prisma/client` / `prisma` 加进 `pnpm-workspace.yaml` 的
   `onlyBuiltDependencies` 白名单（pnpm 10 默认阻止依赖生命周期脚本），
   而该仓库的既有取向是把这个白名单压到最小（目前 3 项）。这是供应链面。
   （注意：`packages/database` **有一个显式 `build` 脚本**把 src 编译到 `dist/`，
   那是**运行时**需要、不是类型需要，详见下方「实施补充 1」；
   它不改变「没有 postinstall、不需要 codegen」这个结论。）
3. **类型不依赖代码生成步骤。** 类型直接从 TS schema 推导，
   `pnpm typecheck` 不需要先跑 `prisma generate`。
   对「多 agent 并行写代码 + typecheck 作为验证门」这点很关键——
   少一个"忘了 generate 导致类型假阳性/假阴性"的失败模式。
4. **上面列的 7 条硬需求几乎全在 raw SQL 一侧。**
   部分唯一索引：schema 的 `uniqueIndex(...).on(...).where(...)` 原生支持；
   `FOR UPDATE`、outbox、幂等键冲突处理、JSONB 路径查询：`sql` 模板直接写且**参数化安全**；
   pgvector：Drizzle 支持 `vector` 列与 HNSW / IVFFlat 索引，
   但**不会自动建扩展**，需 `drizzle-kit generate --custom` 手写一次 `CREATE EXTENSION vector;`。
   Drizzle 在这条路线上的书写成本最低。

## 备选与否决理由

| 方案 | 否决 / 保留理由 |
|---|---|
| **Prisma** | **是合格的备选，不是差方案**：嵌套读 DX 最好、生态最成熟、`prisma.config.ts` 的 `migrations.path`（6.12+）可以写到 `database/migrations/`。否决点只有两条：需要 postinstall（要动 `onlyBuiltDependencies` 白名单），以及 pgvector 仍要 `Unsupported("vector")` + raw SQL，优势在这条路线上不成立。**若团队更看重嵌套读 DX 与 Studio，改选 Prisma 是可接受的。** |
| **TypeORM** | 否决：迁移是 TS 类而非纯 SQL，与 `database/README.md` 的「单向 SQL + 回滚说明」不符；实体装饰器与数据库实际状态易漂移；类型推导弱于前两者。 |
| **Kysely** | 保留为补充而非基座：类型安全的 query builder 很好，但**不含 schema 管理与迁移**，需要额外拼一个迁移工具，装配成本更高。 |
| **裸 `pg` + 手写 SQL** | 对 7 条硬需求都够用，但 schema 与类型要人手维护，在「多 agent 并行 + typecheck 验证」的环境下会把类型错误推到最后。仅作为 Drizzle 之下的逃生通道。 |

## 后果

**正面**

- `database/` 的既有约定（单向 SQL、按模块评审、M1 先 identity 后 projects）原样成立。
- 迁移评审是**读 SQL**，评审者不需要理解 ORM 的抽象。
- 无需改 `pnpm-workspace.yaml`，无新增生命周期脚本。
- `services/api` 的 `common/{access,audit,idempotency,outbox}` 可以在类型化事务上实现。

**负面 / 风险**

- 团队对 Drizzle 的熟悉度大概率低于 Prisma，需要一次 30 分钟的内部走查。
- 嵌套读要显式声明 `relations()`，复杂投影比 Prisma 啰嗦。
- pgvector 扩展的创建是手写迁移，容易在全新环境漏掉 → 需在迁移里写成幂等（`CREATE EXTENSION IF NOT EXISTS vector;`）。
- Schema 是**唯一写入者**资产：`packages/database/src/schema/**` 必须由单一角色写，
  与 `contract-owner` 的「共享文件单写者」规则一致，**并行写入者只读不写**。

## 落地步骤

1. 新建 `packages/database`（package.json / tsconfig / `drizzle.config.ts`），
   依赖 `drizzle-orm`、`pg`；开发依赖 `drizzle-kit`、`@types/pg`。
2. `drizzle.config.ts` 设 `out: '../database/migrations'`，dialect `postgresql`。
3. 写 M1 的第一批迁移，**顺序遵守 `database/README.md`**：
   `CREATE EXTENSION IF NOT EXISTS vector` → identity（users/roles/identities/sessions）→
   households / guardian_links / mentor_assignments（含部分唯一索引）→ audit_logs → outbox。
4. 在 `services/api` 增加 `DatabaseModule` 与 `withTransaction()`，业务模块只经它取 `db`。
5. `database/seeds/` 放确定性开发数据；`database/fixtures/` 放隔离测试 fixture。
6. CI 增加一步：对空库跑全部迁移（验证 forward-only 可重放）。

## 明确不做

- 不让业务模块直接构造连接或绕过 `withTransaction()` 写事务。
- 不使用 ORM 的 schema 自动同步（`push`）作为生产迁移路径——生产只走 `database/migrations/`。
- 不把向量、审计、outbox 的 SQL 抽象成"通用仓储"，它们各自语义不同。
- 不在 M1 建任何项目业务表（遵守 `database/README.md`：identity 先行）。

## 实施补充（2026-09-27）

### 1. 「类型 import」与「运行时 import」是两件事（重要）

ADR 原文写的是「`packages/database` 可被 `services/api` **直接 import 类型**」。
实施时把它当成「可以直接 import」来写，**导致 API 启动即崩**：

```
file:///.../packages/database/src/index.ts:3
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
^^^^^^
SyntaxError: Unexpected token 'export'
```

原因是 `packages/database/package.json` 原本 `exports: "./src/index.ts"`，
而 `services/api` 的构建边界是 `nest start --watch` + `tsconfig` 的
`rootDir: "src"` / `include: ["src/**/*.ts"]` —— **workspace 包的 TS 源码从不参与编译**，
Node 在运行时直接 `require` 到裸 TS，于是 ESM 语法炸掉。

`@qitu/contracts` 用同样的 `exports` 却一直没事，是因为它**只导出类型**，
编译期就被擦除了。这个差别是隐性的，必须在仓库层明确：

> **规则：workspace 包只要导出任何运行时值（函数/对象/常量），
> 就必须构建到 `dist/` 并把 `exports` 指向产物；
> 纯类型的包才可以 `exports` 指向 `src/index.ts`。**

因此 `packages/database` 现在有：

- `tsconfig.build.json`（`module: Node16` → CJS，`outDir: dist`，排除 `src/seed.ts`）
- `package.json` 的 `main` / `types` / `exports` 全部指向 `./dist`，并新增 `build` 脚本
- `turbo.json` 的 `typecheck` 增加 `dependsOn: ["^build"]`，
  保证在干净环境里 `pnpm typecheck` 不会因缺 `dist` 而假失败
- `tooling/start-qitu-services.sh` 在启动 api 前重建该包（`nest --watch`
  只监听 `services/api/src`，不会感知 `dist` 变化，所以重建后必须重启 api）

代价：turbo 会对 `tsc --noEmit` 型 build 任务报
`no output files found` 警告（无害噪声）。

### 2. 迁移与种子落位

- 迁移产物：`database/migrations/0000_clever_kang.sql`（+ 手写 `.down.sql`）。
- 种子真源：`database/seeds/demo-identities.sql`（**唯一一份**），
  由 `packages/database/src/seed.ts` 读取执行，避免 SQL/TS 两份数据漂移。
- 已实测：空库重放迁移 → 连跑两次种子，第二次 `users 9 -> 9`（幂等）。
- `password_hash` 目前存 `sha256(明文)` 十六进制，与现有
  `safePasswordEqual()` 语义等价，便于 Stage 2 平滑切到查库校验；
  **正式用户上线前必须换成带盐 KDF（scrypt/argon2）**。

### 3. 已验证的产品级约束

两个部分唯一索引在真实库中已生效（非仅存在于 schema 代码）：

```sql
CREATE UNIQUE INDEX mentor_assignments_one_active_per_student_idx
  ON mentor_assignments USING btree (student_user_id) WHERE status = 'active';
CREATE UNIQUE INDEX guardian_links_active_unique_idx
  ON guardian_links USING btree (parent_user_id, student_user_id) WHERE status = 'active';
```

重复插入同一学生的 active 班主任会被数据库拒绝，而不是靠应用层自觉。

### 4. 尚未解决的已知不一致（Stage 2 必须先定调）

同一批演示账号的显示名在两处不同，`users` 表目前沿用了 auth 那一版：

| id | `auth.service.ts` | `platform-data.service.ts`（班主任看到的名单） |
|---|---|---|
| `student-demo` | 演示学生 | 小宇 |
| `student-demo-2` | 演示学生二 | 小禾 |
| `student-demo-3` | 演示学生三 | 小满 |
| `student-demo-4` | 演示学生四 | 小舟 |

`apps/teacher-workspace` 还有第三套（`lib/mock-data.ts` 的 `林小宇/五年级`，
`id` 是 `s-001`），且完全没有接 API。
**「数据统一」在 Stage 2 必须选定唯一一套并删掉另外两套**，否则三处仍会各自漂移。

## 待确认

- [ ] 采用 Drizzle（默认建议），还是改用 Prisma？
- [ ] 是否同意 `packages/database` 放 schema 代码、`database/migrations/` 只放迁移产物这一分工？
