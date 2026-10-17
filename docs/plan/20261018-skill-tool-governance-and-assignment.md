# 技能/工具治理与助手分配架构实施任务

> 状态：`P0 已完成待评审合入（P0-1 工作树既有；P0-3/4/5 本轮实现并通过测试；P0-2 已撑销）。P2-a 提前完成。P1 待评审`
> 评审基线：2026-10-18
> 责任域：`platform-registry` / `ai-tutor` / `team-runtime` / `admin-console` / `contracts` / `database`
> 关联 Issue：[#57](https://github.com/Jack-Liu0227/qitu-zhixue/issues/57)（Admin AI 配置中心：Skills/工具/MCP 治理）· [#50](https://github.com/Jack-Liu0227/qitu-zhixue/issues/50)（插件框架与工具授权审计）· [#53](https://github.com/Jack-Liu0227/qitu-zhixue/issues/53)（Agent SDK 运行时解析与工具执行）· [#54](https://github.com/Jack-Liu0227/qitu-zhixue/issues/54)（PBL 模板与团队绑定）
> 上级基线：[`../../AGENTS.md`](../../AGENTS.md)、[`../README.md`](../README.md)、[`../admin/platform-governance.md`](../admin/platform-governance.md)、[`../design/pbl-template-team-binding-architecture.md`](../design/pbl-template-team-binding-architecture.md)

本文是需求拆解和验收台账，不把未完成的代码描述成已交付能力。每一项合入 `main` 前必须逐项满足验收条件并同步状态。

---

## 1. 需求边界

产品负责人确认的三条硬约束：

1. **只有管理员可以创建和管理** Skill、AI 助手、团队、MCP、工具。
2. **教师端、学生端、家长端只具备「使用」能力**——与分配给自己的 AI 助手或团队对话，不得自选、不得管理。
3. 三个决定：`stage` **拆列**（不用 jsonb 数组）；项目**模板化，运行期不保留标题正则**；分配层**覆盖三端**。

派生的工程约束：

- 管理员是运营人员，**不能要求其走 git PR**，因此 Skill 权威源必须是「git builtin + 后台 admin」双源。
- 库里**没有班级实体**（只有 `schools` + `users.schoolId`），灰度维度改用 `mentor_assignments`（班主任），该表已用 partial unique index 强制「一个学生同一时间只能有一个当前班主任」（`packages/database/src/schema/identity.ts:88-92`），解析天然唯一。新建 `classes` 属导航/信息架构变更，须先改产品文档评审，**不在本计划范围**。

---

## 2. 现状核实（2026-10-18，逐条带证据）

### 2.1 四层存储，三处断裂

| 层 | 定义存哪 | 绑定存哪 | 消费方 |
| --- | --- | --- | --- |
| 开发期 pi | `.pi/agents/*.md`、`.pi/skills/*`、`.pi/extensions/` | `.pi/settings.json`（strict modelScope） | pi harness |
| 产品 runtime | Skill = `.agents/skills/<id>/SKILL.md`（`runtime-source.ts:52,79`）；Tool = 硬编码常量（`built-in-tools.ts:15-124`，同 6 个 id 写两遍） | `agent_skill_bindings` / `agent_tool_bindings` / `runtime_mcp_servers` / `agent_mcp_bindings`（裸 text id，无 FK、无主表） | `platform-registry` → `qitu-sdk` / `tutor.service` |
| Admin 前端 | 原为 `CORE_SKILLS_CATALOG` + localStorage（**已修**，见 2.4） | `persistAssistantBinding` → 真 API | 管理员浏览器 |
| 上游 deeptutor | `services/knowledge/`（**整个目录 `.gitignore:86`，`git ls-files` = 0**）内含 skill hub 1062 行、taxonomy、credentials、sandbox 1292 行 | 自有 workspace/hub | **无人调用**（`bridge.py:29-34` 只 import embedding + RAGService + llamaindex.config） |

### 2.2 已核实的真实缺陷

| # | 缺陷 | 证据 |
| --- | --- | --- |
| D1 | `admin_assistants.enabledSkills` 是**死字段**：运行期从不消费。其内置值为 `'guided'`/`'hint'`/`'physics-inquiry'` 等虚构 id，与磁盘目录名不匹配 | 写入面 `assistant-registry.ts:32-358`、`platform-registry.service.ts:132,685,744,795,822`；运行期只读 `agent_configs` + `agent_skill_bindings`（`platform-registry.service.ts:399-425`） |
| D2 | 后台技能页的绑定动作写的正是 D1 的死字段 → 管理员打勾不生效 | `settings/skills/page.tsx:178,241,273` |
| D3 | `enabledSkills` / `toolIds` **无存在性校验**，虚构 id 可直接入库；而 agent 路径却会抛「未知的 Skill」——两条写路径校验不一致 | `admin-ai-config.validation.ts:260` vs `platform-registry.service.ts:505-512` |
| D4 | 开发期 skill 与教学 skill 同一发现根，管理员一绑定即注入中学生 prompt | `.agents/skills/web-ui-screenshot-capture/`（截图爬虫工具）与 `tutor-guided-learning` 并列 |
| D5 | skill 发现失败**静默**：`catch { return [] }` 让「目录缺失」与「合法零技能」不可区分 | `runtime-source.ts:80,99` |
| D6 | 每次 `getSnapshot`/`getAgentRuntime`/服务构造都**同步阻塞** readdir+readFile 全部技能，无缓存 | `runtime-source.ts:35-53`；调用点 `platform-registry.service.ts:261,317,504` |
| D7 | Tool 只有 descriptor 无执行点：`toolCalls: []` 恒空 → `riskLevel`/`requiresTheoryMastered` 形同装饰 | `qitu-sdk.service.ts:119`；`built-in-tools.ts` 全部 `execution:'server_owned'` 无 handler |
| D8 | 模板 ↔ 团队绑定**只存在于 seed 注释**，无列无表无外键 | `database/seeds/domain-foundation.sql:29-32`（`template-thunder-fighter <-> pbl-thunder-fighter`）；`project_templates` 缺 `defaultLinkedTeamId`（设计文档 `pbl-template-team-binding-architecture.md` 已定义该字段） |
| D9 | `ProjectStage`(10 值) ↔ `pbl_phase`(4 值) 映射是硬编码 if-else，且混用第三套 legacy 命名 `'theory'|'practice'|'review'` | `platform-registry.service.ts:84-87` |
| D10 | 助手路由靠**项目标题正则**，管理员创建的助手三端永远用不到 | `platform-registry.service.ts:62-87` |
| D11 | `getSnapshot()` 返回 skill `content` 全量 + policy 全文，仅靠 `requireRole(admin)` 一道门，契约层无隔离 | `platform-registry.service.ts:285-306`；`platform-registry.controller.ts:29-33` |
| **D12** | ★ 评审新发现：**Team Runtime worker 有第二个 skill loader**，不解析 frontmatter、无 `runtime:` 过滤、`readBounded` 连 frontmatter 一起注入，且默认扫描根**包含 `.pi/skills`** | `services/workers/src/team-runtime-executor.ts:279-306,317-323`；进 prompt 于 `:114`。直接违反 `docs/admin/deployment.md:300-303`「`.pi/skills/` 是开发期制品，不当作运行时可执行配置注册表」；`tooling/sync-study-remote.sh:23-36` 白名单含整个 `.pi`，会把它物理复制到生产机 |
| **D13** | ★ 修 D12 时引入又修掉的**截断顺序缺陷**：先按 prompt 预算截断再剔 frontmatter，使超长 frontmatter 被截在半路（无闭合 `---`）→ 正则不匹配 → **`dev-only` 过滤完全失效，且 4000 字 frontmatter 原文被当教学规则注入** | 已实测复现：`runtime` 解析为 `undefined`、过滤不触发、注入内容以 `---\nname: 开发工具\ndescription: xxx` 开头。修法：按内存上限（256KB）读全文 → 解析/剔除 frontmatter → 再按 `MAX_SKILL_CHARS` 截正文；并对「有开头 `---` 但无闭合」fail-closed |

### 2.3 已撤销的错误判断（留档以免重复踩）

- ~~「学生对话链路 skill 注入恒为空」~~ **结论对、理由错**。经评审纠正：`buildTutorRuntimeBlocks(runtime, [])`（`tutor.service.ts:269`）的 `[]` 使 `allowed = new Set([])`，因而该路径**不注入任何 skill**（只剩 policy 块）——我原先写的「只过滤未按 agent 绑定的 skill」是错的，它过滤全部。也就是说路径 A 的 skill 注入实际是**死代码**（除非传 `undefined`）。
- skill 全部经**路径 B** 到达学生：`tutor.service.ts:995-1000` 填 `contextPacket.runtime.skills`（来自 `getAgentRuntime()`，已按 `agent_skill_bindings` 过滤）→ `packages/ai-client/src/context-packet.ts:11` 序列化进 system prompt。migration `0015_agent_runtime_bindings.sql:71-75` 已 seed `('qitu-learning-partner','tutor-guided-learning')`，与磁盘目录名匹配，故教学 skill 确实到达学生。
- 结论修正：真正的问题是 **D1/D2（绑定写错命名空间）**，不是注入链路为空。

### 2.4 P2-a 实测出的上游间接耦合（修正第 9 节的边界表述）

原以为「bridge 只 import 4 个模块」等于「运行时只加载 4 个模块」。**实测不成立**：

- 隔离运行边界测试 → 失败：`deeptutor.tools` 已被加载
- 直接测量生产路径（build/search 跑完）→ `sys.modules` 中确切多出 5 个：`deeptutor.tools`、`deeptutor.tools.builtin`、`deeptutor.tools.builtin_specs`、`deeptutor.tools.prompting`、`deeptutor.tools.question_bank`
- 导入 `RAGService` 本身只新增 15 个模块且不含 tools → 耦合发生在更深的 pipeline 构造链

因此边界改为**三层策略**，而不是一个平面禁用名单：

| 层 | 约束 | 强制方式 |
| --- | --- | --- |
| 适配器源码 | `bridge.py` 不得引用 `services.skill`/`tools`/`services.sandbox`/`api` | AST 白名单（`test_bridge.py`）+ `verify-knowledge-upstream.mjs` |
| 运行时硬禁 | `deeptutor.services.skill.*`、`deeptutor.services.sandbox.*`、`deeptutor.api.*` 绝不得出现在 `sys.modules` | 零容忍断言 |
| 上游间接耦合 | 上述 5 个 `deeptutor.tools.*` **钉死清单**；上游升级若使其增长即失败 | 子集断言 |

踩过的坑（留档）：运行时断言**不得**预先 `del sys.modules`。前一个用例已缓存 RAG import 链时，预先删除会让本测试**假绿**（全文件顺序通过、隔离运行失败）。最终实现改为断言 `sys.modules` 的**绝对状态**，两种顺序均通过。

### 2.5 本轮发现的存量债务（不属本轮改动，留待后续）

- `pnpm typecheck` 在 `@qitu/auth` 失败：`packages/auth/src/index.tsx(15,25) TS2580 Cannot find name 'process'`。该文件**未被任何人改动**（`git status` 为空），`tsconfig.base.json` 的 `lib` 无 Node 类型 → 既有仓库问题，与本轮无关
- `assistant-registry.ts` 的 `toolIds` 仍为虚构 id（`mastery_query`/`code_syntax_check`/`artifact_review` 等 13 处），与 `builtinToolRegistry` 的 6 个真实 id 无一匹配。本轮**故意未改**：映射关系（如 `mastery_query` → `tutor.mastery_gate`？）是产品语义决定，不应机械猜测。现由 `danglingBindings` 暴露，待 P1-b 合并工具注册表时一并收口
- `QITU_KNOWLEDGE_PYTHON` 被 `knowledge-engine.service.ts:90` 读取，但 `.env.example` 无该条目（本轮未改 env 文件）
- `services/knowledge/` 仍无安装脚本；pin 已可校验，但安装步骤与期望 checksum 尚未入库

### 2.6 P0-3 实现中发现并修正的一处回归

技能目录存在但缺 `SKILL.md` 时，若直接把它从发现结果里剔除，管理面就看不见「哪个技能包坏了」——这与 D5 要消除的静默失败同类。最终行为定为：**保留一条 `status:'unavailable'` 记录**（管理面可定位），同时把原因写入 `skillsSource.detail` 并令 `status='unreadable'`（健康检查可告警）。两个信号都不丢。

### 2.7 已完成项（工作树，未提交）

- **P0-1**：`settings/skills/page.tsx` 重写 `-882/+121`，删除 `CORE_SKILLS_CATALOG` 与全部 localStorage 写入，改读 `fetchRuntimeSnapshot()`；`settings/tools/page.tsx` 的 localStorage 亦已清除。符合 `platform-governance.md:62`「只写浏览器存储不算完成接入」。
- 遗留：绑定动作仍写 D1 死字段，须由 P1-c-3 收口。

---

## 3. 目标架构

```
╔═ L0 权威源（双源）══════════════════════════════════════════════════════════╗
║ A builtin: git  skills/builtin/<id>/{SKILL.md,references/,scripts/}          ║
║                 tools/builtin/<id>.ts（descriptor+handler 单一数组）          ║
║                 frontmatter runtime: teaching|dev-only（dev-only 不进 runtime）║
║                 → CI 发布门 → seed 进 L2，source='builtin'，不可删            ║
║ B admin:   DB   管理员创作 skill 正文 / MCP / 助手 / 团队 / 模板绑定 / 分配    ║
║ ✗ 管理员不走 git PR   ✗ 不能上传可执行脚本（要执行走 P2-b sandbox）           ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
                                ▼
╔═ L2 目录与版本 ════════════════════════════════════════════════════════════╗
║ runtime_skills / runtime_skill_versions（draft→published→archived，可回滚）   ║
║ runtime_tools（kind: builtin|mcp|declarative, risk_level, handler_ref）       ║
║ runtime_mcp_servers（现状保留）                                              ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
                                ▼
╔═ L3 绑定（能力 ↔ 助手/Agent）══════════════════════════════════════════════╗
║ agent_skill_bindings / agent_tool_bindings（加 FK + version）                ║
║ admin_assistants.enabledSkills|toolIds|mcpServerIds（收口 D1，补存在性校验）  ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
                                ▼
╔═ L3.5 教学编排（补 D8/D9，接通已有数据）═══════════════════════════════════╗
║ project_templates ──template_team_bindings──► admin_teams.pbl_spec            ║
║                                                    └ phases[pblPhase]         ║
║                                                        .assignedAssistantId   ║
║ ProjectStage ──PROJECT_STAGE_TO_PBL_PHASE(契约常量)──► PblPhase                ║
║ admin_team_members.pbl_phase（已存在，作为交叉校验）                           ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
                                ▼
╔═ L3.6 分配（补 D10：谁能用）═══════════════════════════════════════════════╗
║ assistant_assignments(subject_type, subject_id, stage 拆列, target_type,       ║
║                       assistant_id|team_id, priority, enabled, valid_*,        ║
║                       source:'admin|seed')                                     ║
║ 阶梯 student 1000 > mentor 800 > school 600 > project_template 400             ║
║      > stage 200 > global 100 > fallback_default                              ║
║ assistant_resolution_logs（三端留痕 + shadow divergence）                      ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
                                ▼
╔═ L4 解析与执行（服务端内部，唯一装配点）═══════════════════════════════════╗
║ AssignmentResolver → SkillResolver（manifest+always+按需正文，hash LRU 缓存）  ║
║                    → ToolExecutorRegistry（id@version → 真 handler + 门禁重校验）║
║ 铁律：assistantId 解析一次，四个下游共用同一变量                              ║
║ 目录缺失 = 健康检查 failed + 审计，绝不 catch→[]                              ║
╚═══════════════════════════════╤════════════════════════════════════════════╝
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
╔═ L5a 管理面（admin only）═══════════╗  ╔═ L5b 使用面（三端，只对话）════════╗
║ 技能/工具/MCP/助手/团队 CRUD         ║  ║ student：自己的项目 → 分配的助手   ║
║ 模板↔团队绑定矩阵                    ║  ║ teacher：mentor_assignments 关联   ║
║ 分配矩阵 + 灰度 + 影响面预览         ║  ║         的学生 → 同一助手只读投影  ║
║ 发布·回滚·归档                       ║  ║ parent ：guardian_links 关联       ║
║ 契约 AdminRuntimeSnapshot            ║  ║ ✗ 不可自选助手                    ║
║ scope admin.* + 幂等键 + 审计 ✓现状  ║  ║ 契约 PublicAssistantProjection     ║
║                                      ║  ║ ✗ 无正文/prompt/tool描述符/risk    ║
║                                      ║  ║ ✗ 对象级未命中 → 404 不泄漏存在性  ║
╚═════════════════════════════════════╝  ╚════════════════════════════════════╝
              └──────────────────┬───────────────────┘
                                 ▼
╔═ L6 审计 ══════════════════════════════════════════════════════════════════╗
║ agent_tool_calls → 填 toolCalls[]（修 D7）                                   ║
║ assistant_resolution_logs → 谁在何时为何拿到哪个助手（三端）                  ║
║ audit_logs: create/update/publish/rollback/archive/delete/bind/assign/revoke  ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

---

## 4. 数据模型

### 4.1 `template_team_bindings`（修 D8）

把 `domain-foundation.sql:29-32` 的注释约定升为一等公民关系，补齐设计文档中一直缺失的 `PblTemplate.defaultLinkedTeamId`。

```ts
export const templateTeamBindings = pgTable('template_team_bindings', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull()
    .references(() => projectTemplates.id, { onDelete: 'restrict' }),
  teamId: text('team_id').notNull()
    .references(() => adminTeams.id, { onDelete: 'restrict' }),
  /** null = 对该模板所有版本生效；否则只对该冻结版本生效 */
  templateVersionId: text('template_version_id')
    .references(() => projectTemplateVersions.id, { onDelete: 'restrict' }),
  enabled: boolean('enabled').notNull().default(true),
  source: text('source').notNull().default('admin'),   // Server-owned: 'admin' | 'seed'
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // HARD CONSTRAINT: 一个模板在生效期内只能绑定一个启用团队，否则阶段→助手解析不唯一
  oneActiveTeamPerTemplate: uniqueIndex('template_team_bindings_one_active_uq')
    .on(table.templateId, table.templateVersionId)
    .where(sql`${table.enabled} = true`),
  teamIdx: index('template_team_bindings_team_idx').on(table.teamId),
}));
```

Seed（等价替换注释约定）：`template-thunder-fighter → team-thunder-fighter-pbl`、`template-kinetic-energy → team-kinetic-energy-pbl`。

### 4.2 `PROJECT_STAGE_TO_PBL_PHASE`（修 D9，**契约常量，不进 DB**）

理由：`ProjectStage` 是冻结契约（改动要动四端 UI 与状态机），`PblPhase` 是 `pbl_spec` 结构字段，两端都不是运营可调项。放进 DB 只会让「管理员误改一行 → 全校学生导师错乱」成为可能。服务端启动时校验：每个 `PblPhase` 至少被一个 `ProjectStage` 映射，且 `pbl_spec.phases` 覆盖全部 `PblPhase`。

```ts
export type PblPhase = 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review';

