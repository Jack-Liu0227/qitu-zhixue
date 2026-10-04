---
name: tutor-engine
description: >
  启发式 AI搭档服务端链路开发工作流。实现 context_packet、苏格拉底式提示阶梯、
  答案泄露防护、卡顿检测与班主任升级、会话/流式接口，以及「兴趣 → 4/8 周学习计划」
  的掌握度引擎、题库判分与间隔复习。
  Use when asked to "实现 AI搭档", "启发式教学", "苏格拉底提问", "提示阶梯",
  "tutor engine", "AI 教学链路", "学习计划", "四周/八周计划", "先理论后实践",
  or "curriculum".
---

# Tutor Engine

把「启发式教学的 AI搭档」从教学策略做到可验证的服务端链路。

**开场声明：** "我先确认这一期做哪个切片，然后侦察现状、出教学策略规格请你确认，再补合同、并行实现、验证和对抗评审。"

参考实现：`HKUDS/DeepTutor`（只借鉴教学机制，不照搬其 Python / RAG / 向量库结构）。
学习计划设计基线：[`docs/student/tutor-curriculum-design.md`](../../../docs/student/tutor-curriculum-design.md)。

## 流程

```
Phase 0  定范围   父会话
Phase 1  侦察     scout ×2（并行，只读，普通窗格）
Phase 2  设计     tutor-pedagogy + student-planner → pedagogy-spec.md / api-spec.md
         ★ 确认门 A：提示阶梯与「拒绝直接给答案」策略必须用户确认
Phase 3  合同     contract-owner → contracts + barrels + exports（提交）
Phase 4  构建     tutor-pedagogy · tutor-context · tutor-escalation · tutor-api
         └ curriculum 切片：curriculum-planner · mastery-engine · question-bank
                             · grading-remediation · plan-api
Phase 5  集成     父会话：review diff → cherry-pick → 构建通过
Phase 6  验证     student-qa（确定性）+ pedagogy-reviewer（对抗性）
Phase 7  修复     归属角色修复 → 全量复验   [有界 ≤2 轮]
Phase 8  交付     父会话
```

父会话拥有全部阶段转换、集成和最终交付。所有角色都是叶子（`spawning: false`）。

---

## Runtime

所有角色**默认** `deepseek/deepseek-flash` + `thinking: off`。
`deepseek-flash` 的 `reasoning: false`（未认证 reasoning），传其它 thinking 值会被拒绝。
每次 spawn 仍**显式**传 `model` 与 `thinking`，因为工具参数会覆盖 frontmatter。

| 子代理 | 用途 | 需要升级质量时 |
|---|---|---|
| `scout` | 只读侦察 | 保持 flash/off |
| `student-planner` | 接口规格 | `deepseek/deepseek-v4-pro` + `high` |
| `tutor-pedagogy` | 教学策略 | `deepseek/deepseek-v4-pro` + `max` |
| `tutor-context` | 数据组装 | 保持 flash/off |
| `tutor-escalation` | 确定性检测 | 保持 flash/off |
| `tutor-api` | 授权/幂等/流式 | `deepseek/deepseek-v4-pro` + `high` |
| `curriculum-planner` | 计划生成 + 校验 | `deepseek/deepseek-v4-pro` + `high` |
| `mastery-engine` | 门槛与推进策略 | `deepseek/deepseek-v4-pro` + `high` |
| `question-bank` | 题库与答案边界 | `deepseek/deepseek-v4-pro` + `high` |
| `grading-remediation` | 确定性判分 | 保持 flash/off |
| `plan-api` | 计划接口/授权/幂等 | `deepseek/deepseek-v4-pro` + `high` |
| `contract-owner` | 类型与 barrel | 保持 flash/off |
| `student-qa` | 确定性验证 | 保持 flash/off |
| `pedagogy-reviewer` | 对抗性教学评审 | `deepseek/deepseek-v4-pro` + `max` |
| `student-reviewer` | 只读评审 | `deepseek/deepseek-v4-pro` + `high` |

