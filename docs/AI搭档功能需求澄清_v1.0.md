# AI 搭档功能需求澄清文档 v1.0

> 基于 `docs/AI教育平台前后端开发文档_v1.0.md` 和 `AGENTS.md` 约束
>
> 生成时间：2024-09-29
>
> 状态：待产品评审确认

---

## 📋 文档说明

本文档通过 **grill-me 式提问**，对 AI 搭档功能的关键决策点进行澄清。以下答案基于：
1. 现有产品文档的明确约束
2. AGENTS.md 的安全规则
3. 教育产品最佳实践的合理推断

**标注说明：**
- ✅ **已明确**：文档中有明确规定
- 🟡 **推断**：基于文档合理推断，需确认
- 🔴 **待定**：需产品决策

---

## 1️⃣ 会话生命周期

### Q1: 会话是如何创建的？

**答案（🟡 推断）：**

**每个项目阶段一个会话**

**理由：**
- 文档提到"围绕当前项目阶段"
- 符合教育场景：理论学习、实践探索、作品完善每个阶段的对话主题不同
- 便于班主任按阶段查看学生的学习轨迹

**实现细节：**
```typescript
interface TutorSession {
  id: string
  studentId: string
  projectId: string
  projectStage: 'theory' | 'practice' | 'refinement' // 当前阶段
  startedAt: Date
  lastActiveAt: Date
  status: 'active' | 'completed' | 'escalated'
  hintLevel: 1 | 2 | 3 | 4 | 5 // 当前提示等级
  stuckCount: number // 连续卡顿次数
}
```

**创建时机：**
1. 学生首次进入该项目的某个阶段时
2. 或学生点击"开始与 AI 对话"按钮

---

### Q2: 会话何时结束？

**答案（🟡 推断）：**

**不主动结束，但标记为"非活跃"**

**理由：**
- 教育场景需要保留完整对话历史
- 学生可能中断后继续学习
- 符合"刷新后可恢复"的需求

**状态转换：**
```
active（活跃）
  → 学生 30 分钟无操作 → inactive（非活跃，可恢复）
  → 进入下一阶段 → completed（已完成）
  → 触发班主任介入 → escalated（已升级）
```

**前端行为：**
- 刷新页面：恢复最近的 `active` 或 `inactive` 会话
- 进入新阶段：自动结束旧会话，创建新会话
- 显式"结束对话"：标记为 `completed`（可选功能）

---

### Q3: 历史会话如何查看？

**答案（✅ 已明确 + 🟡 推断）：**

**分角色查看权限：**

| 角色 | 可见范围 | 备注 |
|------|---------|------|
| **学生** | 自己所有项目的所有会话 | 完整对话记录 |
| **家长** | 孩子所有项目的**脱敏摘要** | 不默认显示原始对话（AGENTS.md） |
| **班主任** | 分配学生的所有会话（完整） | 包含 AI 推理等级和卡顿标记 |
| **管理员** | 按审计需要查询 | 仅用于质量审查和安全合规 |

**前端入口：**
- 学生："我的项目" → 项目详情 → "对话记录"
- 家长："学习进展" → 项目卡片 → "查看学习过程"（显示成长快照 + 对话摘要）
- 班主任："学生管理" → 学生详情 → "AI 对话记录"

---

## 2️⃣ 上下文与状态

### Q4: "围绕当前项目阶段"是如何体现的？

**答案（🟡 推断）：**

**AI 上下文包含以下信息：**

```typescript
interface TutorContext {
  // 项目基础信息
  projectId: string
  projectTitle: string
  projectTemplate: ProjectTemplate // 项目模板（学习目标、知识点）
  
  // 当前阶段信息
  currentStage: 'theory' | 'practice' | 'refinement'
  stageGoals: string[] // 本阶段学习目标
  requiredKnowledge: string[] // 必备知识点
  
  // 学生状态
  completedTasks: Task[] // 已完成任务
  currentTask?: Task // 当前任务
  masteredConcepts: string[] // 已掌握的知识点
  
  // 学习进度
  theoryMastered: boolean // 理论是否掌握（决定能否进入实践）
  attemptsCount: number // 尝试次数
  recentArtifacts: Artifact[] // 最近提交的作品
}
```