export const PROJECT_STAGE_TO_PBL_PHASE: Readonly<Record<ProjectStage, PblPhase>> = Object.freeze({
  exploration: 'exploration',       intent_confirmed: 'exploration',
  theory_learning: 'concept_mastery', theory_check: 'concept_mastery',
  practice_ready: 'guided_practice',  practice_building: 'guided_practice',
  artifact_review: 'deliverable_review', reflection: 'deliverable_review',
  published: 'deliverable_review',  completed: 'deliverable_review',
});
```

同时消灭 `platform-registry.service.ts:84-87` 的第三套 legacy 命名。

### 4.3 `assistant_assignments`（修 D10，`stage` 拆列）

```ts
export const assistantAssignments = pgTable('assistant_assignments', {
  id: text('id').primaryKey(),
  /** 'student'|'mentor'|'school'|'project_template'|'stage'|'global' */
  subjectType: text('subject_type').notNull(),
  /** global 固定 '*'；student/mentor=用户id；school=校id；project_template=模板id；stage=ProjectStage */
  subjectId: text('subject_id').notNull().default('*'),
  /** 拆列：null = 不限阶段；否则精确匹配一个 ProjectStage */
  stage: text('stage'),
  targetType: text('target_type').notNull().default('assistant'),  // 'assistant' | 'team'
  assistantId: text('assistant_id').references(() => adminAssistants.id, { onDelete: 'restrict' }),
  teamId: text('team_id').references(() => adminTeams.id, { onDelete: 'restrict' }),
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  source: text('source').notNull().default('admin'),   // Server-owned: 'admin' | 'seed'
  reason: text('reason'),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedCount: integer('resolved_count').notNull().default(0),       // Server-owned
  lastResolvedAt: timestamp('last_resolved_at', { withTimezone: true }) // Server-owned
}, (table) => ({
  oneActivePerSubjectStage: uniqueIndex('assistant_assignments_one_active_uq')
    .on(table.subjectType, table.subjectId, table.stage, table.targetType)
    .where(sql`${table.enabled} = true`),
  // stage IS NULL 时 Postgres 唯一索引中 NULL 互不相等，需第二条 partial index
  // （与 project_templates 的双 partial index 同一手法，见 project-templates.ts:66-75）
  oneActiveStageless: uniqueIndex('assistant_assignments_one_active_stageless_uq')
    .on(table.subjectType, table.subjectId, table.targetType)
    .where(sql`${table.enabled} = true AND ${table.stage} is null`),
  assistantIdx: index('assistant_assignments_assistant_idx').on(table.assistantId),
  teamIdx: index('assistant_assignments_team_idx').on(table.teamId),
  lookupIdx: index('assistant_assignments_lookup_idx')
    .on(table.subjectType, table.subjectId, table.stage, table.enabled),
  validityIdx: index('assistant_assignments_validity_idx').on(table.validFrom, table.validUntil),
}));
```

specificity：`student 1000 > mentor 800 > school 600 > project_template 400 > stage 200 > global 100`。

### 4.4 `assistant_resolution_logs`（三端留痕）

字段：`requestId / actorId / actorRole('student'|'teacher'|'parent') / targetStudentId / relationRef`（mentor_assignment 或 guardian_link id，学生为 null）`/ schoolId / projectId / projectStage / templateId / pblPhase / targetType / resolvedAssistantId / resolvedTeamId / assignmentId / resolutionSource / mode / at`。

`resolutionSource` 取值：命中的 specificity 层名 | `template_team_binding` | `fallback_default` | `fail_closed`。

**写量控制**：`mode='shadow'` 全量；`mode='on'` 只写 `resolutionSource NOT IN ('project_template','global')` 的异常行 + 按 `requestId` 采样 1%；保留 30 天，由 `services/workers` 清理。

### 4.5 `runtime_skills` / `runtime_skill_versions` / `runtime_tools` / `agent_tool_calls`（P1-b、P1-d）

- `runtime_skills(id, source:'builtin|admin', current_version, status, always_inject, budget_chars, updated_by, ...)`
- `runtime_skill_versions(skill_id, version, content_hash, body, published_by, published_at)` —— **追加式不可变**；状态机 `draft → published → archived`；回滚 = 把 `current_version` 指回旧版（不删行）
- `runtime_tools(id, version, kind:'builtin|mcp|declarative', risk_level, requires_theory_mastered, handler_ref, param_schema, status)` —— 合并 `built-in-tools.ts:15-124` 的两份重复数组为单一来源 + 派生视图
- `agent_tool_calls(request_id, agent_id, tool_id, tool_version, args_hash, decision, gate_refs, evidence_refs, actor, at)` —— 填 `toolCalls[]`（修 D7）

### 4.6 管理员创建权边界

| 对象 | 可以 | 不可以 |
| --- | --- | --- |
| Skill | 创建/编辑正文/发布/回滚/归档/删除（`source='admin'`）、绑定给助手 | 改 builtin 正文（只能派生新版本覆盖） |
| Skill 脚本 | — | **上传可执行脚本**（= RCE；要执行走 P2-b sandbox） |
| MCP 工具 | 注册 server / 探测 / 勾选 allowed tools / 启停 | 写 tool 实现 |
| 内置工具 | 启停、绑定、配 `param_schema` 内参数 | **创建新 handler**（handler 是代码；否则重演 D7 假工具） |
| 声明式工具 | 创建 prompt 型工具（无代码执行 + 服务端只读查询） | 任何写操作、任何未成年人数据写入 |
| 助手 | 全生命周期 + 模型选择 + 绑定能力 | 绕过 `TheoryMastered` 硬门禁（`admin-ai-config.ts:14-17` 服务端硬编码，保持） |
| 团队 | CRUD + 成员 + 分配 | 让子 Agent 默认继承 Tool/MCP（`platform-governance.md:39`） |
| 分配 | 按 student/mentor/school/template/stage 分配 + 灰度 + 有效期 | 让学生自选 |

---

## 5. 解析链路（8 步）

```
三端任一入口（只带 actorId + projectId，✗ 不带 assistantId）
① 对象级鉴权（复用 team-runtime.service.ts:1646-1673 惯例）
   student → assertStudentScope；teacher → mentor_assignments(status='active')；
   parent  → guardian_links/households；未命中 → 404（不泄漏存在性），记 relationRef
