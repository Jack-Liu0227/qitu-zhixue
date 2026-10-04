---
name: student-module
description: >
  学生端单模块开发工作流。为一个 student-center 功能模块（today / inspiration /
  tutor-ui / projects / workbench / works）完成规格、合同、实现、接线、QA、评审与有界修复。
  Use when asked to "开发学生端某模块", "实现灵感空间/AI搭档/我的项目/制作工作台/作品展厅",
  "student module", or "学生端功能".
---

> 页面与数据模型基线：`docs/student/projects.md`（由 UI 图片 + 产品文档 4.x 推导）；
> 数据库访问层见 `docs/admin/database.md`。
> 上述文档第 9 节的待定项未答完前，不要开工——品牌名与工作台范围会改变路由与数据模型。

# Student Module

把一个学生端功能模块做成**可构建、可验证、有评审**的代码。

**开场声明：** "我先确认模块范围，然后出规格、补合同、实现模块、接线、跑 QA 和评审；有问题当场问你。"

## 流程

```
Phase 0  定范围   父会话              → brief.json
Phase 1  规格     student-planner      → spec.md
Phase 2  合同     contract-owner       → packages/**（仅当 spec 列出 gap）
Phase 3  实现     student-feature      → features/<module>/**
Phase 4  集成     student-integrator   → app/** + integration-report.md
Phase 5  验证     student-qa           → qa-report.md
Phase 6  评审     student-reviewer     → review.md
Phase 7  修复     归属角色 → 集成 → 全量复验   [有界 ≤2 轮]
Phase 8  交付     父会话              → 路由、状态覆盖、命令与结果
```

父会话拥有全部阶段转换、运行目录和最终交付。所有角色都是叶子（`spawning: false`）。

阶段**串行**，唯一的 fan-out 点是可选的「多模块并行」（见下）。

---

## Runtime

所有角色**默认** `deepseek/deepseek-flash` + `thinking: off`。
`deepseek-flash` 的 `reasoning: false`（未认证 reasoning），传其它 thinking 值会被拒绝。
每次 spawn 仍**显式**传 `model` 与 `thinking`，因为工具参数会覆盖 frontmatter。

| 子代理 | 用途 | 需要升级质量时 |
|---|---|---|
| `student-planner` | 规格 | `deepseek/deepseek-v4-pro` + `high` |
| `contract-owner` | 类型与 barrel | 保持 flash/off |
| `student-feature` | 主实现 | `deepseek/deepseek-v4-pro` + `high` |
| `student-integrator` | 机械接线 | 保持 flash/off |
| `student-qa` | 确定性验证 | 保持 flash/off |
| `student-reviewer` | 只读评审 | `deepseek/deepseek-v4-pro` + `high` |

**升级方式：** 只在该次 spawn 显式传 `model: "deepseek/deepseek-v4-pro"` 与
`thinking: "high"`（或 `"max"`），`deepseek-v4-pro` 的 `reasoning: true` 支持这两档。
不要在 frontmatter 里改默认值。

---

## 确认门

**必须当场问（当轮停下）：**

- 模块范围或交互与冻结导航 / 信息架构冲突；
- spec 里的 P0 需要产品取舍；
- 触碰硬规则：学生未确认意图不得建正式项目、`TheoryMastered` 前不得实践、
  一个学生只能有一个当前班主任、未成年人数据可见范围；
- 两轮修复后仍有 P0。

**不必打断（记录即可）：** 视觉细节、已在 spec 标为待确认且不影响跑通的项。

问法：一次问完，最多 3 条，每条 = 问题 + 为什么重要 + 建议方案。

---

## Fire-and-forget

`subagent` 是即发即忘。每次 spawn 后：

1. 结束父会话当前回合并等待；2. 由自动投递的结果唤醒父会话；3. 从该结果继续。

**不要**轮询、`subagent list` 查状态、sleep、tail session 文件或写等待循环。

---

## 运行目录

