# Artifact contracts — tutor-engine

下游步骤会解析这些文件。**逐字遵守**。未知值写 `null`，**绝不**猜。
所有产物位于运行目录 `.pi/runs/YYYY-MM-DD-<slug>/`。
QA 与评审产物的形状与 `../student-module/references/contracts.md` 相同。

---

## `brief.json` — Phase 0，父会话写

```json
{
  "slice": "all",
  "slug": "tutor-engine-m4",
  "created_at": "YYYY-MM-DD",
  "product_doc_sections": ["4.4", "9.3", "9.4", "9.5"],
  "in_scope": ["context_packet", "苏格拉底提示阶梯", "卡顿升级"],
  "out_of_scope": ["语音 ASR/TTS 实现", "向量检索"],
  "reference": "HKUDS/DeepTutor",
  "acceptance_focus": [
    "默认不输出完整答案",
    "每轮带阶段与提示等级",
    "连续 4 轮卡顿生成班主任待办"
  ],
  "notes": null
}
```

`slice` 取值：`pedagogy` / `context` / `api` / `escalation` / `curriculum` / `all`。

---

## `recon-deeptutor.md` — Phase 1，`scout` 写

每个机制一段，**必须带文件路径证据**：

```markdown
## <mechanism name>
- What it does:
- Evidence: <repo path>
- Minimal fields:
- Port? yes/no — reason
```

没有证据的机制不得进入 `pedagogy-spec.md`。

---

## `pedagogy-spec.md` — Phase 2，`tutor-pedagogy` 写（决策完备）

必须包含以下小节，缺一不可：

### 1. pedagogic_move 词表与转移规则
每个 move 的名字、含义、允许的下一步。

### 2. 提示阶梯
| level | 名称 | 触发条件 | 允许输出 | 禁止输出 |
|---|---|---|---|---|
| 1 | 提问 | 默认 | 开放式问题 | 任何解法 |
| 2 | 思考方向 | 学生答偏/无进展 | 方向性提示 | 关键步骤 |
| 3 | 关键线索 | 仍无进展 | 一个关键线索 | 完整步骤 |
| 4 | 部分示范 | 仍无进展 | 部分步骤示范 | 完整答案 |
| 5 | 必要解释 | 阶梯耗尽 | 解释 | — |

必须写明：**一次只升 1 级**，不得跳级；level 5 不得作为默认。

### 3. 答案泄露防护
默认关闭的 escape hatch 及其**唯一**例外条件；哪些输入（"直接给答案"、角色扮演、
忽略指令）不得触发它。

### 4. 引导预算
单题最多 **6** 轮连续引导；耗尽后的唯一去向（level 5 或升级），不得循环。

### 5. 轮次记录字段
`pedagogic_move` · `hint_level` · `expected_evidence` · `stage_before` ·
`stage_after` · `prompt_version` · `evidence_ref` —— 每个字段的类型与来源。

### 6. 提示词结构
角色、禁止事项、语言（中文）、输出形状、`prompt_version` 命名规则。

### 7. context_packet 边界
本模块产出什么、向 `tutor-context` 要什么，二者不重叠。

### 8. 不移植清单
DeepTutor 中 Python / RAG / 向量库 / 插件 / 多用户 相关部分，明确不照搬。

### 9. Open Questions
需要产品取舍的条目，不得静默决定。

---

## `api-spec.md` — Phase 2，`student-planner` 写

- 接口清单（method / path / request / response / error codes），每条标
  `existing`（带 `path:line`）或 `gap`；
- 对象级授权规则（学生仅自己会话；班主任仅当前分配学生；越权 403）；
- 幂等键：`POST /turns` 必填，重放返回首次结果；
- 流式契约：resume cursor、sequence number、断线降级为文字；
- 持久化的轮次形状；
- 审计事件清单。

---

## `TurnRecord` — 服务端持久化，每个轮次一条

```ts
interface TutorTurnRecord {
  turnId: string;
  sessionId: string;
  sequence: number;              // 会话内单调递增，用于去重
  pedagogicMove: string;
  hintLevel: 1 | 2 | 3 | 4 | 5;
  expectedEvidence: string | null;
  stageBefore: string;
  stageAfter: string;            // 服务端决定，客户端不可写
  promptVersion: string;
  evidenceRef: string | null;
  createdAt: string;             // ISO 8601
}
```

**不变量：** `hintLevel` ∈ 1..5；`stageAfter` 由服务端写入；同一
`(sessionId, sequence)` 只能存在一条；客户端不能直接写任何字段。

---

## `ContextPacket` — `tutor-context` 产出

```ts
interface TutorContextPacket {
  project: { id: string; title: string } | null;
  stage: string;
  task: { id: string; title: string } | null;
  recentSummary: { text: string; sourceTurnIds: string[] } | null;
  masteredConcepts: Array<{ concept: string; evidenceRef: string }>;
  misconceptions: Array<{ concept: string; evidenceRef: string }>;
  interests: Array<{ tag: string; evidenceRef: string | null }>;
  mentorInterventions: Array<{ id: string; summary: string }>;
  allowedTools: string[];
  safetyPolicy: { allowFullAnswer: false; maxGuidanceTurns: 6 };
  dropped: string[];             // 因证据缺失或超限而省略的字段
}
```

**不变量：** 不含完整历史对话；每个长期画像断言必须有 `evidenceRef` 或人工确认，
否则放进 `dropped`；JSON 可序列化；不含密钥与未成年人原始对话/语音。

---

## `EscalationEvent` — `tutor-escalation` 产出