**体现方式：**
1. **提示词前缀**：
   ```
   你是一位苏格拉底式 AI 导师，正在帮助学生完成项目「${projectTitle}」的「${stageGoals}」阶段。
   学生当前正在尝试「${currentTask.title}」。
   已掌握的知识点：${masteredConcepts.join(', ')}。
   ```

2. **动态调整提问**：
   - 理论阶段：侧重概念理解、原理解释
   - 实践阶段：侧重实现思路、调试方法
   - 完善阶段：侧重优化建议、总结反思

---

### Q5: 如果学生同时有多个项目，AI 如何选择上下文？

**答案（✅ 已明确 + 🟡 推断）：**

**学生需要先选择项目**

**前端流程：**
```
1. 学生点击"AI 搭档"导航
   ↓
2. 如果有多个进行中的项目，显示项目选择器：
   "你想讨论哪个项目？"
   - [项目A：智能计算器] 当前阶段：实践
   - [项目B：天气预报应用] 当前阶段：理论
   ↓
3. 学生选择后，进入该项目的 AI 对话界面
   ↓
4. 顶部显示当前项目上下文横幅（TutorContextBanner）
```

**切换项目：**
- 学生可随时点击顶部横幅切换项目
- 切换时保存当前会话，加载目标项目的会话

---

### Q6: 理论检查（TheoryCheck）是什么触发的？

**答案（🟡 推断）：**

**混合触发机制**

**触发方式 1：AI 对话判断（主要）**
- AI 通过多轮提问评估学生理解程度
- 当 AI 判断学生掌握核心概念后，显示"理论检查"按钮
- 学生点击后，AI 进行最后的综合性提问（3-5 个问题）
- 全部答对 → `theoryMastered = true`，解锁实践阶段

**触发方式 2：学生主动申请（辅助）**
- 学生可以主动点击"我觉得我学会了，进行测试"
- AI 进行同样的综合性提问

**前端组件 TheoryCheck：**
```typescript
interface TheoryCheckProps {
  visible: boolean // AI 判断是否显示
  questions: TheoryQuestion[] // AI 生成的检查题
  onComplete: (passed: boolean) => void
}
```

**约束（✅ AGENTS.md）：**
- `theoryMastered` 之前**不得进入实践阶段**
- 理论检查结果由后端判定，前端不能伪造

---

### Q7: 任务证据面板（TaskEvidencePanel）的作用？

**答案（🟡 推断）：**

**展示 + AI 初步反馈，最终评审由班主任**

**功能设计：**

1. **展示学生提交的证据**
   ```typescript
   interface TaskEvidence {
     taskId: string
     artifacts: Artifact[] // 代码文件、截图、演示视频
     submittedAt: Date
     studentNote?: string // 学生自述
   }
   ```

2. **AI 初步反馈（非评分）**
   - AI 检查：代码是否能运行、是否包含关键逻辑
   - AI 提示：发现的明显问题（如语法错误）
   - **不给出最终评价**：避免 AI 替代人工评审

3. **班主任评审入口**
   - 状态显示："待 AI 分析" → "待班主任评审" → "已通过/需修改"
   - 班主任可以看到 AI 的初步分析，但最终决策由人做出

**权限（✅ AGENTS.md）：**
- AI 不能直接修改项目状态（如"任务已完成"）
- AI 可以生成评审建议草稿，写入 `ai_feedback` 表
- 班主任确认后，才更新 `task.status` 和 `growth_snapshots`

---

## 3️⃣ 提示等级逻辑

### Q8: 提示等级如何升级？

**答案（🟡 推断）：**

**自动升级 + 学生主动请求**

**自动升级规则：**
```typescript
interface HintLevelRule {
  condition: string
  action: 'increase' | 'decrease'
}

const rules: HintLevelRule[] = [
  // 升级条件
  { condition: '连续 2 轮学生回答偏离方向', action: 'increase' },
  { condition: '学生明确表示困惑（"我不懂"、"不会"）', action: 'increase' },
  { condition: '当前等级停留超过 3 轮仍无进展', action: 'increase' },
  
  // 降级条件
  { condition: '学生连续 2 轮正确回答', action: 'decrease' },
  { condition: '学生主动提出深入问题', action: 'decrease' },
]
```

