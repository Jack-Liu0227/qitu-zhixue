# 项目式学习动态交互设计：OpenMAIC/SimPBL 参考 + DeepTutor 问题选择交互

> 状态：`design / 待评审`
> 评审基线：2026-10-18
> 责任域：`ai-tutor` / `team-runtime` / `mastery` / `projects` / `apps/student-center/features/tutor`
> 调研来源（2026-10 抓取）：
> - OpenMAIC（THU-MAIC/OpenMAIC，MIT）：多智能体交互课堂；「describe a topic → outline → AI teacher + AI classmates 讲授，含 slides、whiteboard、quizzes、interactive simulations、PBL 活动」；服务端先行（v1.2：course 生成与 provider 配置移到服务端）。
> - SimPBL：PBL 多智能体框架的检索线索，包含从交互日志提供自适应脚手架与边界感知协作的设计方向；论文身份与实验结论尚缺本文可复核来源，不引用学习效果数字。
> - OpenMAIC-Project：PBL 桌面端；planner sessions 与 learning-phase sessions 分离；角色化协作者 + 沙箱工作区（chat、documents、files、code、terminal、browser 工具）。
> - DeepTutor：Question Generator / 题库 / 结构化选项交互（本仓库学生端已有 `OptionChips`、`HintLevelIndicator` 对应物）。
> 上级基线：[`../student/tutor.md`](../../docs/student/tutor.md)、[`../sdk/team-runtime.md`](../../docs/sdk/team-runtime.md)、[`../plan/codex/theme-session-team-ima-design.md`](../codex/theme-session-team-ima-design.md)；[早期绑定设计（归档）](../archive/pre-20261018/design/pbl-template-team-binding-architecture.md) 仅作历史比较。

## 1. 需求解读

用户需求：当前的项目式学习要基于 OpenMAIC 实现动态交互，并落地 DeepTutor 式「问题选择等选项」的交互。即：

1. 对话不再只有文本气泡，而是按教学阶段注入**交互资产**（测验、选项、模拟、白板式图示、里程碑检查）。
2. 问题的选项不是静态文案，而是由掌握度/学习轨迹**动态生成与选择**。
3. 多智能体协作（AI 团队各角色）在对话中以可交互形式出现，而不是单向输出。

## 2. 参考框架映射

| 参考能力 | 来源 | 启途对应物 |
| --- | --- | --- |
| Agenda：统一数据驱动所有互动资产 | OpenMAIC/MAIC 2.0 | Tutor 回复结构化合同扩展 `interactiveBlocks`（§3） |
| AI teacher + classmates 圆桌讨论、举手、辩论 | OpenMAIC | Team Runtime 子 Agent 的可见发言（per-turn speaker 身份，见工作区交互合同 §3.1） |
| Quizzes / 选择题 | OpenMAIC、DeepTutor Question Generator | `quiz` 块 + 掌握度驱动选题（§4） |
| Interactive simulations（可交互 HTML） | OpenMAIC Deep Interactive Mode | `simulation` 块：沙箱内受控 iframe/HTML 交互（§3.4） |
| Whiteboard 板书 | OpenMAIC | `board` 块：服务端生成的静态/分步图示（Mermaid/TeX/分步绘图），只读 |
| Orchestrator 自适应脚手架（interaction logs） | SimPBL | Tutor Agent（Leader）+ `context-packet` 会话轨迹 → 提示阶梯与教学动作策略 |
| Boundary-aware collaborators | SimPBL | typed delegate tasks（`pbl.advance` 等）+ 领域 owner 校验；子 Agent 不直接写域事实 |
| Planner sessions vs learning-phase sessions | OpenMAIC-Project | 探索/立项会话（exploration）与教学阶段会话（project phase session）已分离，沿用 |
| 沙箱工作区（code/terminal/browser 工具） | OpenMAIC-Project | `workbench` 模块沙箱，实践阶段经 `TheoryMastered` 门禁解锁（不变） |
| PBL milestones & feedback | OpenMAIC-Project | `PblPhaseSpec` 阶段 + 交付物 + 门禁（已有合同） |

红线（不因引入参考方案而破坏）：状态转换、AI 决策、掌握度、成长档案、审计全部服务端所有；`TheoryMastered` 前不进实践；学生未确认不立项；未成年人数据最小化。

## 3. 交互资产合同（interactiveBlocks）

Tutor 回复合同在现有（文本、问题、选项、提示、证据、教学动作）之上新增可选 `interactiveBlocks` 数组。每个块由服务端生成、携带类型与载荷；客户端只渲染与回传选择，不生成、不判定。

### 3.1 `quiz`（DeepTutor 式问题选择）

```typescript
interface QuizBlock {
  kind: 'quiz';
  quizId: string;                 // 幂等键；判分走 mastery/题库服务
  question: string;               // 题干（Markdown+TeX）
  options: QuizOption[];          // 4 选项，含由模型生成、经题库判分校验的干扰项
  mode: 'single' | 'multi';
  rationaleHint?: string;         // 答错后的引导（不直接给答案）
  linkedConceptIds: string[];     // 关联掌握度概念，用于动态选题
}
interface QuizOption { label: string; text: string; }
```

