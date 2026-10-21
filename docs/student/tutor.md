# AI 搭档

模板探索的右侧栏读取该学生探索会话的实际团队名册与运行状态，并展示立项前准备和“确认并开始这个项目”入口。确认前不显示虚构的正式课时完成率；确认后切换为项目 owner 返回的实际课时、任务和证据。团队页可见时持续刷新，切换会话后旧响应不得覆盖当前对象。

模型活动应根据冻结课时计划、当前任务和学习证据生成，经对应 owner 接受后展示。不得因为模板标题包含“散射、衍射、实验”等词就自动插入固定实验卡。旧对话中的无动作权限预览改为说明与继续交流入口，不再显示无法提交的预测训练。正式实验继续校验理论门禁和参数范围。

2026-10-22 已为光学模板发布含动态课件能力的新团队版本并启用新 binding。新确认项目可以在当前冻结课时内生成并保存板书；旧项目的冻结教学包不自动增加权限。板书候选格式失败允许有界修正重试。后台 JSON 规划任务仅加载适用于该任务的技能，课堂交互技能继续由具备课时 scope 和真实执行器的 Tutor 通道使用。

模板固定文案、逐课开场与断点续学的后续设计见[模板固定开场与逐课引导方案](./template-session-openings-plan.md)。该方案尚未实施，不应将本轮开场卡片美化视为逐课教学全链路已验收。

会话清理后进入 `/student/tutor?idle=1`，清空当前会话展示，并等待学生选择已有会话或点击“新建探索会话”。该状态下不创建探索、不加载已删除会话、不自动打开当前项目；刷新页面仍保持待选择状态。删除继续使用后端永久删除、对象权限和幂等合同。

模板探索的会话历史和“我的项目”草稿标题，按探索记录关联的 `templateVersionId` 读取对应模板名；自由探索优先展示已保存的探究目标，尚无目标时显示“自由探索”。标题只影响展示，不参与团队路由或授权。

自由探索与模板探索的首轮使用独立引导卡片，展示主题、实际导师身份、探究问题和可点击的开聊选项。选项内容来自已加载的服务端首轮，点击仅发送对话，不自动确认项目或推进教学阶段；导师未就绪或断网时禁用发送，模板配置待完善时明确说明。

> 文档基线：`2026-10-19`，版本标识：`v2026.10.19`。
> 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**。以真实探究挑战、证据链沉淀与人机协同育人为核心。
> 学生端核心对话入口：`/student/tutor`、`/student/tutor/[projectId]`，并与 **灵感空间（`/student/inspiration`）** 深度联动（支持自由探索跳转与立项转化）。
>
> 实现：`apps/student-center/features/tutor/**`、`services/api/src/modules/ai-tutor`、`packages/ai-client/src/{pedagogy,context,escalation,context-packet}.ts`。

AI 搭档负责启发式引导、追问、拆解和反馈，不直接写项目阶段、掌握度、成长档案或审计日志。它可以参与真实 Team Runtime 协同，但协同结果必须经过服务端任务、事件和领域 owner 校验。

## 1. 动态呈现与交互体验

学习全过程拒绝静态长文本灌输，前端标配多维动态展示与高互动教学体验：
- **Mermaid 拓扑与流程**：思维导图、探究流程与概念逻辑可视化。
- **KaTeX 数学/物理公式**：行内与块级公式高精度动态渲染（保存 TeX 源，禁用 HTML 脏标记）。
- **BoardBlock 看板卡片**：结构化阶段看板与实时探究板书。
- **微观实验仿真**：单缝衍射与封闭细雾室散射使用注册的封闭模型；当前 `optics_experiment` 是结构化可视化原型，尚未接入正式 server action / observations 协议。滑块、运行和摘要只能展示模拟观察，不能声称 CER 证据已保存或写入掌握度、作品通过与成长事实。
- **首轮自启动引导（auto-launch opening turn）**：空探索会话已有自由探索或模板介绍开场；模板导师取已发布绑定，正式项目读取冻结教学上下文。逐课固定导入和续学机制仍按上方方案实施，不能将空会话开场视为逐课编排已完成，也不能以标题或 ID 前缀推导教学授权。
- **探究双循环机制**：严格遵循“学生回答/操作产生结构化证据 -> 服务端策略选择下一教学动作”闭环，以追问、微提示与动态板书推动高阶思维进阶。