**学生主动请求：**
- 界面显示"需要更多提示吗？"按钮
- 点击后 AI 提升一级，并说明原因：
  ```
  好的，我给你一些更具体的方向：[等级 2 提示内容]
  ```

**等级说明（✅ 文档已明确）：**
```
等级 1：提出问题（"你觉得这段代码需要做什么？"）
等级 2：给出思考方向（"可以考虑循环和条件判断"）
等级 3：给出关键线索（"你需要一个 for 循环遍历数组"）
等级 4：展示部分方法（"可以使用 array.filter() 方法"）
等级 5：进行必要解释（展示伪代码，但不给完整实现）
```

**硬性规则（✅ 文档）：**
- 默认**禁止直接输出完整答案**
- 单个问题最多连续引导 **6 轮**
- 超过 6 轮仍无进展 → 生成班主任待办

---

### Q9: "连续 4 轮卡顿"如何检测？

**答案（🟡 推断）：**

**综合检测机制**

**检测维度：**

1. **时间维度（沉默卡顿）**
   ```typescript
   // 学生超过 5 分钟无回复
   if (now - lastMessageTime > 5 * 60 * 1000) {
     stuckCount++
   }
   ```

2. **内容维度（困惑表达）**
   ```typescript
   const confusionKeywords = [
     '不懂', '不会', '不明白', '看不懂',
     '什么意思', '听不懂', '太难了'
   ]
   
   if (studentMessage.includes(confusionKeywords)) {
     stuckCount++
   }
   ```

3. **重复维度（原地打转）**
   ```typescript
   // 学生连续 3 轮回答相似内容（余弦相似度 > 0.8）
   if (isSimilarToRecentMessages(currentMessage, recentMessages, 3)) {
     stuckCount++
   }
   ```

4. **情绪维度（挫败检测）**
   ```typescript
   const frustrationKeywords = [
     '烦死了', '不想学了', '太难了',
     '为什么这么难', '我不行'
   ]
   
   if (studentMessage.includes(frustrationKeywords)) {
     emotionalDistress = true
     stuckCount += 2 // 情绪问题权重更高
   }
   ```

**触发阈值（✅ 文档）：**
- `stuckCount >= 4` **或** `emotionalDistress == true`
- 触发后立即生成班主任待办

---

### Q10: 生成班主任待办后会发生什么？

**答案（🟡 推断）：**

**AI 继续陪伴 + 异步通知班主任**

**流程设计：**

```
检测到卡顿/挫败
  ↓
1. 后端创建 Intervention 记录
   {
     type: 'stuck_on_concept',
     studentId: xxx,
     projectId: xxx,
     sessionId: xxx,
     triggerReason: '连续 4 轮卡顿于循环概念',
     priority: 'high',
     status: 'pending'
   }
  ↓
2. 前端显示 EscalationNotice 组件
   "我发现你在这个问题上遇到了困难，已经通知班主任老师，
    老师会尽快来帮助你。在等待期间，我们可以换个角度思考，
    或者先休息一下，做做其他任务。"
  ↓
3. AI 行为调整
   - 暂时降低难度，转向相关但更简单的问题
   - 或建议学生休息、做其他项目
   - 不强制结束会话（学生可能自己想通）
  ↓
4. 班主任收到通知
   - 实时推送（WebSocket）："学生 XXX 在项目 YYY 遇到困难"
   - 班主任可以：
     a) 立即介入（发送消息或语音通话）
     b) 稍后处理（标记为"已知晓"）
     c) 委托给 AI 执行预设的辅助策略
```

**班主任介入后：**
```typescript
// 方案 A：班主任接管对话
if (teacher.takeOver) {
  aiTutor.role = 'observer' // AI 静默，仅记录
  chatMode = 'teacher-led'
}

// 方案 B：班主任插话，但 AI 继续辅助
if (teacher.assist) {
  chatMode = 'collaborative' // 班主任和 AI 都可以发言
  aiTutor.role = 'assistant' // AI 补充说明
}
```