② projects.template_version_id → project_template_versions.template_id = templateId
   projects.status = ProjectStage；template_version_id IS NULL（自由探索）→ templateId=null
③ pblPhase = PROJECT_STAGE_TO_PBL_PHASE[projectStage]
④ 一次 SQL 查全部层级候选：subject ∈ {student, mentor, school, project_template, stage, global}
   AND enabled AND stage IN (NULL, projectStage) AND 在有效期内
⑤ 排序（确定性，不允许平手随机）：specificity DESC → priority DESC → updated_at DESC → id ASC
⑥ 逐条验证目标可用（fail-closed）：
   team      → team.enabled ∧ pbl_spec.phases[pblPhase].assignedAssistantId 存在 ∧ 该助手 enabled
   assistant → assistant.enabled ∧ capabilities 含所需能力
⑦ 全未命中 → 'fallback_default'（global seed 行）；仍不可用 → 'fail_closed' 抛 AGENT_ROLE_DISABLED
⑧ 写 assistant_resolution_logs + 异步 bump resolvedCount/lastResolvedAt
   ▼
{ assistantId, teamId, pblPhase, assignmentId, resolutionSource }
   ├──► projectKnowledge.search(...)  tutor.service.ts:977  ← 同一变量
   ├──► projectKnowledge.tools(...)   tutor.service.ts:980  ← 同一变量
   ├──► imaSettings.canCall(...)      tutor.service.ts:919  ← 同一变量
   └──► getAgentRuntime(...).skills → contextPacket.runtime.skills（:995-1000）
