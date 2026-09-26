# 学生端多 Agent 开发配置设计

> 目标：把「学生端各模块功能开发」和「启发式 AI搭档」拆成可复用、可并行的
> Pi Herdr 子代理角色与两条工作流，让父会话只做编排、确认与集成。
>
> 状态：设计基线 v1。落地文件位于 `.pi/agents/`、`.pi/skills/`、`.pi/extensions/`。

---

## 1. 设计原则

1. **角色（agent）只描述一种有界职责，工作流（skill + 命令）描述多阶段结果。**
   `pi-herdr-agents` 的明确要求：不要把一个多阶段流程伪装成一个 agent。
2. **父会话是唯一编排者。** 子代理默认是叶子（`spawning: false`），不派生后代、不 push、不合并。
3. **共享文件只有一个写者。** 合同、barrel、`package.json` 由 `contract-owner` 串行先写并提交，
   其余并行写者只在自己的目录内改动。
4. **服务端权威。** 项目状态、AI 决策、成长档案、审计日志一律服务端写；
   前端 agent 只做显示与调用，不做安全判断。
5. **未成年人数据最小可见。** 评审与 QA 必须显式检查脱敏与越权。
6. **每个阶段消费上一阶段的产物。** 顺序是设计的一部分，不是妥协。
7. **验证先于断言。** 每个子代理必须在交接里给出真实命令与输出。

---

## 2. 角色清单

共 17 个，全部为项目级定义（`.pi/agents/<name>.md`，优先级 project > global > package）。

学生端页面与数据模型基线见 [`student-frontend-backend-design.md`](./student-frontend-backend-design.md)
（由 `UI图片/学生区/` 7 张图 + 产品文档 4.x 推导），该文档第 9 节待定项未答完前不开工。

**已裁决：** 导航第三项 = **AI搭档**；阶段模型三层分层（11 服务端状态 / 模板自定义展示阶段 / 展示位置）。