```ts
interface TutorEscalationEvent {
  idempotencyKey: string;   // 由 (sessionId, trigger, windowStart, windowEnd) 派生
  sessionId: string;
  trigger: 'consecutive_stalls' | 'frustration' | 'ai_cannot_advance';
  stallCount: number;       // 达到阈值时为 4
  windowTurnIds: string[];
  hintLevels: Array<1 | 2 | 3 | 4 | 5>;
  stage: string;
  createdAt: string;
}
```

**不变量：** 同一 `idempotencyKey` 只能生成一个班主任待办与一条审计事件；
3 轮卡顿不触发；不含对学生的心理判断；不含原始对话。

---

## `curriculum-spec.md` — Phase 2，`curriculum-planner` 写（决策完备）

仅 `curriculum` 切片。必须包含以下小节，缺一不可：

### 1. 计划形状
`LearningPlan` / `LessonModule` / `LessonSession` / `Objective` 的字段与
`templateVersion` 冻结时机。

### 2. 60 分钟分块表
4 周与 8 周各一张 block 表（复习/理论/检查/实践），并写明实践占比如何逐周上升。
必须满足：**每节 block 分钟数之和精确等于 60**。

### 3. 生成契约
`explore → plan` 两阶段；模型输出为**不可信输入**，必须逐条校验：
`weeks ∈ {4,8}`；block 和 = 60；每节 ≤4 个目标；`KnowledgeType` 合法；
前置图无环；**不得把实践目标排在它的理论前置之前**。校验失败 → 拒绝并重试，
**不得静默修补**。

### 4. 理论 → 实践不变量
本节理论目标全部达标 → 服务端发 `TheoryMastered` → 才解锁 `practiceBlock`。
写明它与产品文档阶段游标的关系（游标用于展示/审计，掌握度用于决定下一节排什么）。

### 5. 掌握度门槛
量化 `memory|procedure ≥ 0.9`；质化 `concept|design` 为存储布尔；
权重 `(0.5,0.7,0.85,0.95,1.0)`；置信上限 `{1:0.5, 2:0.8}`。

### 6. 复习调度
按类型间隔序列，且因为课次是每周一次，间隔需映射到**课次索引**而非自然日。

### 7. intake 画像
字段、何时要求 intake、未填时的降级行为。

### 8. 移植映射
逐条列出移植的 DeepTutor 机制及**源文件路径**；逐条列出不移植项及理由。

### 9. Open Questions
课时密度、先理论后实践的含义、计划宿主页面、模板范围等必须用户拍板的条目。

---

## `LearningPlan` — 服务端持久化（`plan-api` 写入）

```ts
interface LearningPlan {
  id: string;
  studentId: string;
  projectId: string | null;      // 仅 POST /confirm 之后非空
  interest: string;
  goal: string;
  weeks: 4 | 8;
  minutesPerSession: 60;
  templateVersion: string;       // 确认后冻结，不可漂移
  modules: LessonModule[];
  sessions: LessonSession[];
  createdAt: string;
}
```

**不变量：** 生成时 `projectId` 必须为 `null`；确认后模块/会话/目标顺序不可改写；
重规划只能产生新版本；`weeks` 只能是 4 或 8。

---

## `QuestionCard` / `PublicQuestion` — 答案边界

```ts
interface QuestionCard {          // 仅服务端持有
  questionId: string; objectiveId: string; prompt: string;
  questionType: 'choice' | 'short' | 'open';
  expectedAnswer: string;
  options: Array<{ id: string; label: string; body: string }>;
  explanation: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface PublicQuestion {         // 唯一允许下发的形状
  questionId: string; prompt: string;
  questionType: 'choice' | 'short' | 'open';
  options: Array<{ id: string; label: string; body: string }>;
  allowFreeText: true; attempt: number;
}
```

**不变量：** 任何学生可见响应都不得包含 `expectedAnswer` / `explanation`
或其子串；`GradeResult` 是唯一允许携带这两者的对象，且只在判分完成之后。

---

## `GradeResult` / `ErrorRecord` — `grading-remediation` 产出

```ts
interface GradeResult {
  questionId: string; objectiveId: string;
  result: 'correct' | 'incorrect' | 'partial';
  expectedAnswer: string;        // 仅此处释放
  explanation: string;           // 仅此处释放
  errorType: 'structural' | 'deviation' | 'application' | 'metacognitive' | null;
  remediation: string | null;    // result !== 'correct' 时必填
}
```

**不变量：** `choice` 不产生 `partial`；判错时 `errorType` 与 `remediation` 缺一即为 bug；
拒绝为非 `AWAITING` 的题目判分；阈值：短答相似度 ≥ 0.85 且期望答案 ≤ 30 字符，
开放题关键词重合 ≥ 0.6。

---

## `NextStep` — `mastery-engine` 产出

```ts
interface NextStep {
  action: 'answer_pending' | 'review' | 'probe' | 'practice' | 'assess' | 'complete';
  moduleId: string; objectiveId: string;
  knowledgeType: 'memory' | 'concept' | 'procedure' | 'design';
  status: 'new' | 'learning' | 'mastered';
  gate: 'qualitative' | 'quantitative';
  mastery: number; threshold: number; reason: string; forgettingRisk: number;
}
```

**不变量：** 优先级固定为
`answer_pending → review → 首个未掌握目标 → complete`；
每次决策必须带 `reason`；`concept|design` 的 `gate` 必为 `qualitative`。

---

## 通用规则

- 未知值写 `null`，不要猜。
- 每个代码事实带 `path:line`。
- 不把密钥、token、真实未成年人原始对话/语音写进任何产物。
- 修复轮**追加**到 `qa-report.md` / `review.md`，不要覆盖首轮。
- 产品文档里没有的数据来源，标为 Open Question，不得伪造字段。