**升级方式：** 只在该次 spawn 显式传 `model: "deepseek/deepseek-v4-pro"` 与
`thinking: "high"`（或 `"max"`），`deepseek-v4-pro` 的 `reasoning: true` 支持这两档。
教学策略与对抗评审若长期用 flash，答案泄露与阶梯跳级风险会上升，建议这两类保留升级。

---

## 参考 DeepTutor 的可移植机制（已侦察证实）

只移植**教学机制**，不移植其 Python 服务、向量库或前端。以下每条都带**已核实路径**；
没有证据的机制不写进规格。完整设计见
[`docs/student/tutor-curriculum-design.md`](../../../docs/student/tutor-curriculum-design.md)。

**关键结论：DeepTutor 没有分级提示阶梯。** 全仓库不存在 graduated hint/scaffold ladder；
`hints_used:int`（`deeptutor/learning/models.py:178`、`learning/assessment.py:104`）
**只是判分质量惩罚的输入**。所以 1–5 档阶梯是**本产品自有资产**，只吸收它的两条约束：
「只给一个学习者会问的问题、必须问号结尾」（`services/mastery_hints.py`）与
「解题脊柱 `solve_plan` 2–6 步」（`capabilities/solve/tools.py`）。

**要移植的（带证据）：**

1. **类型化掌握门槛** —— `learning/policy.py`。量化 `memory|procedure = 0.9`；
   质化 `concept|design` 用**存储布尔**而非分数。`next_objective()` 优先级：
   `answer_pending → due review → 首个未掌握目标（new→probe，concept/design→assess，
   其它→practice）→ complete`。
2. **近期加权掌握度** —— `learning/mastery.py`。权重 `(0.5,0.7,0.85,0.95,1.0)`，
   置信上限 `{1:0.5, 2:0.8}`，一次答对不能过关。此处是换 BKT/IRT 的接口点。
3. **四类目标** —— `learning/models.py:24` `memory|concept|procedure|design`；
   每个模块另有一句 `objective`（能力，不是话题清单）。
4. **服务端答案 key + 安全投影** —— `learning/question_card.py:build_question_card`
   刻意不投影 `expected_answer/explanation`；`learning/pending.py:public_pending_question`
   是安全投影；`build_grade_result` 判分后才释放两者。
5. **确定性判分** —— `learning/grading.py`：选择精确（去空格）、短答精确或
   `difflib ratio >= 0.85`（且期望答案 ≤30 字符）、开放题关键词重合 ≥0.6。
6. **每路径一道未答题、跨轮持久** —— `models.py:PendingQuestion` +
   `MasteryInteraction`。出题即结束当轮，答案作为**下一条消息**到达。
7. **模式与调用时工具准入** —— `capabilities/mastery/mode.py`：`outline|study|review`，
   `TOOL_MODES` 决定各模式可用动作；拒绝发生在**执行时**并指明解锁工具。
8. **Feynman 检查作为质化门槛** —— `capabilities/mastery/tools.py:1256`
   `mastery_assess{knowledge_point_id, passed, feedback}`；
   prompt 在 `learning/prompts/en.yaml:feynman`。
9. **间隔复习 + 提示/尝试扣分** —— `learning/scheduler.py`：按类型间隔序列
   （memory `0,1,3,7,14,30,60`；design `14,28`）、指数遗忘、同会话重复守卫；
   `_resolved_quality()` 扣 `min(0.25, hints*0.08)` 与 `min(0.2,(attempts-1)*0.05)`。
10. **错误分类 + 补救** —— `models.py:36` `structural|deviation|application|metacognitive`；
    `learning/prompts/en.yaml:error_diagnosis` 返回 `{error_type, ai_confirmation, remediation}`。
