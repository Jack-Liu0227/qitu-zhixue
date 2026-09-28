# ADR 0006：领域模块与表归属

- 状态：**Accepted**
- 日期：2026-09-27
- 范围：表归属、跨模块写入规则、迁移顺序
- 关联：ADR 0002（领域边界与单一写入者）、ADR 0003（数据库访问层）、`docs/DATABASE.md`、`docs/ARCHITECTURE.md`

## 背景

产品包含四个平台与多类 AI/异步能力。ADR 0001 已定「模块化单体 + 异步任务」，
ADR 0002 已定「领域模块是各自数据的单一写入者」。但「哪张表归哪个模块」此前只在
产品文档 8.1 列了表名，没有落成可评审的归属表与迁移顺序，导致并行开发时容易互相写表。

## 决策

1. **每张表只有一个 owner 模块**，owner 是该表唯一的写入者。归属见 `docs/DATABASE.md`
   的「表归属」表；新增表必须先登记归属再建迁移。
2. **跨模块写只能走命令 / 事件 / outbox**，不得直接 `INSERT/UPDATE` 其他模块的表。
3. **迁移顺序按依赖分组推进**：基础设施与身份先行，项目业务表随后，AI/成长/知识库最后。
   具体顺序见 `docs/DATABASE.md` 的「迁移顺序」。
4. **`packages/database/src/schema/**` 是单一写入者资产**：并行开发时只读不写，
   schema 变更由一个角色合并，避免多份 schema 冲突。
5. **`projects` 独占项目状态转换**；`access`（目录/关系）独占对象级授权判定入口；
   `audit` 记录敏感读取与管理变更；`outbox` 保证事务与事件的一致性。
6. **迁移必须与 owner 模块一起评审**：一张表的迁移由它的 owner 模块 reviewer 通过。

## 理由

- 明确归属是「不提前拆微服务」的前提：边界靠约定与评审守住，而不是靠进程隔离。
- 先 identity 后 projects 与 `database/README.md`、产品文档 12 章的阶段划分一致，
  让 M1 的认证/关系可以独立验收。
- 单写者 schema 与 `contract-owner` 的协作规则一致，降低并行冲突。

## 后果

**正面**

- 新模块加入时有明确的登记点，不再出现「两张表都以为自己能写」。
- 迁移评审可以按模块切分，reviewer 只需理解自己领域的表。

**负面 / 风险**

- 模块化单体里没有数据库级隔离，越权直写只有靠评审与测试发现，必要时用 lint/审查规则补强。
- 归属表需要持续维护，否则会与代码漂移。

## 落地步骤

1. 在 `docs/DATABASE.md` 落地表归属与迁移顺序。
2. 每个新模块 PR 必须包含：领域实体、表归属、迁移、权限规则、幂等说明、验收。
3. 未来模板库 / 知识库 / 成长轨迹接入时，先确认它们引用而非复制 owner 模块的数据。

## 已落地：单一学校领域基础层（迁移 0008）

`0008_domain_foundation` 把模板 / 知识 / 计划 / 掌握度 / 成长 / 记忆 / 评审表落为**领域真源**，
并回填 `users.school_id`、`projects.template_version_id` / `exploration_sessions.template_version_id`
外键（均为增量，不改旧表结构）：

- **校域**：`schools`；`school_id` 可空（`NULL` = 平台共享）。
- **模板**：`project_templates`（平台/校域部分唯一 slug）+ `project_template_versions`（冻结版本、rubric）。
- **知识**：`knowledge_documents`（scope `system|school|project|student`）+ `knowledge_chunks`（embedding 暂为 JSONB）。
- **学习计划**：`learning_plans` / `learning_modules` / `learning_objectives` / `learning_sessions`。
- **掌握度**：`mastery_records`（含间隔复习字段）+ `mastery_attempts`。
- **成长与记忆**：`growth_records`（学生/家长双摘要 + 可见性）+ `student_memories`。
- **班主任评审**：`mentor_reviews`。
- **幂等**：`learning_plans` / `growth_records` / `student_memories` / `mentor_reviews` 内联 `idempotency_key` 唯一索引。

**迁移注意**：Postgres 标识符上限 63 字符；长外键名必须用显式短名
（`exploration_sessions_template_version_id_fk` / `learning_plans_template_version_id_fk`），
否则会被静默截断，导致 `.down.sql` 无法准确 `DROP CONSTRAINT`。

**并存关系**：0007 的 `tutor_*` 表仍为 AI 工作区适配层，暂与领域真源并存，
合并/下线需另立迁移（先双写，再切读，最后退役）。详见 `docs/DATABASE.md` §3.2。

**已实现 vs 规划**：以上为**表结构与种子**；service 读写接入、RLS、pgvector 向量列、
间隔复习算法落库均属后续工作。

## 明确不做

- 不提前为每个模块建独立数据库。
- 不把审计、outbox、幂等抽象成通用仓储（各自语义不同）。

## 未决事项

- [ ] `support` 角色、`roles` / `identities` / `sessions` 表尚未建；当前会话在进程内。
- [ ] 是否引入数据库层的 `SET ROLE` 或多租户行级安全（RLS）尚未决定；
      0008 已提供 `school_id` 列，但隔离仍由应用层负责。
- [ ] `tutor_*` 适配层与领域真源的合并/下线顺序。
- [ ] `knowledge_chunks.embedding` 从 JSONB 迁移为 pgvector `vector` 列（维度/索引待定）。