- 提交：`POST /api/v1/tutor/sessions/:id/interactive/:quizId/answer`（幂等键）；服务端判分，返回对错、概念掌握度变化与下一步引导（不返回正确答案原文，直到该概念达标或学生明确请求解释 `explain`）。
- 选题来源：`mastery` 领域按 `linkedConceptIds` 的当前掌握度与错题轨迹选择；题型与干扰项由模型经题库合同生成并服务端校验。

### 3.2 `options`（既有 OptionChips 的泛化）

方向选择、路径选择、确认类交互统一为 `options` 块：选项列表 + 每项后果摘要（例如「继续推导」「看一个例子」「直接试做」）。选择回传走既有 `selectOption` 链路；服务端把选择记入会话轨迹，供 orchestrator（Leader）调整脚手架。

### 3.3 `board`（白板式分步图示）

`{ kind: 'board', steps: [{ caption, mermaid | tex | svg }] }`；分步渲染，学生逐步推进；只读，不携带脚本。

### 3.4 `simulation`（受控交互模拟）

- 载荷为服务端登记的模拟模板 `simulationTemplateId` + 参数（如「动能定理参数实验台」质量/速度滑杆），前端以受控组件渲染；不做任意 HTML 注入（与 OpenMAIC 生成任意交互 HTML 不同，启途用登记模板保证未成年人安全与审计）。
- 学生操作结果（参数组合、观察记录）由学生显式提交后写入会话轨迹与作品证据链，不自动采集。

### 3.5 `milestone`（阶段检查卡）

`{ kind: 'milestone', phaseId, deliverables: [...], gate: { type: 'TheoryMastered' | 'review', status } }`；展示当前阶段交付物与门禁状态，链接到 works/workbench 提交入口。状态只读自服务端门禁事实。

### 3.6 流式与渲染

- SSE 帧按块增量下发（`interactive.quiz`、`interactive.board` 等帧类型）；块未完成时显示骨架，不得半渲染可交互控件。
- 所有块支持 loading/empty/error/offline/permission-denied；断网时选择不回传，恢复后重试（幂等键防重复提交）。

## 4. 动态问题选择引擎（DeepTutor Question Generator 参考）

选题策略（服务端 `mastery`/`ai-tutor` 联合）：

1. 概念池：当前 `PblPhaseSpec` 的 `linkedConcepts` ∩ 未达标概念，按掌握度升序。
2. 干扰项生成：针对常见 misconception（来自错题轨迹聚类）构造近似选项；生成后经题库合同校验（无重复、无歧义、单解）。
3. 间隔复习：已达标概念按遗忘曲线混入低频复习题（复用掌握度引擎既有间隔复习）。
4. 泄露防护：选项与题干经过与文本回复相同的答案泄露检查；提示阶梯等级随答错次数提升（`HintLevelIndicator` 展示）。
5. 判分与轨迹：答题结果写入会话轨迹与 mastery 候选（领域 owner 校验后成为正式掌握度事实）。

## 5. 多智能体动态协作（SimPBL 映射）

- Leader（Tutor Agent）每轮先从 `context-packet`（会话轨迹 + 门禁状态 + 掌握度投影）决策教学动作与是否注入交互块，再决定是否委派。
- 委派沿用 typed delegate tasks（`pbl.plan` / `pbl.advance` / `project.review` 等）；子 Agent 返回候选（quiz 草案、board 草案、评审意见），Leader 校验后经 SSE 以对应 speaker 身份下发。
- 子 Agent 输出边界：不直接向学生外发内部提示词/原始参数；工具调用时间线以面向学生的标签呈现（右侧栏「团队智能体」Tab，见工作区交互合同 §3.2）。
- 协同事件（`team.*` 帧）转换为协同卡片与 Agent 状态徽标，学生可展开查看该 Agent 的对话历史摘要。

## 6. 验收要点

- [ ] 一条真实教学会话内出现 ≥3 种交互块（quiz、options、board/milestone），全部服务端生成、判定与记录。
- [ ] quiz 判分幂等；同一 quizId 重复提交不重复计分；答错不泄露答案。
- [ ] 选题随掌握度变化：连续答对后题目难度/概念前移，答错后复习与脚手架提升（可从会话轨迹审计验证）。
- [ ] 交互块在移动端不被遮挡（遵循工作区布局合同 §2）。
- [ ] 未过 `TheoryMastered` 门禁时不出现 `simulation`/workbench 类实践块。
- [ ] 学生不点击任何选项时不发生状态转换；确认类交互（含一键立项）必须由学生显式触发。

## 7. 落地顺序建议

1. `interactiveBlocks` 合同 + `quiz`/`options` 两块（复用 OptionChips/selectOption 链路，改造为块化合同）。
2. 动态选题引擎（mastery 联动 + 干扰项校验）。
3. `board`/`milestone` 块（投影已有 PblPhaseSpec 数据）。
4. `simulation` 模板登记机制（依赖 workbench 沙箱评审）。
