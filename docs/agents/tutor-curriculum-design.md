# 借鉴 DeepTutor：把「兴趣 → 4/8 周学习计划 → 先理论后实践 → 完成作品」做成 AI搭档能力

> 目标能力：输入孩子的兴趣（例如「用 Python 做一个小游戏」），生成 **4 周或 8 周**、
> 每节课 **1 小时**、**先理论学习再动手实践**、最终产出一个完整作品的详细学习计划，
> 并由 AI搭档按计划逐节推进、检查、复习、升级。
>
> 参考实现：`HKUDS/DeepTutor`（下称 DT）。本文只借鉴其**教学机制**，
> 不照搬其 Python 服务、RAG/向量库、L1–L3 记忆子系统与 14 个 tool 的接口形态。
>
> 状态：设计基线 v1。落地角色见 `.pi/agents/`，工作流见 `/tutor-engine`（切片 `curriculum`）。

---

## 0. 结论先行

**借三件事：**

1. **目标-掌握度引擎**（DT `learning/policy.py` + `learning/mastery.py`）
   —— 决定「这一节/这一周能不能往下走」。这是 DT 最值钱的部分：
   推进不是靠阶段游标，而是**每个目标重新计算是否掌握**。
2. **题库与判分**（DT `learning/question_card.py` / `pending.py` / `grading.py`）
   —— 题面接口**绝不下发答案**，判分在服务端做，答完才释放解析。
3. **间隔复习 + 错误归类**（DT `learning/scheduler.py` + `models.py:36`）
   —— 决定「每节课开头复习什么」「错题属于哪一类、怎么补」。

**不借两件事：**

1. **提示阶梯**——DT **没有**（侦察确认：全仓库没有 graduated hint/scaffold ladder，
   `hints_used:int` 只是判分质量惩罚的输入）。我们的 1–5 档阶梯是**产品自有的**，
   保留并叠加 DT 的「只给一个问题、绝不给答案」约束（`services/mastery_hints.py`）。
2. **RAG / 向量库 / L1–L3 记忆 / 多用户插件**——重量大且与本项目 PostgreSQL + 现有
   合同体系重复，只保留「每个学习者一份画像文档」的思想。

**你的 4/8 周计划不新增导航、不新增页面概念**：它落在既有「项目实例」之上，
是一层 `Module（周）→ Session（每节课 1h）→ Objective（目标）` 的 DAG + 排期。
产品文档 4.5 的「我的项目工作台」就是它的宿主。

---

## 1. 目标拆成的模型（以 Python 小游戏为例）

```
LearningGoal          兴趣 + 目标作品 + 4|8 周 + 每节 60 分钟
└── Module[]          一周一个（或 4 周计划里一周两个）
    └── Session[]     每节 60 分钟 = 复习 + 理论 + 检查 + 实践
        ├── reviewBlock    0–15 min  间隔复习（来自 scheduler）
        ├── theoryBlock    objectives: memory | concept
        ├── theoryCheck    出题 + 服务端判分  ──► TheoryMastered
        └── practiceBlock  objectives: procedure | design，产出 evidence
```

### 每节 60 分钟的默认切分（可配置，后段向实践倾斜）

| 阶段 | 4 周计划 | 8 周计划 | 说明 |
|---|---|---|---|
| 复习 | 10 min | 10 min | 到期知识点；无到期则为 0，时间给理论 |
| 理论 | 25 min | 20 min | 苏格拉底式讲解，1–5 档提示阶梯 |
| 检查 | 10 min | 10 min | 出题 + 服务端判分 → 决定本节实践是否解锁 |
| 实践 | 15 min | 20 min | 动手任务 + 证据（截图/代码/文字） |

### 8 周 Python 小游戏示例（默认按每周 1 节，共 8 节）

| 周 | 理论目标（memory / concept） | 实践目标（procedure / design） | 本节产出 |
|---|---|---|---|
| 1 | 变量、`print`、`input`；程序是顺序执行的 | 跑通一个交互脚本 | 猜数字 v1 |
| 2 | 条件 `if`；循环 `while`/`for` | 用循环重写并限制次数 | 猜数字 v2 |
| 3 | 列表与字典；坐标是「一对数」 | 用 list 存蛇身坐标 | 蛇的数据结构 |
| 4 | 函数 `def`；模块与 `import random` | 拆出 `move()` / `draw()` | 可复用的函数骨架 |
| 5 | 屏幕与坐标系；帧与刷新 | 初始化 pygame，画蛇和食物 | 能画出画面 |
| 6 | 事件与输入；方向是状态 | 键盘控制转向 | 蛇能转向 |
| 7 | 碰撞检测；游戏状态机 | 吃食物增长、撞墙结束 | 完整可玩 |
| 8 | 计分与难度；可读性重构 | 打磨、写作品说明、发布 | 展厅里的作品 |