11. **学习者 intake 画像** —— `models.py:LearnerProfile`
    `{prior_knowledge,target_level,time_budget,preferences}`；`_profile_status()` 在出大纲前
    返回 `intake_needed: true`。
12. **只提问不给答案的 hint** —— `services/mastery_hints.py`：只生成一个第一人称问题，
    `_sanitize` 拒绝不以 `?`/`？` 结尾的内容，缓存键含 transcript 位置。
13. **难度由模型在模板内选择** —— `agents/question/prompts/en/pipeline.yaml`：
    三阶段 `explore → plan → quiz_step`；planner 产出恰好 N 个**唯一主题**模板，
    禁止重复题干，历史答题偏置薄弱子主题。
14. **提示词按命名块组装** —— `agents/loop/prompt_blocks.py`（运行时块按原始历史位置重放）
    + `capabilities/mastery/prompts/en/mastery_loop.yaml`（`general` 声明门槛由引擎决定，
    模型不得自称掌握）。

**明确不照搬：** `knowledge/` 与 `services/rag/pipelines/lightrag/*`（向量库、PageIndex、
embedding/indexing-version 选择器、KB manifest）、`services/memory/**` L1→L2→L3 与
`m_*` ULID 文档、`learning/storage.py`(86KB SQLite) / `learning/service.py`(80KB) /
`MasteryPathLease` / `MasteryEvent` / migrations / event hub、`agents/math_animator`、
`capabilities/audio_overview`、`video_learning`、partner IM、多用户 `skill_access.py`。
14 个 mastery tool 只有 `status/quiz/grade/assess/defer/revise` 有教学价值，
其余与 NestJS 现有职责重复。本项目用 PostgreSQL + 现有 API/合同体系。

---

## 确认门

**必须当场问：**

- 提示阶梯档位、单题最大引导轮数、「拒绝直接给答案」的例外；
- 与硬规则冲突：`TheoryMastered` 前不得实践、学生未确认意图不得建项目、
  未成年人数据可见范围；
- 侦察显示产品文档某个字段在现实中没有数据来源（需要取舍）；
- 语音 Live 与 AI搭档的边界取舍；
- 两轮修复后仍有 P0。

问法：一次问完，最多 3 条，每条 = 问题 + 为什么重要 + 建议方案。

---

## Fire-and-forget

`subagent` 即发即忘：spawn 后结束当轮 → 自动投递结果唤醒父会话 → 从结果继续。
**不要**轮询、查状态、sleep 或 tail session 文件。

## 运行目录

`.pi/runs/YYYY-MM-DD-<slug>/`，每个子任务传**绝对路径**。
形状见 [`references/contracts.md`](references/contracts.md)。

```
.pi/runs/<run>/
├── brief.json
├── recon-api.md  recon-deeptutor.md
├── pedagogy-spec.md  api-spec.md  curriculum-spec.md
├── qa-report.md
└── review.md
```

---

## Phase 0 — 定范围（父会话）

读产品文档 4.4 / 9.3 / 9.4 / 9.5，确认本期切片
（`pedagogy` / `context` / `api` / `escalation` / `curriculum`（4/8 周学习计划）/ `all`）、
做/不做、验收重点。写 `brief.json`。

**含 `curriculum` 时**先读 `docs/student/tutor-curriculum-design.md`，并在 Phase 2 后
过它的第 8 节确认门（课时密度、先理论后实践的含义、计划宿主页面、模板范围）。

## Phase 1 — 侦察（并行，只读）

```typescript
subagent({
  name: "Recon current tutors",
  agent: "scout",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Read-only. Run directory: <ABSOLUTE run dir>
Map the CURRENT code that an AI tutor would build on:
- packages/contracts, packages/ai-client, packages/api-client current exports
- services/api/src/modules/** (auth pattern, common/{access,audit,idempotency,outbox})
- services/workers/** and services/realtime-gateway/**
- how identity/auth and object-level access are enforced (path:line)
Report what exists, what is missing, and the exact extension points. No file writes.`,
});