---

## 4️⃣ 语音交互

### Q11: 语音模式的具体行为？

**答案（🟡 推断）：**

**实时语音识别 + 双模式输出**

**学生输入：**
```typescript
// 实时转文字（流式识别）
speechRecognition.onResult = (interim, final) => {
  if (interim) {
    display(interim) // 显示临时识别结果
  }
  if (final) {
    sendToAI(final) // 发送最终文本给 AI
  }
}
```

**AI 输出（学生可选）：**
```typescript
interface VoiceSettings {
  outputMode: 'text' | 'speech' | 'both'
  autoPlay: boolean // 是否自动播放 AI 语音
}

// 默认推荐：both（文字 + 语音同时）
// - 文字方便学生回顾
// - 语音提升沉浸感
```

**提示等级在语音模式的变化：**
- 等级 1-3：语音和文字无差异
- 等级 4-5：如果涉及代码，自动切换到文字显示
  ```
  AI 语音："接下来我会给你一些代码示例，请看屏幕。"
  [屏幕显示代码块]
  ```

---

### Q12: 文本和语音可以混用吗？

**答案（✅ 应该支持）：**

**完全混用，实时切换**

**实现方式：**
```typescript
interface MessageInput {
  mode: 'text' | 'voice'
  content: string // 统一存储为文本
  originalAudio?: string // 如果是语音输入，保留音频 URL
}

// 切换行为
function toggleInputMode(newMode: 'text' | 'voice') {
  if (newMode === 'voice') {
    startMicrophone()
  } else {
    stopMicrophone()
    // 保留已识别的文字，学生可继续编辑
  }
}
```

**场景举例：**
1. 学生语音输入："我想做一个计算器"
2. 识别为文字后，学生发现识别错误，手动改为"我想做一个日历应用"
3. 提交修改后的文字给 AI

**上下文保留：**
- 切换模式时，当前会话的所有历史消息保留
- 语音 ↔ 文字切换无缝，AI 的上下文不丢失

---

## 5️⃣ 安全与权限

### Q13: "AI 搭档不能直接修改成长档案"的具体含义？

**答案（✅ AGENTS.md 明确）：**

**AI 只能生成草稿，不能直接写入关键业务表**

**禁止 AI 直接写入的表：**
```sql
-- 禁止直接写入
growth_snapshots          -- 成长档案
project.status           -- 项目状态转换
task.status              -- 任务完成状态
mentor_assignments       -- 班主任分配
interventions.resolution -- 干预处理结果

-- AI 可以写入的表
tutor_sessions           -- AI 会话记录
tutor_turns              -- 对话轮次
ai_feedback_drafts       -- AI 反馈草稿（待人工确认）
```

**安全实现：**
```typescript
// 后端 API 权限检查
@Post('/api/v1/growth-snapshots')
@RequireRole('teacher', 'admin') // AI 服务账号无此权限
async createGrowthSnapshot() {
  // 只有班主任和管理员能创建
}

// AI 服务只能调用
@Post('/api/v1/ai/feedback-drafts')
@RequireRole('ai-service')
async createFeedbackDraft() {
  // 创建草稿，等待人工确认
}
```

**工作流：**
```
AI 判断学生完成任务
  ↓
AI 调用 POST /api/v1/ai/feedback-drafts
  {
    "taskId": "xxx",
    "suggestedStatus": "completed",
    "reasoning": "学生提交的代码实现了所有功能"
  }
  ↓
班主任收到通知：「AI 建议标记任务为已完成」
  ↓
班主任审核后点击「确认」
  ↓
后端调用 PUT /api/v1/tasks/:id/status
  + 创建 growth_snapshot
```

---

### Q14: 学生能直接修改项目状态吗？

**答案（✅ AGENTS.md 明确）：**

**不能。项目状态转换必须由后端领域模块控制**