取 `YYYY-MM-DD-<slug>`（例如 `.pi/runs/2026-09-25-inspiration-free-explore/`），
**每次子任务都传绝对路径**——子代理没有父会话的记忆。

产物形状见 [`references/contracts.md`](references/contracts.md)。

```
.pi/runs/<run>/
├── brief.json
├── spec.md
├── integration-report.md
├── qa-report.md
└── review.md
```

---

## Phase 0 — 定范围（父会话）

读产品文档中该模块的小节（路由、前端模块、接口、核心规则、验收标准），
然后用**一轮**对话确认：模块、本期做到哪、明确不做什么、验收重点。最多 3 个问题。

写 `brief.json`，并在花任何实现预算前与用户确认。

| module | 产品文档小节 | 冻结导航 | 关键不可违反规则 |
|---|---|---|---|
| `today` | 4.1 今天 | 今天 | 无项目时给灵感空间入口；可继续上次项目 |
| `inspiration` | 4.3 灵感空间 | 灵感空间 | 未确认意图不得创建正式项目；推荐区与自由 Live 区视觉分离 |
| `tutor-ui` | 4.4 AI搭档（文件名 `AI导师.png`） | AI搭档 | 每轮带阶段与提示等级；AI 不能直接改成长档案；升级后班主任端出现待办；6 个能力入口映射 pedagogic move（见设计文档第 6 节）|
| `projects` | 4.5 我的项目 | 我的项目 | `TheoryMastered` 前不得实践；客户端不得改项目状态；提交幂等；阶段名来自模板版本而非全局常量 |
| `workbench` | 4.5 我的项目（`我的项目.png` 制作工作台） | 我的项目 | 草稿 `PATCH` 带 `If-Match: revision`，409 需可恢复；断网强制只读 + 本地暂存，**不得丢草稿**；预览/发布走服务端 |
| `works` | 4.6 作品展厅 | 作品展厅 | 上传走签名 URL；发布/撤回受权限控制；版本留痕；**项目证据三列只读**（服务端聚合，客户端不得写）|

**后端归属：** 学生数据面（`students` / `inspiration` / `projects` / `workbench` / `works` 五个模块）
由 `student-api` 独占写入；`ai-tutor` 归 `tutor-api`，学习计划与掌握度归 `plan-api`。
前置阻塞项见设计文档 5.2（持久化选型、`common/{access,audit,idempotency,outbox}`、对象存储签名 URL）。

## Phase 1 — 规格