subagent({
  name: "Recon DeepTutor",
  agent: "scout",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Read-only. Inspect github.com/HKUDS/DeepTutor to identify the portable
teaching mechanisms listed in .pi/skills/tutor-engine/SKILL.md (hint ladder,
question generation/difficulty, mastery model, review scheduling, solve-vs-hint,
tutor prompt structure, learner memory). git clone may be blocked; use
curl against raw.githubusercontent.com and api.github.com.
For each mechanism give: name, what it actually does, the file path proving it,
and the minimal field set. Flag anything Python/RAG/vector-specific that must NOT
be copied. Do not speculate; if a file is unavailable, say so. No repo writes.`,
});
```

父会话汇总两份侦察，**不复制**任何真实未成年人数据或密钥。

## Phase 2 — 设计

```typescript
subagent({
  name: "Design pedagogy",
  agent: "tutor-pedagogy",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Mode: spec (no code).
Run directory: <ABSOLUTE run dir>
Read brief.json, recon-api.md, recon-deeptutor.md, product doc 4.4/9.3/9.4/9.5,
and .pi/skills/tutor-engine/references/contracts.md.
Write pedagogy-spec.md. It must define:
- the pedagogic_move vocabulary and the transition rules
- the 1-5 hint ladder with per-level triggers and the single-step escalation rule
- the no-full-answer guard (default-off escape hatch) and its explicit exception
- the per-question guidance budget (<=6 turns) and what happens on exhaustion
- the exact turn-record fields
- prompt structure (role, prohibitions, language, output shape) and prompt_version
- the context_packet contract boundary with tutor-context
- everything Python/RAG-specific in DeepTutor that we are NOT copying
Return: artifact path, move list, ladder table, budget, open questions.`,
});

subagent({
  name: "Design tutor api",
  agent: "student-planner",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Mode: spec (no code).
Run directory: <ABSOLUTE run dir>
Read brief.json, recon-api.md, and product doc 4.4 (接口) / 9.5 (断线策略).
Write api-spec.md for the tutor slice: endpoint list with request/response shapes,
error codes, object-level authorization rules, idempotency keys, the WS/SSE
stream contract with resume cursor and sequence numbering, the persisted turn
shape, and audit events. Mark each type existing (path:line) or gap.
Return: endpoint list, contract gaps, authorization rules, open questions.`,
});

// 仅 curriculum 切片
subagent({
  name: "Design curriculum",
  agent: "curriculum-planner",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Mode: spec (no code).
Run directory: <ABSOLUTE run dir>
Read brief.json, recon-deeptutor.md, docs/student/tutor-curriculum-design.md, and
.pi/skills/tutor-engine/references/contracts.md.
Write curriculum-spec.md. It must define:
- the LearningPlan / Module / Session / Objective shapes and templateVersion freezing
- the 60-minute block split for 4-week and 8-week plans, and how practice share grows
- the two-phase explore -> plan generation contract and the exact validation rules
  (weeks in {4,8}, blocks sum to 60, <=4 objectives per session, acyclic prerequisites,
  no practice objective before its theory prerequisite)
- the theory -> practice ordering invariant and how it maps to the TheoryMastered event
- the intake profile (prior knowledge, target level, time budget, preferences) and
  when intake is required
- exactly which DeepTutor mechanisms are ported, each with its source path
Return: artifact path, plan shape, validation rules, open questions.`,
});
```

**→ 确认门 A**：把 `pedagogy-spec.md` 的阶梯表、引导轮数上限、以及
「什么情况下允许给完整答案」直接呈现给用户确认后，才进入 Phase 3。

## Phase 3 — 合同（先提交）

```typescript
subagent({
  name: "Contract tutor",
  agent: "contract-owner",
  model: "deepseek/deepseek-flash",
  thinking: "off",
  task: `Run directory: <ABSOLUTE run dir>
Read pedagogy-spec.md, api-spec.md and (if present) curriculum-spec.md. Add the
contract gaps to packages/contracts. Pre-create the pure-package stubs and register
their exports in packages/ai-client/package.json so the Phase 4 writers never edit
the same file:
- always: src/{pedagogy,context,escalation}/index.ts
- curriculum slice: src/{curriculum,mastery,questions,grading}/index.ts
Additive only; idempotency keys on mutating requests.
No secrets, no fictional fields.
Verify: pnpm --filter @qitu/contracts typecheck (and @qitu/ai-client if touched).
Then commit (feat(contracts): tutor contracts). Do not push.
Return: commit SHA, exported type names with fields, typecheck result.`,
});
```

## Phase 4 — 构建（并行 fan-out）

四个子代理，四个目录，零重叠。同时启动后结束当轮。

```typescript
subagent({ name: "Tutor pedagogy",   agent: "tutor-pedagogy",   model: "deepseek/deepseek-flash",   thinking: "off",  worktree: { branch: "agent/tutor-pedagogy",   base: "HEAD" }, task: `Slice: pedagogy. You own EXACTLY packages/ai-client/src/pedagogy/**. Read pedagogy-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement the move selection, the 1-5 ladder, the no-full-answer guard, the 6-turn budget, and the turn record. Deterministic, no I/O. Add focused tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push, merge, or remove the worktree. Return: files, exported API, turn-record fields, test output.` });