4 周计划 = 上述两两合并（1+2 / 3+4 / 5+6 / 7+8），理论深度下降、每节实践时间上升到 25–30 min。
**这是默认建议，不是定论**——见第 8 节确认门。

---

## 2. DT → 我们的映射表（每条带证据路径）

| # | DT 机制 | 证据 | 我们怎么用 | 落点 |
|---|---|---|---|---|
| 1 | 类型化掌握门槛：量化 `memory/procedure = 0.9`，质化 `concept/design` 只看布尔 | `learning/policy.py` | 决定「本节理论是否过关 → 解锁实践」 | `mastery/` |
| 2 | 近期加权掌握度 `(0.5,0.7,0.85,0.95,1.0)` + 置信上限 `{1:0.5, 2:0.8}` | `learning/mastery.py` | 一次答对不能过关 | `mastery/` |
| 3 | 四类目标 `memory/concept/procedure/design` | `learning/models.py:24` | 每个 Objective 分类，决定用哪种门槛、哪种题型 | `contracts` + `curriculum/` |
| 4 | 服务端答案 key + 题面投影剥离答案 | `learning/question_card.py`、`pending.py:public_pending_question` | 出题接口**永不**下发 `expectedAnswer/explanation` | `questions/` |
| 5 | 确定性判分：选择精确、短答 ≤30 字符精确或相似度 ≥0.85、开放关键词重合 ≥0.6 | `learning/grading.py` | 判分放服务端，可复现、可审计 | `grading/` |
| 6 | 每路径同时只有一道未答题，跨轮持久 | `learning/models.py` `PendingQuestion` | `answer_pending` 是最高优先级，不答完不推进 | `mastery/` + `plan-api` |
| 7 | 模式与调用时工具准入 `outline/study/review` | `capabilities/mastery/mode.py` | 三种会话模式；不同模式下允许的教学动作不同 | `curriculum/` + `pedagogy/` |
| 8 | Feynman 检查作为质化门槛 | `capabilities/mastery/tools.py:1256`、`learning/prompts/en.yaml:feynman` | `concept/design` 类目标用「讲给我听」通过 | `mastery/` + `tutor-ui` |
| 9 | 间隔复习序列 + 提示/尝试扣分 | `learning/scheduler.py`；`_resolved_quality()` 扣 `min(0.25, hints*0.08)`、`min(0.2,(attempts-1)*0.05)` | 每节课开头 10 分钟复习；用阶梯次数扣质量分 | `mastery/` |
| 10 | 错误分类 + 补救 `structural/deviation/application/metacognitive` | `learning/models.py:36`、`learning/prompts/en.yaml:error_diagnosis` | 错题归类 → 生成补练 → 班主任可见 | `grading/` |
| 11 | 学习者 intake 画像 `prior_knowledge/target_level/time_budget/preferences` | `learning/models.py:LearnerProfile`、`_profile_status()` | 首次进入先做 intake，再生成计划 | `curriculum/` |
| 12 | 只给「学习者会问的问题」，绝不给答案，且必须问号结尾 | `services/mastery_hints.py` | 强化我们 level 1 的行为约束 | `pedagogy/` |
| 13 | 难度由模型在模板内选择，3 阶段 `explore → plan → quiz_step`，主题唯一、不重复题干 | `agents/question/prompts/en/pipeline.yaml` | 计划生成与出题都用「先探索后定模板」两阶段 | `curriculum/` + `questions/` |
| 14 | 解题脊柱 `solve_plan(steps[{goal}])` 2–6 步 + 预算内 replan | `capabilities/solve/tools.py` | 实践任务拆步；用于 level 4「部分示范」，不是阶梯本身 | `pedagogy/` |
| 15 | 提示词按**命名块**组装并记录版本 | `agents/loop/prompt_blocks.py` | prompt builder 分块 + `prompt_version` | `pedagogy/` |

**不移植清单（明确只留想法）：** `knowledge/`、`services/rag/pipelines/lightrag/*`、
`services/memory/**` L1→L2→L3、`learning/storage.py`(86KB SQLite)、
`MasteryPathLease`/`MasteryEvent`/migrations/event hub、`agents/math_animator`、
`capabilities/audio_overview`、`video_learning`、partner IM、多用户 `skill_access.py`。
14 个 mastery tool 里只有 `status/quiz/grade/assess/defer/revise` 有教学价值。

---

## 3. 数据模型（TS，已按本项目调整）