**状态转换规则：**
```typescript
// 前端只能请求转换，不能直接修改
class ProjectStateTransition {
  // ❌ 学生前端不能直接调用
  static async transition(projectId: string, to: ProjectStage) {
    // 必须通过后端 API
  }
  
  // ✅ 学生可以请求（但需要后端验证）
  static async requestTransition(projectId: string, reason: string) {
    // POST /api/v1/projects/:id/transition-request
    // 后端检查：theoryMastered == true 才能进入实践
  }
}
```

**实际流程：**
```
学生通过理论检查
  ↓
AI 调用后端 API：
  POST /api/v1/projects/:id/theory-check-passed
  ↓
后端验证：
  - 所有理论任务已完成？
  - AI 测试全部通过？
  ↓
后端自动转换：
  project.stage = 'practice'
  project.theoryMasteredAt = now()
  ↓
前端刷新，显示实践阶段任务
```

---

### Q15: 如果学生问"帮我写这段代码"，AI 应该如何拒绝？

**答案（✅ 文档 + 🟡 推断）：**

**不直接拒绝，转换为苏格拉底式引导**

**回复策略：**

**等级 1（最初）：**
```
"我明白你想实现这个功能。在我帮你之前，你能先告诉我，
 这段代码需要做什么吗？比如输入是什么，输出是什么？"
```

**等级 2（如果学生坚持）：**
```
"我的职责是帮助你学会思考和解决问题，而不是替你完成任务。
 让我们一起分析一下：这个问题可以分成哪几个小步骤？"
```

**等级 3（如果学生说"我真的不会"）：**
```
"好的，我给你一个思路：
 1. 首先需要获取用户输入
 2. 然后进行计算
 3. 最后显示结果
 
 你能先尝试实现第 1 步吗？"
```

**等级 4-5（学生多次卡顿）：**
```
"我给你看一个类似的例子（但不是完整答案）：
 [展示伪代码或简化版本]
 
 你能根据这个例子，修改成你需要的版本吗？"
```

**硬性红线（✅ 文档）：**
- **绝不直接输出完整可运行的代码**
- 如果学生复制粘贴 AI 的回复，代码应该是"需要学生补充关键逻辑"的不完整版本

---

## 6️⃣ 数据与监控

### Q16: 每轮对话需要记录哪些数据？

**答案（🟡 推断）：**

**完整对话日志 + 元数据**

**数据结构：**
```typescript
interface TutorTurn {
  id: string
  sessionId: string
  turnNumber: number // 第几轮对话
  timestamp: Date
  
  // 学生输入
  studentMessage: {
    content: string
    inputMode: 'text' | 'voice'
    audioUrl?: string
    thinkingTime: number // 距离上一轮的间隔（秒）
  }
  
  // AI 输出
  aiResponse: {
    content: string
    hintLevel: 1 | 2 | 3 | 4 | 5
    reasoning?: string // AI 的推理过程（可选，用于审查）
    generationTime: number // AI 生成耗时（毫秒）
  }
  
  // 上下文快照
  contextSnapshot: {
    projectStage: string
    currentTask?: string
    stuckCount: number
    emotionalState?: 'neutral' | 'confused' | 'frustrated'
  }
  
  // 标记
  flags: {
    isStuck: boolean // 本轮是否卡顿
    isBreakthrough: boolean // 本轮是否有突破（学生理解了关键概念）
    needsReview: boolean // 是否需要班主任人工审查
  }
}
```

**存储策略：**
- 热数据（最近 7 天）：存 PostgreSQL
- 归档数据（7 天以上）：转存对象存储（S3），保留检索索引

---

### Q17: 家长能看到 AI 对话的什么内容？

**答案（✅ AGENTS.md 明确）：**

**脱敏后的成长快照 + 对话摘要，不显示原始对话**

**家长视图设计：**