subagent({ name: "Tutor context",    agent: "tutor-context",    model: "deepseek/deepseek-flash",    thinking: "off",  worktree: { branch: "agent/tutor-context",    base: "HEAD" }, task: `Slice: context. You own EXACTLY packages/ai-client/src/context/**. Read pedagogy-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement the context_packet builder: the nine fields, summary-not-history, evidence-or-omit, bounded size, JSON-serializable. Add focused tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, builder signature, packet fields, test output.` });

subagent({ name: "Tutor escalation", agent: "tutor-escalation", model: "deepseek/deepseek-flash",    thinking: "off",  worktree: { branch: "agent/tutor-escalation", base: "HEAD" }, task: `Slice: escalation. You own EXACTLY packages/ai-client/src/escalation/** and services/workers/**. Read pedagogy-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement deterministic stall detection (4 consecutive stalls / frustration) producing exactly one idempotent 班主任 todo plus one audit event; replay-safe. Add focused tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, detection inputs/outputs, idempotency key, test output.` });

subagent({ name: "Tutor api",        agent: "tutor-api",        model: "deepseek/deepseek-flash",   thinking: "off", worktree: { branch: "agent/tutor-api",         base: "HEAD" }, task: `Slice: api. You own EXACTLY services/api/src/modules/ai-tutor/**. Read api-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement the endpoints, object-level authorization (403 on cross-student), server-owned stage, per-turn record persistence, idempotency on POST /turns, the WS stream with resume cursor/sequence, and audit. Add focused tests. Verify: pnpm --filter @qitu/api typecheck && pnpm --filter @qitu/api test. Commit and report the SHA. Do not push or merge. Return: files, endpoint list, authorization evidence, test output.` });
```

### Phase 4b — 学习计划切片（仅 `curriculum`）

同理，五个目录零重叠。`curriculum-spec.md` 已在 Phase 3 冻结合同。

```typescript
subagent({ name: "Curriculum planner", agent: "curriculum-planner", model: "deepseek/deepseek-flash", thinking: "off", worktree: { branch: "agent/curriculum-planner", base: "HEAD" }, task: `Slice: curriculum. You own EXACTLY packages/ai-client/src/curriculum/**. Read curriculum-spec.md, docs/student/tutor-curriculum-design.md and .pi/skills/tutor-engine/references/contracts.md. Implement the two-phase explore -> plan generator and strict validation (weeks in {4,8}, blocks sum to 60, <=4 objectives/session, acyclic prerequisites, never schedule practice before its theory prerequisite). Untrusted model output must be rejected, never silently repaired. Deterministic given profile+interest+weeks+seed. No persistence, no I/O. Add focused tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, generator signature, validation rules, test output.` });