```typescript
subagent({
  name: "Spec <module>",
  agent: "student-planner",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Module: <module>.
Read brief.json, the product-doc section for this module, AGENTS.md,
apps/student-center/**, packages/contracts/src/**, packages/api-client/src/**,
packages/ui/src/**, and .pi/skills/student-module/references/contracts.md.
Write spec.md. List every needed API as existing (with path:line) or gap.
Cover loading/empty/error/offline/permission-denied per screen.
Keep the frozen navigation; flag conflicts as P0 instead of redesigning.
Return: run dir, routes, contract gaps, acceptance-criteria count, open questions.`,
});
```

**→ 确认门 A**：spec 与现实冲突、或出现需要产品取舍的 P0 时当场问。

## Phase 2 — 合同（条件执行）

仅当 `spec.md` 列出了 `gap`。

```typescript
subagent({
  name: "Contract <module>",
  agent: "contract-owner",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Read spec.md. Add ONLY the contract gaps it lists to packages/contracts (and the
api-client / ai-client barrels if required). Additive changes only.
Idempotency keys are part of mutating request types. No secrets.
Verify: pnpm --filter @qitu/contracts typecheck (and @qitu/ai-client if touched).
Then commit with a focused feat(contracts): message. Do not push.
Return: commit SHA, exported type names with fields, typecheck result.`,
});
```

## Phase 3 — 实现

```typescript
subagent({
  name: "Build <module>",
  agent: "student-feature",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Module: <module>. You own EXACTLY apps/student-center/features/<module>/** — write no other path.
Read spec.md, AGENTS.md, and .pi/skills/student-module/references/contracts.md.
Implement the module: components, hooks, and the five states per screen.
The client never writes project state, task completion, AI decisions, growth
records, or audit. Enforce the TheoryMastered gate from server state.
Never add or reorder navigation items. If you need a contract change, do NOT edit
packages/** — list the gap in your handoff.
Verify: pnpm --filter @qitu/student-center typecheck && pnpm --filter @qitu/student-center lint
Return: files with purpose, exported components, contract gaps, assumed values, command output.`,
});
```

### 可选：多模块并行

只有当两个模块的 `features/<module>/**` 完全不相交、且 `app/**` 尚未被改写时，
才为每个模块开唯一 worktree：

```typescript
subagent({
  name: "Build <module>",
  agent: "student-feature",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  worktree: { branch: "agent/student-<module>", base: "HEAD" },
  task: `Module: <module>. ... Commit your work and report the SHA. Do not push, merge, or remove the worktree.`,
});
```

父会话逐个 review diff 后 cherry-pick 集成；不要并行改 `app/**`。

## Phase 4 — 集成

```typescript
subagent({
  name: "Integrate <module>",
  agent: "student-integrator",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Wire features/<module>/** into apps/student-center/app/** using the exact routes
in spec.md. Keep AuthGuard expectedRole="student" and the frozen navigation.
Adapt interface mismatches at the wiring layer only; never rewrite a module.
Write integration-report.md.
Verify: pnpm --filter @qitu/student-center typecheck && pnpm --filter @qitu/student-center build
Fix every failure caused by wiring; report a broken module instead of patching it.
Return: files written, route list, build result line, mismatches, what is not wired.`,
});
```

## Phase 5 — 验证

```typescript
subagent({
  name: "QA <module>",
  agent: "student-qa",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Read spec.md and list every acceptance criterion as a numbered check.
Run the typecheck/lint/build commands in your role definition and record output.
For each criterion mark PASS/FAIL/UNVERIFIED with evidence — never PASS unchecked.
Check all five UI states and name the file implementing each.
Check invariants: no client writes to server-owned state, TheoryMastered gate,
idempotency keys, no secret or raw minor conversation rendered.
Write qa-report.md. Do not fix anything.
Return: verdict, failing checks with evidence, UNVERIFIED list, owner per failure.`,
});
```

## Phase 6 — 评审

```typescript
subagent({
  name: "Review <module>",
  agent: "student-reviewer",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Review the diff (git diff against the run's base) plus spec.md and qa-report.md.
Read-only: do not modify files.
Check correctness, five-state coverage, frozen navigation, server authority,
minor-data safety, idempotency, and the TheoryMastered gate.
State explicitly whether your review is cross-family or context-isolated same-family.
Write review.md, findings by severity with path:line and the smallest fix.
Return: verdict, P0/P1 findings, independence note.`,
});
```

**分诊：** P0 立即修；P1 修（除非用户明确接受取舍）；P2 记录后继续。

## Phase 7 — 修复（有界 ≤2 轮）

```typescript
subagent({
  name: "Fix <owner> <finding ids>",
  agent: "student-feature",      // 或 student-integrator / contract-owner
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Targeted repair. Run directory: <ABSOLUTE run dir>
Read review.md and qa-report.md, then fix ONLY these findings: <ids>.
Constraints: only your owned files; do not add features, rename exports, or change
interfaces; keep unfixable items in the report instead of hiding them.
Return: per finding, what changed and the verification command.`,
});
```

修复后：若导出签名变化 → `student-integrator` 重新集成；然后 `student-qa`
跑**全量**新验证（不是只跑失败项——修复打断邻近检查是经典回归）。

**循环预算：** 最多 2 轮。每轮报告闭合了什么、又打开了什么；闭合 1 条打开 2 条算**失败轮**。
2 轮后仍有 P0/P1 → 停下问用户。

## Phase 8 — 交付（父会话）

给出：实现的路由清单、每个屏幕的五状态覆盖、QA 命令与结果、评审结论与残留风险、
以及所有仍未解决、需要用户拍板的条目。