## 2. 页面与上下文

- `source=exploration`：服务端确认当前学生的自由探索草稿，创建或恢复 exploration session。
- `source=project`：服务端确认学生对项目的对象级权限，读取项目上下文。
- live 项目上下文直接读取持久化项目表，不能查询演示名册；刚确认意图但尚未生成学习计划的项目，也必须立即出现在项目列表并能创建教学会话。
- 缺失、无效或越权上下文统一拒绝，不能创建共享或 demo 项目来“补齐”对话。
- 一个 exploration 或 project 只能有一个对应 session，重复创建由数据库唯一约束和幂等键处理。

回复使用闭合集合 `TutorReplyBlock` 与 SSE 流式交付，不接受客户端直接提交 stage、hintLevel 或 project status。

光学正式工具接入须补齐 `specVersion`、`objectiveId`、服务端稳定 action 实例、幂等事件、参数/模型域校验、持久化 observations 及 CER/rubric 引用；收到 owner 回执后才显示“已保存”。服务端必须再次校验项目对象权限、实验版本及 `TheoryMastered` 门禁；门禁前只允许低风险模拟提示，不放行实践工具。模拟计算、模拟观察和真实测量必须区分，真实实验另需教师安全审核。

## 3. 教学动作

| 动作           | 用途                   | 约束                     |
| -------------- | ---------------------- | ------------------------ |
| `hint`         | 让学生自己继续推理     | 一次只给一条轻提示       |
| `scaffold`     | 拆解复杂问题           | 通过目标和问题逐步推进   |
| `explain`      | 学生明确请求解释       | 解释后回到检查与应用     |
| `review_work`  | 反馈学生作品           | 只引用已授权作品和证据   |
| `debug_guide`  | 定位问题和验证路径     | 不直接替学生改出最终答案 |
| `stall_signal` | 识别卡顿并建议人工介入 | 由服务端根据会话轨迹判定 |

系统默认禁止“直接给答案”；教学动作和提示等级由服务端策略、模型输出校验和领域门禁共同决定。

## 4. API

```http
GET  /api/v1/tutor/templates
GET  /api/v1/tutor/session
GET  /api/v1/tutor/project-context
GET  /api/v1/tutor/team-graph?projectId=...
GET  /api/v1/tutor/team-graph?explorationId=...
POST /api/v1/tutor/sessions
GET  /api/v1/tutor/sessions/:id
POST /api/v1/tutor/sessions/:id/turns
POST /api/v1/tutor/sessions/:id/stream
GET  /api/v1/tutor/sessions/:id/summary
```

写操作使用 `Idempotency-Key`。SSE 只允许已授权的 `sessionId`，服务端过滤和截断敏感字段；Team Runtime 的 `team.*` 帧由学生端转换为可读的协同卡片，不能把内部提示词或模型原始思考直接发送给学生。

## 5. 语音能力

语音已经具备真实 API 合同，但是否可用取决于已配置的语音模型：

```http
GET  /api/v1/voice/capabilities
POST /api/v1/voice/transcriptions
POST /api/v1/voice/synthesis
GET  /api/v1/admin/model-voice
```

前端 composer 先读取能力和模型状态；没有可用模型时显示不可用并保持文字输入，不伪造录音或合成成功。语音转写结果仍经过 Tutor 文本合同和权限校验，原始音频不得进入成长、家长投影或公开站点。

## 6. 页面状态与安全

