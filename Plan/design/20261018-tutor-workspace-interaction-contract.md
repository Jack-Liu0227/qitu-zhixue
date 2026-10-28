# AI 搭档工作区交互合同：布局防遮挡、团队身份与对话内立项

> 状态：`implemented（2026-10-18 §2/§3/§4 主链路落地，测试通过）`
> 评审基线：2026-10-18
> 责任域：`apps/student-center/features/tutor`、`services/api/src/modules/ai-tutor`、`team-runtime`、`projects`
> 上级基线：[`../student/tutor.md`](../../docs/student/tutor.md)、[`../plan/codex/theme-session-team-ima-design.md`](../codex/theme-session-team-ima-design.md)；[早期绑定设计（归档）](../archive/pre-20261018/design/pbl-template-team-binding-architecture.md) 仅作历史比较。

本文定义学生端 AI 搭档三项交互合同的验收形态：① 对话内容不得被顶部、侧边、底部任何区域遮挡；② 助手召唤后展示真实团队/助手身份，右侧栏双 Tab（项目进度 / 团队智能体），左侧不再展示 agent 状态；③ 项目创建在对话内由「启途智学助手」接管并一键立项，不再依赖「立项准备」手动表单。

## 1. 现状与问题（2026-10-18 审计）

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `TutorPage.tsx:55-57` | `isThunder` 用正则从项目标题猜团队，硬编码「雷霆战队/动能定理导师团队」 | 团队名不是服务端事实；与 PblTeam 绑定脱节 |
| `TeamAgentHud.tsx resolveSubAgents()` | 按 `currentProjectId`/`currentTitle` 正则返回硬编码子 Agent（概念教练/沙箱向导/评审导师） | 子 Agent 身份、状态、头像全是演示数据，未接 Team Runtime 投影 |
| `TutorTeamRail.tsx` | `phasesHierarchy` 硬编码五阶段树 | 演示数据冒充项目进度（违反文档基线「不得冒充真实协同结果」） |
| `TutorSessionHistory.tsx:339` 起 | 左侧历史栏内嵌「团队智能体执行状态区」 | agent 状态重复出现在左侧；需移除，统一收敛到右侧栏 |
| `tutor.css` | `.qitu-tutor-page` 高 `calc(100vh - 65px)`、`overflow: hidden`；侧栏 `overflow-y: auto`；中列无统一 `min-height: 0` 链路 | 长回复、宽公式、粘性元素组合下消息可被 header/侧栏/composer 遮挡 |
| 立项流程 | 探索页保留目标/兴趣确认表单组件，一键立项仅在文案层提及 | 「立项准备」手动表单仍是对话外的入口，与需求 5 相悖 |

## 2. 布局防遮挡合同

### 2.1 布局模型

三栏工作区使用单一 flex 列容器，每层显式建立滚动上下文，禁止 `position: fixed/sticky` 覆盖聊天视口：

```text
.qitu-tutor-page            display:flex; flex-direction:column; height:100%; overflow:hidden
├─ header                   flex: 0 0 auto（不 sticky、不 fixed）
├─ .qitu-tutor-workspace-layout  flex: 1 1 0; min-height: 0; display:flex; overflow:hidden
│  ├─ 左栏（会话历史）        flex: 0 0 auto; overflow-y: auto; min-height: 0
│  ├─ 中列（对话）           flex: 1 1 0; min-width: 0; min-height: 0; display:flex; flex-direction:column
│  │  ├─ ChatThread 滚动区   flex: 1 1 0; min-height: 0; overflow-y: auto
│  │  └─ Composer           flex: 0 0 auto（占位保留，不在流外浮动）
│  └─ 右栏（双 Tab 侧栏）    flex: 0 0 auto; overflow-y: auto; min-height: 0
```

### 2.2 硬性验收

- [ ] 任何视口宽度（≥320px）与任何消息长度下，最新一条消息底部在 Composer 之上完全可见；滚动到最新消息不发生被裁剪。
- [ ] 消息内超宽内容（KaTeX 块公式、表格、代码块）只在中列内部横向滚动（`overflow-x: auto; max-width: 100%`），不允许把侧栏或 Composer 顶出视口，也不允许被侧栏压盖。
- [ ] header、两个侧栏各自的 z-index 层级独立且不覆盖中列；折叠态侧栏不产生横向溢出。
- [ ] SSE 流式追加时自动滚动仅发生在「用户本来就在底部」的情况；用户上翻阅读时不强制拉底（避免内容跳动造成视觉遮挡）。
- [ ] 移动端（≤768px）：三栏折叠为单列，侧栏以抽屉/分段展开，最大高度受 `max-height` 限制且不覆盖对话输入。
- [ ] 键盘唤起（移动端）时 Composer 保持可见（`visualViewport` 适配或等价方案）。

## 3. 团队与助手身份合同（需求 2/5 共同）

### 3.1 身份事实源

- 项目上下文接口（`GET /api/v1/tutor/project-context`）必须返回 `team` 对象：`{ teamId, teamName, assistantId, assistantName }`，来自 `PblTeam` 绑定（见 `pbl-template-team-binding-architecture.md` §2），不得由前端从标题推断。
- 自由探索会话（无 `projectId`）返回 `{ assistantName: '启途智学助手' }`。
- 每个 turn 携带发言者标识：`speakerAssistantName`（例如「概念教练」「沙箱向导」或团队 Leader 名）。`ChatBubble`/`ChatThread` 以 per-turn 名称渲染，不允许整场使用同一个静态名字。
- 召唤（进入页面/切换项目）后，header 徽标、会话历史条目、`currentAssistantName` 三处使用同一服务端身份。

### 3.2 右侧栏双 Tab

