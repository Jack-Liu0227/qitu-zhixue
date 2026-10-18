# AI 搭档

2026-10 修复（#53、#54）：页面使用已有服务端会话、SSE 和权限边界，不再调用不存在的 `/tutor/chat/completions`、浏览器直连上游或失败后生成本地模拟答案。会话只从服务端恢复，旧浏览器模型密钥与模拟聊天缓存会被清除。新建探索保留侧栏入口；探索 id 写入 URL 以便刷新恢复，但不把原始对话写入浏览器存储。学生先填写并核对学习目标（最多 120 字）和兴趣方向（最多 24 字），确认按钮再调用 Projects owner 的草稿与幂等确认接口，成功后进入正式项目会话；不截取对话冒充兴趣标签，不会在客户端声明 TheoryMastered 或模拟沙箱运行。项目侧栏显示服务端真实项目阶段与当前任务，不再显示写死的百分比或团队进度。

> 学生端唯一对话入口：`/student/tutor`、`/student/tutor/[projectId]`。
>
> 实现：`apps/student-center/features/tutor/**`、`services/api/src/modules/ai-tutor`、`packages/ai-client/src/{pedagogy,context,escalation,context-packet}.ts`。

AI 搭档负责启发式引导、追问、拆解和反馈，不直接写项目阶段、掌握度、成长档案或审计日志。它可以参与真实 Team Runtime 协同，但协同结果必须经过服务端任务、事件和领域 owner 校验。

## 1. 页面与上下文

- `source=exploration`：服务端确认当前学生的自由探索草稿，创建或恢复 exploration session。
- `source=project`：服务端确认学生对项目的对象级权限，读取项目上下文。
- live 项目上下文直接读取持久化项目表，不能查询演示名册；刚确认意图但尚未生成学习计划的项目，也必须立即出现在项目列表并能创建教学会话。
- 缺失、无效或越权上下文统一拒绝，不能创建共享或 demo 项目来“补齐”对话。
- 一个 exploration 或 project 只能有一个对应 session，重复创建由数据库唯一约束和幂等键处理。

回复使用结构化合同（文本、问题、选项、提示、证据和教学动作），不接受客户端提交 stage、hintLevel、project status 或 pedagogic move 作为事实。

## 2. 教学动作

| 动作           | 用途                   | 约束                     |
| -------------- | ---------------------- | ------------------------ |
| `hint`         | 让学生自己继续推理     | 一次只给一条轻提示       |
| `scaffold`     | 拆解复杂问题           | 通过目标和问题逐步推进   |
| `explain`      | 学生明确请求解释       | 解释后回到检查与应用     |
| `review_work`  | 反馈学生作品           | 只引用已授权作品和证据   |
| `debug_guide`  | 定位问题和验证路径     | 不直接替学生改出最终答案 |
| `stall_signal` | 识别卡顿并建议人工介入 | 由服务端根据会话轨迹判定 |

系统默认禁止“直接给答案”；教学动作和提示等级由服务端策略、模型输出校验和领域门禁共同决定。

## 3. API

```http
GET  /api/v1/tutor/templates
GET  /api/v1/tutor/session
GET  /api/v1/tutor/project-context
POST /api/v1/tutor/sessions
GET  /api/v1/tutor/sessions/:id
POST /api/v1/tutor/sessions/:id/turns
POST /api/v1/tutor/sessions/:id/stream
GET  /api/v1/tutor/sessions/:id/summary
```

写操作使用 `Idempotency-Key`。SSE 只允许已授权的 `sessionId`，服务端过滤和截断敏感字段；Team Runtime 的 `team.*` 帧由学生端转换为可读的协同卡片，不能把内部提示词或模型原始思考直接发送给学生。

## 4. 语音能力

语音已经具备真实 API 合同，但是否可用取决于已配置的语音模型：

```http
GET  /api/v1/voice/capabilities
POST /api/v1/voice/transcriptions
POST /api/v1/voice/synthesis
GET  /api/v1/admin/model-voice
```

前端 composer 先读取能力和模型状态；没有可用模型时显示不可用并保持文字输入，不伪造录音或合成成功。语音转写结果仍经过 Tutor 文本合同和权限校验，原始音频不得进入成长、家长投影或公开站点。

## 5. 页面状态与安全

| 状态              | 行为                                              |
| ----------------- | ------------------------------------------------- |
| loading           | 显示会话和上下文骨架，保持输入区尺寸稳定          |
| empty             | 没有探索或项目时引导去灵感空间                    |
| error             | 显示可重试错误和安全错误码，不泄露上游响应        |
| offline           | 保留本地未提交草稿，禁止伪造发送成功              |
| permission-denied | 返回 403，不泄露其他学生或项目是否存在            |
| model unavailable | 显示模型未配置/不可用，不能静默回退到另一个 Agent |

## 6. 未决事项

- [ ] 上游原生 token 流与取消语义：当前 live 已使用生产 `ModelGateway.complete` 获取真实回复，再由服务端分块发出 SSE，不代表上游逐 token 流式已完成。
- [ ] 完善卡顿自动检测和教师干预建议的阈值验证。
- [ ] 将会话摘要接入明确的数据保留和学生可见范围策略。

## 7. 相关文档

- [`learning-plan.md`](./learning-plan.md)：理论掌握和实践解锁
- [`projects.md`](./projects.md)：项目状态机
- [`../sdk/agent-runtime.md`](../sdk/agent-runtime.md)
- [`../sdk/team-runtime.md`](../sdk/team-runtime.md)

## 8. 公式与复制体验（实施合同）

- 历史保存 Markdown + TeX 源，不保存 KaTeX HTML；行内公式使用 `$...$`，块公式使用 `$$...$$`，代码块内美元符号不解析。
- KaTeX 必须使用 `output: 'htmlAndMathml'`、`throwOnError: false`、`trust: false`；非法或超长公式只降级为源文本，不丢弃整条历史。
- `ChatBubble` 为每个包含可复制内容的可见气泡提供复制按钮。复制公式保留 TeX 源，复制工具时只保留面向学生的标签/结论，不复制思考链、原始参数或未授权附件 URL。
- Clipboard API 不可用时回退到临时 `textarea`；复制不发请求、不写入会话、不记录正文。按钮必须支持键盘、屏幕阅读器、离线历史和触控。

绑定实体、迁移、API、验证、错误码和验收清单见 [`../design/pbl-reference-implementation-and-chat-history.md`](../design/pbl-reference-implementation-and-chat-history.md)。

## 9. 项目导师团队（2026-10-19）

- 正式项目读取冻结绑定中的团队版本；团队 ID 与团队版本 ID 分开，不以标题或可变的当前团队名册替代历史配置。
- 历史简写成员按冻结的 assistantId、phaseScope/阶段分配解析，补齐稳定槽位、姓名与角色。冻结字段优先；缺少姓名或头像时关联真实助手目录。
- GET /api/v1/tutor/team-graph 保留项目所属学生校验。真实启用的团队与助手在无任务时显示 ready；running/failed、消息与工具调用只来自项目范围内的 Team Runtime；禁用、助手缺失或运行时查询失败显示 offline。
- 项目确认必须在创建事务内冻结模板/团队绑定；缺少绑定或绑定服务时返回 503 PROJECT_TEAM_BINDING_UNAVAILABLE，探索确认与项目插入一并回滚，可在管理员修复配置后重试。错误日志只含项目/模板版本 ID。
- 回归覆盖简写/完整冻结成员、可变名册隔离、禁用、运行时失败、跨学生访问及绑定缺失后的回滚与重试。