```typescript
interface ParentView {
  // ✅ 家长可见
  growthSnapshot: {
    date: Date
    projectTitle: string
    stage: string
    achievements: string[] // "掌握了循环概念"
    challenges: string[] // "在条件判断上遇到困难"
    aiSupportSummary: string // "本周 AI 辅导 3 次，共 45 分钟"
  }
  
  // ✅ 家长可见（简化版）
  conversationSummary: {
    topic: string // "讨论了如何实现计算器的加法功能"
    duration: number // 对话时长
    studentEngagement: 'high' | 'medium' | 'low' // 参与度
    outcome: string // "学生理解了基本逻辑，开始编写代码"
  }
  
  // ❌ 家长不可见
  rawConversation: TutorTurn[] // 原始对话记录
  aiReasoningProcess: string // AI 的推理过程
}
```

**理由（✅ AGENTS.md）：**
- 保护学生隐私
- 避免家长过度解读具体对话细节
- 鼓励家长关注成长结果，而非过程细节

**家长如需查看原始对话：**
- 需要向班主任申请
- 班主任审批后，解锁特定会话的查看权限

---

### Q18: 班主任如何介入正在进行的对话？

**答案（🟡 推断）：**

**实时监控 + 多种介入方式**

**实时监控界面：**
```
班主任工作台 → "学生管理" → 选择学生 → "实时学习状态"

┌─────────────────────────────────────┐
│ 学生：小明                           │
│ 当前项目：智能计算器（实践阶段）      │
│ AI 对话状态：进行中（已 12 分钟）     │
│ 卡顿次数：2 次                       │
│ 最新对话：                          │
│   学生："我不知道怎么写循环"         │
│   AI："让我们先回顾一下循环的概念..." │
│                                     │
│ [实时查看对话] [发送消息] [语音通话]  │
└─────────────────────────────────────┘
```

**介入方式：**

**1. 旁观模式（默认）**
- 班主任可以实时看到对话流
- 不发送消息，AI 不知道班主任在看
- 用于质量监控和及时发现问题

**2. 插话模式（轻量介入）**
```typescript
// 班主任发送一条消息
teacherMessage = "小明，我看到你在学循环，加油！有问题随时叫我。"

// 前端显示
[系统消息] 班主任老师：小明，我看到你在学循环，加油！有问题随时叫我。

// AI 行为：感知到班主任在场，调整策略
aiPrompt += "注意：班主任老师正在关注这次对话，如果学生需要，可以建议他直接向老师求助。"
```

**3. 接管模式（完全介入）**
```typescript
// 班主任点击"接管对话"
session.status = 'teacher-led'
aiTutor.role = 'observer'

// 前端显示
[系统消息] 班主任老师已进入对话，AI 搭档将暂时休息。

// 学生和班主任 1v1 对话
// AI 仅记录对话，不主动发言
```

**4. 协作模式（班主任 + AI 双轨）**
```typescript
// 班主任可以在 AI 回复后补充
AI："你可以先想想循环的基本结构。"
[班主任插话]："或者你可以看看之前的例子代码。"

// 前端显示两条消息，学生可以选择跟谁继续对话
```

---

## 7️⃣ 刷新与恢复

### Q19: "刷新后会话和项目阶段可恢复"的边界？

**答案（✅ 文档 + 🟡 推断）：**

**完整恢复最近的活跃会话**

**恢复机制：**

```typescript
// 用户刷新页面后
async function restoreSession() {
  // 1. 查询学生的活跃会话
  const activeSession = await getActiveSession(studentId)
  
  if (activeSession) {
    // 2. 恢复会话上下文
    const context = await loadSessionContext(activeSession.id)
    const recentTurns = await getRecentTurns(activeSession.id, limit: 10)
    
    // 3. 恢复 UI 状态
    restoreUI({
      projectId: activeSession.projectId,
      projectStage: activeSession.projectStage,
      conversationHistory: recentTurns,
      hintLevel: activeSession.hintLevel,
      stuckCount: activeSession.stuckCount
    })
    
    // 4. AI 上下文恢复（后端）
    // AI 能看到最近 10 轮对话 + 完整项目状态
  }
}
```

**恢复范围：**
- ✅ 最近 10 轮对话记录（可滚动加载更多）
- ✅ 当前项目和阶段
- ✅ 提示等级和卡顿计数
- ✅ 未发送的草稿（LocalStorage 保存）
- ❌ 不恢复具体的输入框光标位置（无必要）