subagent({ name: "Mastery engine", agent: "mastery-engine", model: "deepseek/deepseek-flash", thinking: "off", worktree: { branch: "agent/mastery-engine", base: "HEAD" }, task: `Slice: mastery. You own EXACTLY packages/ai-client/src/mastery/**. Read curriculum-spec.md, docs/student/tutor-curriculum-design.md and .pi/skills/tutor-engine/references/contracts.md. Implement the typed gates (memory/procedure >= 0.9; concept/design stored boolean), recency weights (0.5,0.7,0.85,0.95,1.0), confidence cap {1:0.5, 2:0.8}, the fixed next-step precedence, the spaced-review scheduler mapped onto session indices, and the hint/attempt quality penalties. Never write state. Add focused tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, signatures, constants used, test output.` });

subagent({ name: "Question bank", agent: "question-bank", model: "deepseek/deepseek-flash", thinking: "off", worktree: { branch: "agent/question-bank", base: "HEAD" }, task: `Slice: questions. You own EXACTLY packages/ai-client/src/questions/**. Read curriculum-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement QuestionCard (server-only, holds expectedAnswer/explanation), toPublicQuestion (structural projection that cannot include the answer), the closed question-kind union, misconception-bearing matched-length distractors, and the difficulty template generation (unique topics, no repeated stems). Add a serialized-projection scan test. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, signatures, boundary enforcement, test output.` });

subagent({ name: "Grading", agent: "grading-remediation", model: "deepseek/deepseek-flash", thinking: "off", worktree: { branch: "agent/grading-remediation", base: "HEAD" }, task: `Slice: grading. You own EXACTLY packages/ai-client/src/grading/**. Read curriculum-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement deterministic grading (choice exact; short exact or difflib-style 2*M/T ratio >= 0.85 capped at 30 chars; open keyword overlap >= 0.6), the four-value error taxonomy with a mandatory remediation, rejection of non-AWAITING questions, and explanation release only inside GradeResult. Pure, no I/O. Add boundary tests. Verify: pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test. Commit and report the SHA. Do not push or merge. Return: files, thresholds, taxonomy coverage, test output.` });

subagent({ name: "Plan api", agent: "plan-api", model: "deepseek/deepseek-flash", thinking: "off", worktree: { branch: "agent/plan-api", base: "HEAD" }, task: `Slice: plan-api. You own EXACTLY services/api/src/modules/learning-plan/**. Read api-spec.md, curriculum-spec.md and .pi/skills/tutor-engine/references/contracts.md. Implement the draft-plan generation, POST /confirm as the only project-creation path, session start / next-step / answers / evidence endpoints, server-side grading and TheoryMastered gating, object-level authorization, idempotency keys on generation/confirm/answers, plan immutability after confirmation, and audit. Reject client-supplied stage or mastery. Add focused tests. Verify: pnpm --filter @qitu/api typecheck && pnpm --filter @qitu/api test. Commit and report the SHA. Do not push or merge. Return: files, endpoint list, persisted shapes, idempotency keys, authorization evidence, test output.` });
```

**只做一个切片时不要开 worktree**，直接在父检出串行，更快更稳。
并行前提是 Phase 3 已提交并冻结共享文件；否则退化为串行。

## Phase 5 — 集成（父会话）

1. 逐个 `git show <sha>` / diff review；
2. `git cherry-pick <sha>`，只允许在预建 barrel / exports 上解冲突；
3. 若解冲突涉及业务逻辑，说明是**规格缺口**，回到 Phase 2，不要自行发明行为；
4. 跑构建：

```bash
pnpm --filter @qitu/contracts typecheck
pnpm --filter @qitu/ai-client typecheck && pnpm --filter @qitu/ai-client test
pnpm --filter @qitu/api typecheck
```

## Phase 6 — 验证

```typescript
subagent({ name: "QA tutor", agent: "student-qa", model: "deepseek/deepseek-flash", thinking: "off", task: `Run directory: <ABSOLUTE run dir>. Read pedagogy-spec.md + api-spec.md, list every acceptance criterion. Run the typecheck/test commands; record output. Check deterministic invariants: hint level <=5, level 5 not default, turn record complete, guidance budget <=6, escalation fires at 4 not 3, duplicate idempotency key yields one turn, cross-student access 403, audit written once. Write qa-report.md. Do not fix. Return verdict, failures with evidence, UNVERIFIED, owner per failure.` });