```ts
type KnowledgeType = 'memory' | 'concept' | 'procedure' | 'design';
type ObjectiveStatus = 'new' | 'learning' | 'mastered';
type NextAction = 'answer_pending' | 'review' | 'probe' | 'practice' | 'assess' | 'complete';
type SessionMode = 'outline' | 'study' | 'review';   // DT 的 tool admission 模式
type QuestionKind = 'choice' | 'short' | 'open';

interface Objective {
  id: string;
  moduleId: string;
  name: string;
  type: KnowledgeType;
  prerequisiteIds: string[];      // 前置目标，未掌握不得排入本节
  objective: string;              // 一句话「能力」，不是话题清单
}

interface LessonModule { id: string; name: string; weekIndex: number; objective: string; objectives: Objective[] }

interface SessionBlock { kind: 'review' | 'theory' | 'check' | 'practice'; minutes: number }

interface LessonSession {
  id: string;
  moduleId: string;
  index: number;                  // 第几节课
  blocks: SessionBlock[];         // 合计 = 60
  theoryObjectiveIds: string[];
  practiceObjectiveIds: string[];
  mode: SessionMode;
}

interface LearningPlan {
  id: string;
  studentId: string;
  projectId: string | null;       // 学生确认意图后才有
  interest: string;
  goal: string;
  weeks: 4 | 8;
  minutesPerSession: number;      // 默认 60
  templateVersion: string;        // 冻结引用，创建后不变
  modules: LessonModule[];
  sessions: LessonSession[];
  createdAt: string;
}

interface AttemptEvidence {
  id: string; objectiveId: string; questionId: string;
  isCorrect: boolean; userAnswer: string; result: 'correct' | 'incorrect' | 'partial';
  assessmentType: 'quiz' | 'qualitative' | 'review';
  errorType?: 'structural' | 'deviation' | 'application' | 'metacognitive';
  hintsUsed: number; attemptCount: number; quality?: number;
  createdAt: string;
}

interface RepetitionState {
  objectiveId: string;
  intervalIndex: number; consecutiveCorrect: number; consecutiveWrong: number;
  nextReviewAt: string | null; difficulty: number;
  stability: number; retrievability: number; desiredRetention: number;
  reviewCount: number; lapseCount: number;
}

interface NextStep {
  action: NextAction;
  moduleId: string; objectiveId: string; knowledgeType: KnowledgeType;
  status: ObjectiveStatus; gate: 'qualitative' | 'quantitative';
  mastery: number; threshold: number; reason: string; forgettingRisk: number;
}

interface PendingQuestion {          // 服务端持有，含答案
  questionId: string; objectiveId: string; prompt: string; questionType: QuestionKind;
  expectedAnswer: string;           // 绝不下发
  options: Array<{ id: string; label: string; body: string }>;
  explanation: string;              // 判分后才释放
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface PublicQuestion {           // 下发客户端的投影
  questionId: string; prompt: string; questionType: QuestionKind;
  options: Array<{ id: string; label: string; body: string }>;
  allowFreeText: true; attempt: number;
}

interface LearnerProfile {
  priorKnowledge: string | null; targetLevel: string | null;
  timeBudget: string | null; preferences: string | null;
  interestTags: string[]; updatedAt: string;
}
```

### 移植注意

- DT 的 `difflib.SequenceMatcher.ratio()` 在 TS 里用 `2*M/T` 等价实现（编辑距离/公共子序列），
  阈值沿用 **0.85** 且仅当期望答案 ≤30 字符；开放题沿用关键词重合 **≥0.6**。
- 间隔序列沿用 DT 的按类型序列：`memory: 0,1,3,7,14,30,60`，`design: 14,28`；
  每周只上 1–2 节课时，实际间隔要按**课次索引**而非自然日映射，否则 4 周计划复习点会错位。
- 掌握度权重与置信上限**逐字沿用**，否则「一次答对就过关」会立刻破坏 `TheoryMastered` 的严肃性。

---

## 4. 推进算法（`next_step` 优先级）

```
answer_pending                       ← 有未答题，先答
  → review                           ← 有到期复习（forgettingRisk 高）
  → 顺序取第一个未掌握目标：
        status = new        → probe   （探测，不直接讲）
        type  ∈ concept|design → assess（Feynman 质化检查）
        其它                → practice
  → complete                         ← 全部掌握且无到期复习
```

门槛：

- 量化门槛 `memory | procedure`：近期加权掌握度 **≥ 0.9**；
- 质化门槛 `concept | design`：存一个布尔，由 Feynman `mastery_assess` 置位；
- 置信上限 `{1: 0.5, 2: 0.8}`：作答次数不足时即使全对也不能过 0.9。

**与产品文档 `TheoryMastered` 的对齐：** 本文的「本节理论目标全部达标」触发
`TheoryMastered` 事件；该事件仍然**服务端产生**，仍然是进入实践阶段的唯一解锁条件。
差别只是：DT 用掌握度**重算**，产品文档用阶段游标。我们同时保留两者——
**游标用于状态展示与审计，掌握度用于决定下一节课排什么**。

---

## 5. 与现有硬规则的衔接（不可违反）