**时间边界：**
- 刷新浏览器：立即恢复
- 关闭浏览器后第二天打开：仍然恢复（只要会话状态是 `active` 或 `inactive`）
- 会话已 `completed`：不自动恢复，但可以在历史记录中查看

**边界情况：**
```typescript
// 如果学生在另一个设备打开
if (activeSessionOnOtherDevice) {
  showDialog({
    title: "检测到其他设备的对话",
    message: "你在另一台设备上有一个正在进行的对话，是否继续？",
    options: [
      "继续另一台设备的对话（当前设备接管）",
      "开始新对话（旧对话将被关闭）"
    ]
  })
}
```

---

### Q20: 如果 AI 服务故障，前端如何处理？

**答案（🟡 推断）：**

**降级策略 + 自动重试 + 人工托底**

**故障检测：**
```typescript
// AI 服务超时检测
const AI_TIMEOUT = 30 * 1000 // 30 秒

async function sendToAI(message: string) {
  try {
    const response = await fetch('/api/v1/tutor/stream', {
      signal: AbortSignal.timeout(AI_TIMEOUT)
    })
    return response
  } catch (error) {
    if (error.name === 'TimeoutError') {
      handleAITimeout()
    } else {
      handleAIError(error)
    }
  }
}
```

**降级流程：**

```
AI 请求失败
  ↓
1. 前端显示 LoadingState：
   "AI 正在思考中，请稍候..."
  ↓
2. 自动重试（最多 2 次）
  ↓
3. 仍然失败 → 显示 ErrorState：
   "AI 暂时无法回复，可能是网络问题或服务繁忙。
    
    你可以：
    - [重试] 再试一次
    - [保存草稿] 保存当前内容，稍后继续
    - [联系班主任] 直接向班主任老师求助"
  ↓
4. 同时后端自动创建 Intervention：
   {
     type: 'ai_service_failure',
     priority: 'medium',
     message: '学生在项目 XXX 中遇到 AI 服务故障'
   }
  ↓
5. 班主任收到通知，可主动联系学生
```

**学生已输入内容的保存：**
```typescript
// 实时保存到 LocalStorage
function autosaveDraft(content: string) {
  localStorage.setItem(`draft_${sessionId}`, JSON.stringify({
    content,
    timestamp: Date.now()
  }))
}

// 恢复时检查
function loadDraft() {
  const draft = localStorage.getItem(`draft_${sessionId}`)
  if (draft) {
    const { content, timestamp } = JSON.parse(draft)
    // 如果不超过 24 小时，恢复草稿
    if (Date.now() - timestamp < 24 * 3600 * 1000) {
      return content
    }
  }
  return ''
}
```

---

## 8️⃣ 启动与入口

### Q21: 学生从哪些地方能进入 AI 搭档？

**答案（✅ 文档 + 🟡 推断）：**

**多入口设计，上下文自动绑定**

**入口 1：顶部导航（全局）**
```
学生点击顶部导航栏"AI 搭档"
  ↓
如果有多个进行中的项目：
  显示项目选择器
  ↓
选择项目后进入对话
```

**入口 2：项目详情页（上下文已绑定）**
```
"我的项目" → 点击某个项目卡片 → 进入项目详情
  ↓
顶部显示「与 AI 讨论这个项目」按钮
  ↓
直接进入该项目的 AI 对话（无需再选择）
```

**入口 3：灵感空间探索中（即时呼叫）**
```
学生在"灵感空间"浏览推荐项目
  ↓
对某个项目感兴趣，点击"与 AI 聊聊"
  ↓
进入该项目模板的探索性对话（还未创建正式项目）
  ↓
对话结束后，AI 询问："你想正式开始这个项目吗？"
  → 是：创建项目实例，进入理论阶段
  → 否：关闭对话，不创建项目
```

**入口 4：任务卡片快捷入口**
```
"我的项目" → 项目详情 → 任务列表 → 某个任务
  ↓
任务卡片上有「向 AI 提问」按钮
  ↓
直接进入对话，AI 上下文自动聚焦到该任务
```

