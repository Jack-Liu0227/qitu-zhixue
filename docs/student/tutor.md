# AI 搭档

> 学生端唯一对话入口：`/student/tutor`、`/student/tutor/[projectId]`。
>
> 实现：`apps/student-center/features/tutor/**`、`services/api/src/modules/ai-tutor`、`packages/ai-client/src/{pedagogy,context,escalation,context-packet}.ts`。

AI 搭档负责启发式引导、追问、拆解和反馈，不直接写项目阶段、掌握度、成长档案或审计日志。它可以参与真实 Team Runtime 协同，但协同结果必须经过服务端任务、事件和领域 owner 校验。

## 1. 页面与上下文

- `source=exploration`：服务端确认当前学生的自由探索草稿，创建或恢复 exploration session。
- `source=project`：服务端确认学生对项目的对象级权限，读取项目上下文。
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

- [ ] 将实时文本流完全切换到生产 `ModelGateway`，并继续保留错误码和取消语义。
- [ ] 完善卡顿自动检测和教师干预建议的阈值验证。
- [ ] 将会话摘要接入明确的数据保留和学生可见范围策略。

## 7. 相关文档

- [`learning-plan.md`](./learning-plan.md)：理论掌握和实践解锁
- [`projects.md`](./projects.md)：项目状态机
- [`../sdk/agent-runtime.md`](../sdk/agent-runtime.md)
- [`../sdk/team-runtime.md`](../sdk/team-runtime.md)