subagent({ name: "QA curriculum", agent: "student-qa", model: "deepseek/deepseek-flash", thinking: "off", task: `Run directory: <ABSOLUTE run dir>. Only if curriculum-spec.md exists. Read it plus api-spec.md, list every acceptance criterion. Run the typecheck/test commands; record output. Check deterministic invariants: 4-week and 8-week block sums are exactly 60; <=4 objectives per session; a malformed or cyclic plan is rejected not repaired; no practice objective is scheduled before its theory prerequisite; a single correct answer cannot pass a 0.9 gate; concept/design never pass on score alone; the public question projection contains no answer substring; every incorrect grade carries errorType + remediation; POST /answers twice with one idempotency key yields one attempt; generating a plan creates no project; practice before TheoryMastered is rejected; cross-student access 403. Append to qa-report.md. Do not fix. Return verdict, failures with evidence, UNVERIFIED, owner per failure.` });

subagent({ name: "Review pedagogy", agent: "pedagogy-reviewer", model: "deepseek/deepseek-flash", thinking: "off", task: `Run directory: <ABSOLUTE run dir>. Read the diff, pedagogy-spec.md, api-spec.md, qa-report.md. Read-only. Attack: answer leakage ("直接给我答案", role-play, ignore-instructions), ladder monotonicity, 6-turn budget, escalation duplication/false positives, client writes to stage/growth/audit, context packet history echo / evidence-less profile claims, voice boundary. State cross-family vs context-isolated. Write review.md. Return verdict, P0/P1 with reproduction and evidence, independence note.` });

subagent({ name: "Review curriculum", agent: "student-reviewer", model: "deepseek/deepseek-flash", thinking: "off", task: `Run directory: <ABSOLUTE run dir>. Only if curriculum-spec.md exists. Read the diff, curriculum-spec.md, api-spec.md, qa-report.md. Read-only. Attack the plan slice: does any path let a client set stage/mastery/TheoryMastered; can a practice task be reached with unmet theory; can the plan be mutated after confirmation; does an unvalidated model plan reach persistence; can a 4-week plan silently become 8 weeks or exceed 60 minutes; is the answer key reachable from any student-facing response; are minor-data fields minimized; is plan generation reachable without confirmed intent. Declare review independence honestly. Write review.md (append if present). Return verdict, P0/P1 with reproduction and evidence, independence note.` });

**分诊：** P0 立即修；P1 修（或用户明确接受）；P2 记录。教学策略层面的 P0
若需要产品取舍 → **当场问用户**。

## Phase 7 — 修复（有界 ≤2 轮）

只重跑归属角色；导出签名变化则父会话重新集成；然后 `student-qa` **全量**复验。
闭合 1 条打开 2 条算**失败轮**。2 轮后仍有 P0/P1 → 停下问用户。

## Phase 8 — 交付（父会话）

给出：已实现的接口清单、提示阶梯与「拒绝给答案」策略说明、升级阈值、
验证命令与结果、对抗评审结论、以及所有需要用户拍板的残留项。
明确说明评审独立性（跨家族 / 同家族上下文隔离）。