| 角色 | 职责（唯一产出） | 默认模型 | 工具 | 写入范围 |
|---|---|---|---|---|
| `student-planner` | 一个模块/切片的决策完备规格 `spec.md` | `flash` / `off` | read, bash, write, edit | `.pi/runs/<run>/**` |
| `contract-owner` | 共享合同与 barrel（单写者） | `flash` / `off` | read, bash, write, edit | `packages/{contracts,ai-client,api-client,permissions}/**` |
| `student-feature` | 恰好一个学生端 feature 模块 | `flash` / `off` | read, bash, write, edit | `apps/student-center/features/<module>/**` |
| `student-integrator` | 路由/shell 接线 + 构建通过 | `flash` / `off` | read, bash, write, edit | `apps/student-center/app/**`、`features/index.*` |
| `tutor-pedagogy` | 苏格拉底策略 + 提示阶梯 + 答案泄露防护 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/pedagogy/**` |
| `tutor-context` | `context_packet` 组装 + 学习者记忆投影 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/context/**` |
| `tutor-escalation` | 卡顿检测 + 班主任待办 + 审计 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/escalation/**`、`services/workers/**` |
| `tutor-api` | 会话/轮次/流式接口 + 幂等 + 审计 | `flash` / `off` | read, bash, write, edit | `services/api/src/modules/ai-tutor/**` |
| `student-qa` | 一次完整验证与 `qa-report.md` | `flash` / `off` | read, bash, write, edit | `.pi/runs/<run>/qa-report.md` |
| `student-reviewer` | 学生端代码/状态/未成年安全评审（只读） | `flash` / `off` | read, bash | 只读 |
| `pedagogy-reviewer` | 教学行为对抗评审：答案泄露、提示阶梯、升级（只读） | `flash` / `off` | read, bash | 只读 |
| `curriculum-planner` | 兴趣 → 4/8 周计划生成 + 严格校验 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/curriculum/**` |
| `mastery-engine` | 掌握门槛 + 推进优先级 + 间隔复习调度 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/mastery/**` |
| `question-bank` | 题库生成 + 服务端答案边界 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/questions/**` |
| `grading-remediation` | 确定性判分 + 错误分类 + 补救 | `flash` / `off` | read, bash, write, edit | `packages/ai-client/src/grading/**` |
| `plan-api` | 计划生成/确认/会话/答题接口 + `TheoryMastered` 门 | `flash` / `off` | read, bash, write, edit | `services/api/src/modules/learning-plan/**` |
| `student-api` | 学生数据面：今日聚合/灵感探索与意图确认/项目实例阶段任务/工作台修订/作品与证据聚合 | `flash` / `off` | read, bash, write, edit | `services/api/src/modules/{students,inspiration,projects,workbench,works}/**` |

只读侦察复用包自带的 `scout`；通用兜底实现复用包自带的 `worker`。

### 职责边界（避免重叠）

- `student-feature` **只写 feature 目录**。它不碰 `app/**`、不碰 `packages/**`、不碰其他模块。
- 需要新合同字段时，它**不改** `packages/contracts`，而是在交接里列出「合同缺口」，
  由父会话插入 `contract-owner` 阶段。
- `student-integrator` **只做接线**：路由文件、导航入口、feature 索引、以及接口不匹配处的适配。
  它不重新实现任何模块，也不"顺手改进"别人的代码。
- `tutor-pedagogy` / `tutor-context` / `tutor-escalation` / `tutor-api` 各自目录零重叠，
  是唯一允许并行 fan-out 的一组。
- `curriculum-planner` / `mastery-engine` / `question-bank` / `grading-remediation` / `plan-api`
  同样目录零重叠，构成第二条可并行 fan-out 的线（`/tutor-engine` 的 `curriculum` 切片）。
- **提示阶梯是自有资产，不是移植来的。** DeepTutor 全仓库没有分级阶梯，
  `hints_used` 只是判分质量惩罚；不要把 `tutor-pedagogy` 的 1–5 档说成「参考 DeepTutor」。
- `plan-api` **不做**卡顿检测与班主任待办（那是 `tutor-escalation`），也不做教学决策。
- `student-api` **不做** AI搭档传输（`tutor-api`）与掌握度/`TheoryMastered`（`plan-api`/`mastery-engine`）；
  它独占学生数据面五个模块，是串行单写者。若要并行，再按模块拆成多个 agent。

---

## 3. 工作流 A：`/student-module <today|inspiration|projects|works|tutor-ui>`

目标：把学生端**一个 feature 模块**从规格做到可构建、可验证、有评审。

```
Phase 0  定范围   父会话        → brief.json（读产品文档对应小节）
Phase 1  规格     student-planner           → spec.md
Phase 2  合同     contract-owner            → packages/**（仅在 spec 列出缺口时）
Phase 3  实现     student-feature           → features/<module>/**
Phase 4  集成     student-integrator        → app/** + integration-report.md
Phase 5  验证     student-qa                → qa-report.md
Phase 6  评审     student-reviewer          → review.md
Phase 7  修复     归属角色 → 重新集成 → 重新全量验证   [有界 ≤2 轮]
Phase 8  交付     父会话        → 路由、状态覆盖、命令与结果
```

- Phase 3 默认在**父检出串行**执行（一个模块一个写者），避免与 `app/**`、导航、样式互相冲突。
  若确实要并行多个模块，每个模块单独 worktree 分支，由父会话逐个 cherry-pick 集成。
- Phase 4 是唯一允许改 `app/**` 的阶段，保证路由与冻结导航不被模块各自改写。
- Phase 7 只重跑失败项对应角色；集成层失败重跑 `student-integrator`；每次修复后 QA **重新全量**跑一遍
  （修复打断邻近检查是经典回归）。

### 各模块的固定规则（由 skill 注入到任务里）

| 模块 | 冻结导航 | 关键不可违反规则 |
|---|---|---|
| `today` | 今天 | 无项目时给灵感空间入口；继续上次项目 |
| `inspiration` | 灵感空间 | 学生未确认意图**不得**创建正式项目；推荐区与自由 Live 区视觉分离 |
| `tutor-ui` | **AI搭档** | 每轮带阶段与提示等级；AI 不能直接改成长档案；触发升级后班主任端出现待办 |
| `projects` | 我的项目 | `TheoryMastered` 前不得进入实践；客户端不得直接改项目状态；提交用幂等键 |
| `works` | 作品展厅 | 上传走签名 URL；发布/撤回受权限控制；作品版本留痕 |

---

## 4. 工作流 B：`/tutor-engine <pedagogy|context|api|escalation|curriculum|all>`

目标：实现「启发式教学 AI搭档」的服务端链路，参考 DeepTutor 的教学机制，
按本项目文档 4.4 / 9.3 / 9.4 / 9.5 的定义落地。

`curriculum` 切片额外目标：把孩子的**兴趣**变成 **4 周或 8 周、每节课 1 小时、
先理论后实践**、最终产出完整作品（如一个 Python 小游戏）的详细学习计划。
设计基线见 [`tutor-curriculum-design.md`](tutor-curriculum-design.md)。

```
Phase 0  定范围   父会话        → brief.json
Phase 1  侦察     scout ×2（并行，只读，普通窗格）
Phase 2  设计     tutor-pedagogy + student-planner (+ curriculum-planner)
                                → pedagogy-spec.md / api-spec.md / curriculum-spec.md
         ★ 确认门 A：提示阶梯与"拒绝直接给答案"策略必须先由用户确认
Phase 3  合同     contract-owner → contracts + ai-client barrel + package.json exports（提交）
Phase 4  构建     tutor-pedagogy · tutor-context · tutor-escalation · tutor-api（并行 fan-out）
Phase 4b 构建     curriculum 切片：curriculum-planner · mastery-engine · question-bank
                                · grading-remediation · plan-api（并行 fan-out）
Phase 5  集成     父会话（review diff → cherry-pick → 解决 barrel）→ 构建通过
Phase 6  验证     student-qa（确定性）+ pedagogy-reviewer（对抗性）
                 (+ student-qa / student-reviewer 针对 curriculum 切片)
Phase 7  修复     归属角色修复，QA 重新全量验证   [有界 ≤2 轮]
Phase 8  交付     父会话        → 接口清单、策略说明、验证证据、残留风险
```

- Phase 3 必须**先提交**：并行写者从 committed HEAD 建 worktree，
  未提交的合同文件不会出现在子检出里。
- Phase 3 顺带预建 `pedagogy/index.ts`、`context/index.ts`、`escalation/index.ts` 空 barrel
  与 `package.json` exports，使 Phase 4 四个写者**不需要改同一个文件**；
  含 `curriculum` 切片时再预建 `curriculum` / `mastery` / `questions` / `grading` 四个。
- Phase 4 的并行前提是 Phase 3 已冻结共享文件；否则退化为父检出串行，更稳。
  只需一个切片时直接串行，不必开 worktree。

---

## 5. 并行与 worktree 策略

| 场景 | 运行方式 | 理由 |
|---|---|---|
| 侦察、规划、评审、QA | 普通窗格（不 worktree） | 只读或写独立报告，共享父检出无风险 |
| 单个学生端 feature 模块 | 父检出串行 | 与 `app/**`、导航、样式强耦合 |
| tutor-engine 四个切片 | 每切片唯一 worktree 分支 `agent/tutor-<slice>` | 目录零重叠，可安全并行 |
| curriculum 五个切片 | 每切片唯一 worktree 分支 `agent/<role>` | 目录零重叠，可安全并行 |
| 多个 feature 模块并行 | 每模块唯一 worktree 分支 | 由父会话逐个集成，冲突显式暴露 |

worktree 规则：分支名唯一、从 committed HEAD 起步、子代理只在自己的检出内改动并提交、
**不 push / 不合并 / 不删除 worktree**；集成与清理由父会话负责。

---

## 6. 模型与认证现状（重要）

本机 `~/.pi/agent/models.json` 里只有 `deepseek` provider 的两个模型（`jaycue-*`、
`openai-codex` 均未认证）。**本项目所有 16 个角色默认使用
`deepseek/deepseek-flash` + `thinking: off`。**

| 层级 | 可用 ID | reasoning | 支持 thinking | 用途 |
|---|---|---|---|---|
| default | `deepseek/deepseek-flash` | `false` | **仅 `off`** | 全部 16 个角色的默认 |
| escalation | `deepseek/deepseek-v4-pro` | `true` | `off` / `high` / `max` | 按需在单次 spawn 显式升级 |

- **`deepseek-flash` 未认证 reasoning**，传 `high`/`max`/`medium` 会被拒绝。
  所有 agent frontmatter 与 skill spawn 模板都写死为 `off`。
- **升级是按次覆盖，不是改默认。** 需要更强推理时，在该次 `subagent()` 调用里显式传
  `model: "deepseek/deepseek-v4-pro"` 与 `thinking: "high"`（或 `"max"`）。
  优先考虑升级的角色：`tutor-pedagogy`（教学策略）、`pedagogy-reviewer`（对抗评审）、
  以及规格产出者（`student-planner` / `curriculum-planner` / `mastery-engine`）——
  规格质量决定后续一切，且 flash 在「拒绝给答案」和「不跳级」这类约束上更容易漂移。
- **跨家族评审当前不可用**（只有 deepseek 一个家族已认证），只能用同家族、
  上下文隔离的新会话评审；交付时必须如实说明「这是上下文隔离，不是跨家族独立评审」。
- **已知全局配置缺陷（未修改，需授权）：** `~/.pi/agent/settings.json` 的
  `subagents.defaultModel` 是 `deepseek/deepseek-v4-flash`，而 models.json 里只定义了
  `deepseek-flash` 与 `deepseek-v4-pro` —— **未显式传 `model` 的 spawn 会命中这个
  不存在的 ID**。本项目所有 spawn 都显式传 `model`，因此目前不受影响；
  修它属于全局配置变更，需明确授权。同文件 `agentOverrides.reviewer` 的 thinking 覆盖
  也指向已失效的全局 `reviewer` 角色。
- 真正的跨家族对抗评审路径：认证第二个 provider（如 `jaycue-gpt`）后，
  把 `student-reviewer` / `pedagogy-reviewer` 的模型切到 `jaycue-gpt/gpt-5.6-sol`。

---

## 7. 确认门（不要把问题攒到最后）

**必须当场停下来问用户：**

- 模块范围或交互与冻结导航/信息架构冲突；
- 规格里出现需要产品取舍的 P0（例如意图确认流程的边界）；
- 教学策略层面的取舍：提示阶梯档位、单题最大引导轮数、"拒绝直接给答案"的例外；
- 与「学生未确认不得建项目」「TheoryMastered 前不得实践」等硬规则发生冲突；
- 两轮修复后仍有 P0。

**不必打断、记录即可：**

- 纯视觉细节、字号、间距；
- 已在 spec 标为待确认且不影响能否跑通的事项；
- 用户自己试用后会发现的文案问题。

问法：**一次问完，最多 3 条**，每条 = 问题 + 为什么重要 + 建议方案。

---

## 8. 产物契约

每次运行使用一个运行目录：`.pi/runs/YYYY-MM-DD-<slug>/`（已 gitignore，属本地事实）。

```
.pi/runs/<run>/
├── brief.json           Phase 0 父会话
├── spec.md              Phase 1 student-planner
├── pedagogy-spec.md     Phase 2 tutor-pedagogy
├── api-spec.md          Phase 2 student-planner
├── integration-report.md Phase 4 student-integrator
├── qa-report.md         Phase 6 student-qa
└── review.md            Phase 6 student-reviewer / pedagogy-reviewer
```

字段形状见 `.pi/skills/student-module/references/contracts.md` 与
`.pi/skills/tutor-engine/references/contracts.md`。未知值一律写 `null`，不得猜测。

---

## 9. 与现有全局 agent 的关系

现有全局角色 `student`、`platform-backend`、`reviewer`、`explore`、`plan`、`task`
仍然可用，但：

- `reviewer` 的模型引用已失效，**不要直接使用**，改用 `student-reviewer` / `pedagogy-reviewer`；
- `student` / `platform-backend` 是"大范围"权限角色，适合一次性改动；
  本设计的 `student-feature` / `tutor-api` 等是**有界**角色，更适合编排，优先使用；
- 项目级定义会覆盖同名全局定义，因此新增角色不会破坏现有用法。

---

## 10. 落地清单

```text
.pi/agents/student-planner.md
.pi/agents/contract-owner.md
.pi/agents/student-feature.md
.pi/agents/student-integrator.md
.pi/agents/tutor-pedagogy.md
.pi/agents/tutor-context.md
.pi/agents/tutor-escalation.md
.pi/agents/tutor-api.md
.pi/agents/student-qa.md
.pi/agents/student-reviewer.md
.pi/agents/pedagogy-reviewer.md
.pi/skills/student-module/SKILL.md
.pi/skills/student-module/references/contracts.md
.pi/skills/tutor-engine/SKILL.md
.pi/skills/tutor-engine/references/contracts.md
.pi/extensions/student-workflow.ts
```

### 验证方式

```bash
# 角色被发现，且来源为 project
pi -e .pi/extensions/student-workflow.ts   # 或在 Pi 内 /reload
# 交互内：
/subagent list
/student-module today
/tutor-engine pedagogy
```

自检点：

1. `/subagent list` 中 11 个角色均为 `project` 来源，模型 ID 可解析；
2. `/student-module` 与 `/tutor-engine` 命令存在，别名可用；
3. 每次 spawn 都显式传 `model` 与 `thinking`，且 flash 的 thinking 为 `off`；
4. 写者角色在交接里报告了命令与输出，而不是"应该可以"。