**上下文自动绑定规则：**
```typescript
interface EntryContext {
  source: 'nav' | 'project_detail' | 'inspiration' | 'task'
  projectId?: string // 如果从项目进入，自动绑定
  taskId?: string // 如果从任务进入，自动聚焦
  templateId?: string // 如果从灵感空间进入，绑定模板
}

// AI 提示词根据入口调整
if (context.source === 'task' && context.taskId) {
  aiPrompt = `学生正在尝试完成任务「${task.title}」，请围绕这个任务进行引导。`
}
```

---

## 9️⃣ 核心决策总结

### ✅ 已明确的硬性约束（不可更改）

1. **苏格拉底式提问**：AI 不能直接给出完整答案
2. **6 轮引导上限**：超过 6 轮无进展必须升级人工
3. **4 轮卡顿阈值**：触发班主任待办
4. **5 级提示等级**：从提问到必要解释
5. **理论检查前置**：`theoryMastered` 之前不得进入实践
6. **AI 无写入权限**：不能直接修改 `project.status`、`growth_snapshots`
7. **家长脱敏查看**：不默认显示原始 AI 对话
8. **刷新后可恢复**：会话和项目阶段必须可恢复

---

### 🟡 基于推断的设计建议（需确认）

1. **会话粒度**：每个项目阶段一个会话（而非每次对话一个会话）
2. **会话不主动结束**：标记为 `inactive`，保留恢复能力
3. **项目选择器**：多项目时学生先选择再进入对话
4. **理论检查混合触发**：AI 判断 + 学生主动申请
5. **任务证据 AI 初步反馈**：AI 分析 + 班主任最终评审
6. **提示等级自动调整**：根据学生表现升级或降级
7. **卡顿综合检测**：时间 + 内容 + 重复 + 情绪四维度
8. **班主任协作介入**：旁观、插话、接管、协作四种模式
9. **多入口设计**：导航、项目详情、灵感空间、任务卡片
10. **AI 服务降级**：自动重试 + 保存草稿 + 人工托底

---

### 🔴 需要产品决策的问题

1. **语音输出默认开启吗？**
   - 建议：默认关闭（避免学生在公共场合尴尬），学生可手动开启

2. **家长申请查看原始对话的流程？**
   - 建议：家长提交申请 → 班主任 24 小时内审批 → 解锁 7 天查看权限

3. **班主任介入后 AI 的角色？**
   - 方案 A：AI 完全退出，直到班主任结束介入
   - 方案 B：AI 继续观察，班主任可随时请 AI 协助

4. **学生能看到自己的"卡顿计数"吗？**
   - 建议：不显示（避免学生产生挫败感），只显示"提示等级"

5. **AI 服务故障时的最长等待时间？**
   - 建议：超过 5 分钟自动转接班主任，不让学生长时间等待

6. **历史会话的保留期限？**
   - 建议：热数据 7 天，归档数据永久保留（用于成长报告生成）

---

## 📊 下一步行动

基于本文档，需要完成：

### 1. 数据库 Schema 设计
- `tutor_sessions` 表结构
- `tutor_turns` 表结构
- `ai_feedback_drafts` 表结构
- `interventions` 表扩展

### 2. API 接口设计
- 会话 CRUD 接口
- 流式对话接口（SSE/WebSocket）
- 理论检查接口
- 班主任介入接口

### 3. 前端状态管理
- 会话状态（Zustand）
- 对话历史（TanStack Query + 虚拟滚动）
- 语音输入状态
- 实时同步机制

### 4. AI 提示词策略
- 基础提示词模板
- 分阶段提示词（理论/实践/完善）
- 提示等级模板（1-5 级）
- 防止直接输出答案的约束

---

**文档评审人：**
- [ ] 产品负责人确认业务逻辑
- [ ] 技术负责人确认实现可行性
- [ ] 班主任代表确认介入流程
- [ ] 家长代表确认隐私保护

**评审后请更新本文档，标注决策结果。**

---

生成时间：2024-09-29  
版本：v1.0  
下一次更新：产品评审后