右侧栏两个 Tab，数据全部来自服务端投影，禁止演示数据：

**Tab 1「项目进度」**
- `ProjectCard` + `CurrentTask` 读取服务端真实项目阶段与当前任务（已有合同）。
- 阶段树来自 `PblPhaseSpec` 投影：阶段名、`orderIndex`、门禁状态（`requiresGateApproval` + 当前核验结果）、交付物清单状态。
- 删除 `TutorTeamRail.phasesHierarchy` 硬编码数据；组件改为纯渲染 `props.phases`。

**Tab 2「团队智能体」**
- Agent 列表来自 Team Runtime 投影（`StaticAgentGraph` 配置 + `DynamicAgentGraph` 执行）：Agent 名、角色、模型状态（`ready/running/waiting/failed/offline`）、当前任务摘要。
- 每个 Agent 可展开：对话历史（该 Agent 参与 mailbox 的消息/事件，经服务端过滤脱敏）、工具调用时间线（`ToolCallTimeline` 复用，仅面向学生的标签/结论，不含内部提示词与原始参数）。
- 左侧 `TutorSessionHistory` 移除「团队智能体执行状态区」（`TutorSessionHistory.tsx:339` 起的 `subAgents` 块与 `AgentDetailModal` 入口）；左侧只保留：会话/项目历史、新建探索、切换项目。
- 删除 `resolveSubAgents()` 的正则/硬编码实现，改为接收服务端数据。

### 3.3 数据接口

```http
GET /api/v1/tutor/project-context       # 扩展返回 team 身份 + phases 投影
GET /api/v1/tutor/team-graph            # StaticAgentGraph + DynamicAgentGraph（已授权 session）
```

`team-graph` 仅对已授权 `sessionId`/`projectId` 开放；浏览器不得用图数据绕过授权或写状态（沿用 Team Runtime SDK 合同）。

## 4. 对话内一键立项（需求 5）

### 4.1 流程

1. 学生在探索会话自由表达兴趣 →「启途智学助手」接管对话，梳理方向后输出**想法卡片**（idea cards）：每张含课题名、一句话描述、课时总数与单课时分钟数、适配理由、关联模板 `templateId`。卡片由模型经结构化合同输出，候选先经 `project.recommendation` typed task 校验。
2. 学生点击卡片上的「一键创建」→ 前端调用既有 `confirmExploration` 幂等确认接口（目标/兴趣由卡片携带，学生可在卡片内微调后确认）。
3. 成功后跳转 `/tutor/:projectId`，唤醒导师团队；失败展示可重试错误与安全错误码。
4. 学生不点击即不创建（跨域硬规则 4：未确认意图不得创建正式项目）。助手不能代替学生触发确认。

### 4.2 合同变更

- Tutor 回复结构化合同新增 `ideaCards` 块：`{ title, description, lessonCount, lessonMinutes, rationale, templateId, suggestedGoal, suggestedInterest }[]`；服务端校验 `templateId` 存在且启用。
- 移除对话外「立项准备」手动表单入口（探索页目标/兴趣表单组件退场）；确认动作收敛到卡片内。
- `Idempotency-Key` 沿用 `TutorPage` 现有 `createIdempotencyKey()` 机制；重复点击幂等。

### 4.3 验收

- [ ] 从「自由表达到一键立项」全程不离开对话流；无手动表单步骤。
- [ ] 未点击卡片时不产生任何项目行；点击一次只产生一个项目。
- [ ] 立项后 header 团队徽标、右侧栏进度、ChatBubble 发言者名称均切换为真实团队身份。
- [ ] 探索失败/模型不可用/模板缺失时给出明确错误，不伪造立项成功。

## 5. 实施状态（2026-10-18）

- §2 布局合同：`apps/student-center/styles/tutor.css`（dvh 渐进增强、层级合同、宽内容防裁剪）+ `TutorPage.tsx` 中列 `minHeight: 0`；ChatThread 既有近底部跟随逻辑保留。
- §3.1 身份合同：`packages/contracts/src/tutor.ts` `TutorTeamIdentity`；`services/api/src/modules/ai-tutor/tutor.service.ts` `resolveTeamContext`（团队/助手身份服务端事实）；`TutorPage.tsx` 移除标题正则，改用 `session.project.team`。
- §3.2 右侧栏双 Tab：进度 Tab 使用服务端 `phases` 投影（`TutorPhaseProjection`）；智能体 Tab 走 `GET /api/v1/tutor/team-graph`（`tutor.controller.ts` / `tutor.service.ts` `getTeamGraph`，名册来自 `admin_team_members` 真实配置）；左侧 `TutorSessionHistory` 已移除 agent 状态区；`TutorTeamRail` / `TeamAgentHud` 硬编码演示数据已删除。
- §4 一键立项：`idea_cards` 块由服务端在探索会话注入（`buildIdeaCardsOnce`，来自已发布模板目录，每会话一次幂等）；前端 `IdeaCards.tsx` 渲染，点击走既有 `confirmExploration` 幂等链路；对话流内硬编码演示卡片已删除。
- 未决：`team-graph` 的 `messages/toolCalls` 暂为空数组（mailbox 执行记录与助手目录标识空间尚未打通，见 §3.2 注释）；`AssistantDetailModal` 的执行历史待该投影打通后接真实数据。

## 6. 落地顺序建议（原计划）

1. 布局合同（§2）：纯 CSS/结构改动，先行合入，独立验收。
2. 身份合同（§3.1）+ 右侧栏 Tab（§3.2）：依赖 `team-graph` 投影接口与 `project-context` 扩展。
3. 一键立项（§4）：依赖 ideaCards 合同评审与 `project.recommendation` 校验链路。