| 状态              | 行为                                              |
| ----------------- | ------------------------------------------------- |
| loading           | 显示会话和上下文骨架，保持输入区尺寸稳定          |
| empty             | 没有探索或项目时引导去灵感空间                    |
| error             | 显示可重试错误和安全错误码，不泄露上游响应        |
| offline           | 保留本地未提交草稿，禁止伪造发送成功              |
| permission-denied | 返回 403，不泄露其他学生或项目是否存在            |
| model unavailable | 显示模型未配置/不可用，不能静默回退到另一个 Agent |

## 7. 未决事项

- [ ] 上游原生 token 流与取消语义：当前 live 已使用生产 `ModelGateway.complete` 获取真实回复，再由服务端分块发出 SSE，不代表上游逐 token 流式已完成。
- [ ] 完善卡顿自动检测和教师干预建议的阈值验证。
- [ ] 将会话摘要接入明确的数据保留和学生可见范围策略。

## 8. 相关文档

- [`learning-plan.md`](./learning-plan.md)：理论掌握和实践解锁
- [`projects.md`](./projects.md)：项目状态机
- [`../sdk/agent-runtime.md`](../sdk/agent-runtime.md)
- [`../sdk/team-runtime.md`](../sdk/team-runtime.md)

## 9. 公式与复制体验（实施合同）

- 历史保存 Markdown + TeX 源，不保存 KaTeX HTML；行内公式使用 `$...$`，块公式使用 `$$...$$`，代码块内美元符号不解析。
- KaTeX 必须使用 `output: 'htmlAndMathml'`、`throwOnError: false`、`trust: false`；非法或超长公式只降级为源文本，不丢弃整条历史。
- `ChatBubble` 为每个包含可复制内容的可见气泡提供复制按钮。复制公式保留 TeX 源，复制工具时只保留面向学生的标签/结论，不复制思考链、原始参数或未授权附件 URL。
- Clipboard API 不可用时回退到临时 `textarea`；复制不发请求、不写入会话、不记录正文。按钮必须支持键盘、屏幕阅读器、离线历史和触控。

绑定、冻结版本与当前缺口以 [`../plan/codex/theme-session-team-ima-design.md`](../plan/codex/theme-session-team-ima-design.md) 和 [`../plan/codex/gap-audit-20261019.md`](../plan/codex/gap-audit-20261019.md) 为准；[早期实现与对话历史设计](../archive/pre-20261018/design/pbl-reference-implementation-and-chat-history.md) 仅作溯源。

## 10. 项目导师团队（2026-10-19）

- 正式项目读取冻结绑定中的团队版本；团队 ID 与团队版本 ID 分开，不以标题或可变的当前团队名册替代历史配置。
- 历史简写成员按冻结的 assistantId、phaseScope/阶段分配解析，补齐稳定槽位、姓名与角色。冻结字段优先；缺少姓名或头像时关联真实助手目录。
- GET /api/v1/tutor/team-graph 只接受 projectId 或 explorationId 其中之一，并校验所属学生。真实启用的团队与助手在无任务时显示 ready；running/failed、消息与工具调用只来自当前项目，或该学生的准确探索会话；禁用、助手缺失或运行时查询失败显示 offline。
- 项目确认必须在创建事务内冻结模板/团队绑定；缺少绑定或绑定服务时返回 503 PROJECT_TEAM_BINDING_UNAVAILABLE，探索确认与项目插入一并回滚，可在管理员修复配置后重试。错误日志只含项目/模板版本 ID。
- 回归覆盖简写/完整冻结成员、可变名册隔离、禁用、运行时失败、跨学生访问及绑定缺失后的回滚与重试。

## 2026-10-22 ???????????

????????????????????????????? 100 ????????????????????????????????????????????????????????????????

????????????? Admin ?????????????????????????????????????????????????? owner?????????????????????????????????[?????????](../plan/codex/student-permanent-cleanup-20261022.md)?