```

**铁律**：`assistantId` 是三个授权面的键（项目知识库检索、知识工具、ima MCP）。⑥ 之后四个下游**必须共用同一变量**，任何一处二次计算（现状 `:919` 与 `:976` 各算一次）都是授权错位事故源。

**不得破坏的既有规则**：项目内 MCP `toolIds` 清空（`tutor.service.ts:985`）；`capabilities` 不含 teach 抛 `AGENT_CAPABILITY_DISABLED`（`:1001`）；助手禁用抛 `AGENT_ROLE_DISABLED`（`:948`）。

---

## 6. 契约隔离（修 D11）

`packages/contracts` 拆两个类型，让编译期就拦住泄漏：

| 字段 | `AdminRuntimeSnapshot` | `PublicAssistantProjection` |
| --- | --- | --- |
| name / avatar / description / 能力标签 / 在线状态 | ✓ | ✓ |
| instructions（系统提示）、skill 正文、policy 全文 | ✓ | ✗ |
| tool descriptor、riskLevel、门禁字段 | ✓ | ✗ |
| model provider / modelId | ✓ | ✗（最多给「响应快/慢」粗粒度） |
| MCP endpoint、绑定与分配关系 | ✓ | ✗（只给结果：你能用哪个） |
| toolCalls 明细 | ✓（审计查询） | △（只给人话摘要，如「已查阅教材」） |

现状 `requireRole(admin)` + 幂等键已到位（`platform-registry.controller.ts:29-78`）；三端目前**零引用** ai-runtime/snapshot API，使用面干净，无历史包袱。

---

## 7. 数据迁移

`tooling/backfill-project-templates.mjs`（一次性；正则活在这里，运行期不再有）：

1. 读现有标题正则（`platform-registry.service.ts:66-67`）：`/动能|物理|小车|kinetic|physics/i → template-kinetic-energy`；`/雷霆|战机|pygame|飞行射击|python.*游戏/i → template-thunder-fighter`
2. 扫 `projects WHERE template_version_id IS NULL`：命中则绑定对应 `ptv-*-v1`；未命中保持 NULL（合法：真自由探索）
3. 输出报告（命中数 / 未命中数 / 每条 title→template 决策）供人工抽检
4. 幂等：只处理 `IS NULL` 行，可重复执行

### 7.1 一处**有意的行为变更**（需产品签字）

| 场景 | 现在（正则） | 模板化后 |
| --- | --- | --- |
| 自由探索项目标题「动能小车探究」且 `template_version_id IS NULL` | 命中正则 → `kinetic-concept-coach` 等专属导师 | 落 stage/global 分配 → `qitu-intake-assistant` |

立场：这符合 `AGENTS.md`「学生未确认意图时不得创建正式项目」——专属导师应来自**确认意图时选定的模板**，而非标题关键词猜测。存量由第 2 步回填消除差异；增量按新规则。shadow 期该场景会被记为 divergence，属**预期内**，需在翻转前单独白名单化。

---

## 8. 分阶段实施与验收台账

| 阶段 | 内容 | 关键文件 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | skills/tools 页去 localStorage，接真 snapshot | `settings/skills/page.tsx`、`settings/tools/page.tsx` | 列表 = `.agents/skills` 实际内容；无 localStorage 写入 | ✅ 工作树已实现（未提交） |
| ~~P0-2~~ | ~~修对话链路 skill 注入~~ | — | — | ❌ **撤销**（判断错误，见 2.3） |
| P0-3 | dev skill 移出发现根 + `runtime:` 标签过滤 | `runtime-source.ts`、`git mv .agents/skills/web-ui-screenshot-capture .pi/skills/` | 学生 prompt 不含截图工具说明；`tutor-guided-learning` 仍生效 | ✅ 已实现并验证（`runtime-source.test.ts` 6/6，tsc 干净） |
| P0-5 | 发现失败不再静默 | `runtime-source.ts`（`skillsSource` 三态）+ `readChecks()` 新增 `runtime.skills` 检查 | `missing`→`missing`、`unreadable`→`failed`；`operatorRequired:true`、`executeAllowed:false` | ✅ 已实现并验证 |
| P0-4 | 绑定存在性校验 + 脏数据治理 | `assertAssistantReferences`、`admin.ts` 新增 `danglingBindings`、`assistant-registry.ts` 收敛虚构 id、`tooling/report-dangling-assistant-bindings.mjs` | 新引入未知 id → 400；存量脏引用不静默清理，由 snapshot 暴露 | ✅ 已实现并验证 |
| P2-a | deeptutor 边界锁定 + pin 可校验 | `UPSTREAM.md`、`test_bridge.py`、`tooling/verify-knowledge-upstream.mjs`(+test) | 静态 AST 白名单 + 运行时硬禁 + tools 钉死清单；pin 校验退出码 0；checksum 连跑两次一致 | ✅ 已实现并验证（原排期在 P1 之后，因文件零重叠提前并行） |
| P1-a | 契约隔离 | `packages/contracts` | 编译期禁止 skill 正文进三端 DTO | ⏳ |
| P1-b | 技能/工具目录 + 版本表 | `runtime_skills(_versions)`、`runtime_tools`；合并 `built-in-tools.ts` 双数组 | 发布→绑定→回滚全链路可跑 | ⏳ |
| P1-c-1 | stage→phase 契约常量 + 启动校验 | `packages/contracts/src/project.ts` | 10 个 stage 全映射；`pbl_spec` 覆盖全 phase | ⏳ |
| P1-c-2 | `template_team_bindings` + seed | 新 schema + migration + seeds | 两个模板解析出正确团队与阶段助手 | ⏳ |
| P1-c-3 | `assistant_assignments` + `AssignmentResolver` + logs；**收口 D1/D2** | 新 schema + resolver | 单测覆盖 6 层 specificity、tie-break、fail-closed；后台绑定真正生效 | ⏳ |
| P1-c-4 | backfill 存量项目模板 | `tooling/backfill-project-templates.mjs` | 报告人工抽检；幂等可重跑 | ⏳ |
| P1-c-5 | 接线 4 处 + shadow 模式 | `tutor.service.ts:919,926,976-980`、`project-knowledge.controller.ts:35` | shadow ≥7 天 `divergence = 0`（7.1 场景白名单） | ⏳ |
| P1-c-6 | 翻转 `mode=on`，删运行期正则 | `platform-registry.service.ts:62-87` 降级为 fallback | 三端对话正常；三个授权面正常 | ⏳ |
| P1-c-7 | 三端投影 + 教师/家长关联解析 | teacher-workspace / parent-companion 读接口 | 未关联 → 404；关联 → 与学生解析一致 | ⏳ |
| P1-d | 工具执行 + 审计 | `ToolExecutorRegistry`、`agent_tool_calls` | `toolCalls[]` 非空；`requiresTheoryMastered` 在执行点拦截 | ⏳ |
| P1-e | 后台管理面完整化 | skills/tools/模板绑定/分配矩阵 4 页 + 影响面预览 | 建助手→绑模板→分配给一位班主任→该班学生可用 | ⏳ |
| P2-b | sandbox sidecar（**触发后**） | 新服务 + `code-static-check-producer` 对接 | 学生代码作品真跑并写 `code_playable_run_verified` | ⏳ 需独立评审 |

验证命令：`pnpm --filter @qitu/api test`、`pnpm typecheck`、`pnpm lint`、`node tooling/lint-baseline.mjs --workspace`。

### 8.1 灰度与回滚

```
P1-c-1..c-4  建表/常量/seed/backfill      → QITU_ASSISTANT_ASSIGNMENT_MODE=off，零行为变化
P1-c-5       上线 resolver                → mode=shadow，只算只记，仍用正则结果
             观察 ≥7 天：divergence 必须为 0（7.1 场景单独白名单）