| 硬规则 | 本设计的处理 |
|---|---|
| `TheoryMastered` 前不得实践 | `practiceBlock` 在理论目标未达标时不排入；服务端再次校验 |
| 学生未确认意图不得创建正式项目 | 计划先生成 `LearningPlan`，`ConfirmIntent` 后才创建 `projectId` 并冻结 `templateVersion` |
| 项目状态 / AI 决策 / 成长档案 / 审计**不能由客户端写入** | 判分、掌握度、`stageAfter`、`TheoryMastered`、升级全部服务端计算 |
| 一个学生同一时间只有一个当前班主任 | 升级待办走既有班主任分配模型 |
| 未成年人数据最小可见 | 题面投影不含答案；成长快照不含原始对话；画像只存 intake 自由文本与带证据的目标 |
| 写操作幂等 | `POST /answers` 用幂等键；计划生成用 `(studentId, interest, weeks)` 去重 |

---

## 6. 提示阶梯的取舍（关键差异，必须写进规格）

DT 的 `ask_hints` 只生成「一个学习者会问的问题」，且 `_sanitize` 强制以 `?`/`？` 结尾。
它**没有**分级脚手架。所以：

- **保留我们的 1–5 档**：`1 提问 / 2 思考方向 / 3 关键线索 / 4 部分示范 / 5 必要解释`；
- level 1 的行为**吸收 DT 的约束**：只能问，必须问号结尾，不得含断言式解法；
- level 4「部分示范」的步骤拆分**借鉴 DT `solve_plan`**（2–6 步、每步一个 goal、有重规划预算）；
- `hintsUsed` 同时进入 DT 式的**判分质量扣分**（`min(0.25, hints*0.08)`）——
  提示用得越多，掌握度越难达标，这正好让阶梯"有代价"。

---

## 7. 新增角色与工作流增量

在既有 `/tutor-engine` 上增加一个切片 `curriculum`，新增 5 个有界角色。
这 5 个角色与其他角色一样**默认** `deepseek/deepseek-flash` + `thinking: off`；
需要更强推理时在单次 spawn 里显式传 `deepseek/deepseek-v4-pro` + `high|max`（见
[`student-agent-design.md`](student-agent-design.md) 第 6 节）。

| 角色 | 默认模型 | 拥有的目录 |
|---|---|---|
| `curriculum-planner` | `flash` / `off` | `packages/ai-client/src/curriculum/**` |
| `mastery-engine` | `flash` / `off` | `packages/ai-client/src/mastery/**` |
| `question-bank` | `flash` / `off` | `packages/ai-client/src/questions/**` |
| `grading-remediation` | `flash` / `off` | `packages/ai-client/src/grading/**` |
| `plan-api` | `flash` / `off` | `services/api/src/modules/learning-plan/**` |

**计划生成的运行时约束**（写进 `curriculum-planner` 的规格）：

- 两阶段：先 `explore`（澄清兴趣与先验），后 `plan`（产出结构化计划）；
- **原始模型输出一律不可信**：必须通过服务端 schema 校验（周数 × 每节 60 分钟、
  每节 ≤4 个目标、objective 类型合法、前置无环），校验失败即拒绝并重试，不静默修补；
- 兴趣标签不能直接覆盖长期兴趣档案（对齐产品文档 4.3）；
- 生成结果落库并冻结 `templateVersion`，之后不可漂移。

---

## 8. 确认门（必须先问用户）

1. **课时密度**：「1 小时 × 4/8 周」是**每周 1 节**（→ 4/8 节课），还是每周 2–3 节
   （→ 更多课时）？这直接决定目标数量和每周理论/实践配比。
2. **先理论后实践的含义**：是**每节课内**先理论再实践（本设计的默认），
   还是**整个项目**前几周纯理论、后几周纯实践？两者是很不同的产品。
3. **计划宿主页面**：计划落在「我的项目」工作台内（不改导航），
   还是需要在「今天」露出今日课？任何新增导航都必须先改产品文档并评审。
4. **多模板范围**：首期是否只支持 Python/编程类兴趣，还是要求兴趣领域无关的通用目标词表？

---

## 9. 落地顺序（把 M4 拆成可交付的三步）

1. **步 1（最小闭环）**：`intake → 8 周计划生成 → 计划落库 → 我的项目展示`
   （`curriculum-planner` + `plan-api` + 一个 student-center `plan` 视图）。
2. **步 2（教学闭环）**：`mastery-engine` + `question-bank` + `grading-remediation`
   + `tutor-pedagogy` 的 1–5 阶梯 → 理论检查能真正卡住实践。
3. **步 3（长期闭环）**：`scheduler` 间隔复习 + 错误归类 + 班主任升级联动。

先做步 1 就能看到「输入兴趣 → 4/8 周计划」的完整效果，且不碰任何硬规则。