P1-c-6       mode=on                      → 保留 fallback_default 兜底
             管理员开始建 source='admin' 分配，先给一位班主任灰度
P1-c-7       三端投影上线
稳定一个版本周期后：删 mode 开关、删 tutorAssistantIdForProject 的运行期调用
```

回滚：`QITU_ASSISTANT_ASSIGNMENT_MODE=off` 即刻回到当前行为，**无需回滚数据库**（seed 行留着无害）。

### 8.2 独立评审轮次（2026-10-18，跨模型家族）

实现用 `jaycue-gpt/gpt-6.1-sol`，评审用 `deepseek/deepseek-flash`（不同家族、无共享上下文）。结论：**无阻塞项**，4 条「重要」全部已修：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| 重要-1 | D12：worker 第二个 loader 绕过 dev-skill 过滤，且默认根含 `.pi/skills`（本轮刚把 dev skill 移进那里） | ✅ `defaultSkillRoots` 去掉 `.pi/skills`（已确认无任何 seed/migration 绑定引用该目录的 id，零破坏）；loader 补 frontmatter 解析 + `dev-only` 过滤 + 剔除 frontmatter 后再注入 |
| 重要-2 | 健康检查拿「目录可读」推导「学生拿得到教学规则」，两个方向都会错报；单个无关坏包会把全局 `overall` 推到 `degraded` | ✅ 改为直接验证 seed 绑定的 `tutor-guided-learning` 是否存在且 `status==='ready'` 且正文非空；单包损坏降为 `brokenPackages` + detail，**不**改变目录级 status；detail 改用相对路径 |
| 重要-3 | `listDanglingAssistantBindings` 用 `catch { return [] }`，把 D5 反模式复制到新监控信号上 | ✅ 改为 `logger.warn` + 返回 `null`（契约已区分 `null`=无法计算 / `[]`=确实干净）；条目新增 `source` 字段，使内置助手存量债务与新增脏引用可分离 |
| 重要-4 | seed 仍写虚构 skill id 且 `ON CONFLICT DO UPDATE` 回放，绕过 API 校验；baseline 豁免使这些值永不可清 | ✅ `database/seeds/admin-ai-config.sql` 12 个助手的 `enabled_skills` 与 `defaults.skills.value` 全部对齐 `assistant-registry.ts`（9 个 `tutor-guided-learning`、3 个 `[]`）；34 个虚构 id 清零；未误碰 `tool_ids`/`mcp`/`pbl_spec` |

建议项处理：

| 编号 | 状态 |
| --- | --- |
| 建议-1（`SERVER_ASSISTANT_DEFAULTS` 与 ai-client 常量分叉） | 部分：已修正漂移的值并加注释标记风险；**跨包去重归 P1-b** |
| 建议-3（`createAssistant` 严格路径无测试） | ✅ 已补；另补 `.find()` 只报首个未知 id 的行为保留（admin-only，可接受） |
| 建议-4（detail 暴露绝对路径） | ✅ 已相对化；中英文案统一归 P1-e |
| 建议-5（Python 测试依赖 `PYTHONPATH`，缺时表现为 Error 而非 skip） | ⏳ 待办：测试内 `sys.path.insert` 或文档写明运行命令 |
| 建议-6（`sync-study-remote.sh` 同步整个 `.pi`，含 gitignore 的 `.pi/runs/`） | ⏳ 待办：改成显式子路径清单 |
| 建议-7（pin 与白名单三处副本） | ⏳ 待办：提取为单一 JSON 数据源 |
| 建议-8（两个 SKILL.md 都没有 `runtime:` 标签，过滤机制零真实覆盖） | ✅ 已补 `runtime: teaching` / `runtime: dev-only`；注释放 **frontmatter 内**（会被 `stripFrontmatter` 整块剥除），放正文会污染学生 prompt |
| 建议-9（policy 读取仍 `catch { return '' }`） | ⏳ 待办：归 P1-b，与 skills 共用一套诊断结构 |
| 建议-2、建议-10（`defaults.skills` 未纳入校验；事务内同步文件 IO = D6） | ⏳ 归 P1-b/P1-d |

验证快照（本轮最终）：`@qitu/api` **827 tests / 0 fail**；`@qitu/workers` **22 tests / 0 fail**；`runtime-source` 6/6；`platform-registry` 26/26；Python 边界 3/3（顺序无关）；`verify-knowledge-upstream` 退出码 0；`contracts`/`ai-client`/`api`/`workers` typecheck 均绿；`lint-baseline --workspace` 通过。唯一遗留失败是既有的 `@qitu/auth src/index.tsx(15,25) TS2580`（文件未被任何人改动）。

---

## 9. deeptutor 边界决策

- **边界已落地为可执行约束（本轮 P2-a）**：分三层强制——适配器源码 AST 白名单 / 运行时硬禁 `services.skill.*`·`services.sandbox.*`·`api.*` / 上游间接加载的 5 个 `deeptutor.tools.*` 钉死清单。实测依据与假绿踩坑记录见 **§2.4**。
- **不接** skill hub 运行时。理由：① `skill/runtime.py:22-45` 依赖 `get_current_user()`/`current_workspace_id()`/`current_resources()` 三套 contextvar 与其 multi_user 授权表，与本项目 tenancy/permissions 阻抗大；② hub install 写 `data/<user>/workspace/skills/` 会形成**第二可写权威源**，而 `services/knowledge/` 全量 gitignore → 无 diff、无评审、不可回滚，违反 `platform-governance.md:62`；③ 授权粒度是 user/workspace，非 school/mentor/student + 对象级；④ 常驻 Python 服务的内存压力（`start-qitu-services.sh` 注释：1.8 GB，7.6 GB 机器 OOM 主因）。
- **移植其设计**（Apache-2.0）：渐进披露（`skill_manifest()` + `always` + 按需 `resolve_runtime_skill`）替代 8000 字符硬截断；四级解析顺序 + shadow 规则映射到 §5 阶梯；CRUD 幂等/冲突语义与 `is_relative_to` 路径穿越防护（`skill/service.py:459-470,563-700`）；taxonomy 用于后台分类导航。
- **P2-b 触发条件**（满足任一即启动）：作品展厅需要「可运行」标记或教师复核需运行证据；管理员创作的 skill 需要带脚本；「自定义工具」需要真执行。接入形态：独立 sidecar（loopback only、独立进程池、资源上限），**只暴露 sandbox**（`ResourceLimits`/`command_blocked`/`mounts`/`artifacts`，`tools/exec_tool.py:173-207`），其余 ~30 个上游工具全禁；技能包仍由 git/DB 发布后加载，hub 不做权威源。目标门禁 `code_playable_run_verified` 的 `source:'runner'` 已在 `PBL_GATE_SOURCE_WHITELIST` 预留（`code-static-check-producer.ts:22-29`）。
- **前置**（两种形态都必须）：`services/knowledge/` 的 pin（现仅 `QITU_PIN` 文本）+ 安装脚本 + 校验和入 git，做到可复现构建。

---

## 10. 开放问题（待产品/架构拍板）

1. **7.1 的行为变更**是否接受（推荐接受 + backfill 存量）。
2. `published` / `completed` 阶段该给哪个导师？当前映射到 `deliverable_review`（评审导师），可选 `exploration`（总导师）或单列一条 global 分配。
3. 家长端是否真需要助手投影？若只需「孩子在和哪位导师学习」一个人话标签，可只下发 `name + avatar`，进一步缩小未成年人数据面。
4. **specificity 排序**：`school 600 > project_template 400` 意味着校级分配会覆盖模板专属团队。建议把 `project_template` 提到 700（教学设计优先于行政范围）——待确认。
