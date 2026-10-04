# AI 搭档基础设施落地说明

## 运行链路

学生端的 AI 搭档通过 `@qitu/ai-client` 组装服务端上下文。Nest 模块只依赖 SDK 的端口，不把数据库对象暴露给模型调用层：

```
student-center
  -> /api/v1/tutor/sessions/:id/stream
  -> TutorService
  -> TutorContextReader.buildContext()
  -> PostgreSQL adapter
     -> learner profile / memories
     -> template documents
     -> knowledge documents
  -> ModelGateway.complete('tutor.chat')
```

SDK 端口覆盖：伙伴初始化、模板和知识文档 upsert、记忆写入、成长事件幂等写入、画像投影更新和受权限过滤的检索。成长事件只保存摘要和不透明证据引用，不保存未成年人原始对话。

Agent 专属记忆现在由 `agent_memory_records` 作为权威表：学生与 Partner 的关系记忆和管理员评审后的 Partner 策略记忆分开；关系记忆默认 90 天有效，纠错/删除先在本地失效，再通过 `agent-memory.index` Outbox 任务清理外部索引。Mem0 仅作为可替换的索引端口，本轮不自动抽取完整对话，也不允许模型直接写成长档案。

学生端推荐项目保留灵感空间独立详情/确认流程；只有自由探索和项目辅导共用 AI搭档会话入口 `/student/tutor`。自由探索先通过 `/api/v1/explorations` 幂等创建 `free` 草稿，再由 Tutor session 以 `source: 'exploration'` 和 `explorationId` 关联；项目辅导使用 `source: 'project'` 和经授权的 `projectId`。Tutor 页面只保留左侧上下文进度、文字对话和 Composer。

当前 SDK 分为两个安全边界：

- 服务端 `QituSDKFactory` / `createQituSDK()`：绑定 `studentId + projectId`，组合
  `mastery.evaluate/checkThreshold`、`agent.run`、`project.canAdvance/advance`、
  `profile.get`，返回显式类型 `QituSDK<Input, Result, Profile>`。所有写入仍由领域 owner、幂等、审计和 outbox 控制。
- 浏览器 `createQituReadSDK()` / `createApiClient().mastery`：只提供 current、timeline、
  snapshot、threshold、regressions 读取（返回类型 `QituReadSDK`），不提供评估、写事件或项目阶段写入口。

两阶段学习计划引擎已在 `@qitu/ai-client/curriculum` 落地：`exploreCurriculumInterest` →
`planCurriculum` / `generateCurriculumPlan`，加 `selectNextCurriculumStep`、
`validateCurriculumPlan`、`confirmCurriculumPlan`。它是**纯函数 + 确定性 seed**（无网络、无 DB），
生成期就保证「实践目标的 prereq 只指向更早课次的理论目标」，并保留 `toLegacyLearningPlanDraft`
兼容层给仍在跑旧形状的 plan-api。

Graphiti 不出现在浏览器 SDK 类型中。它通过 `mastery.assessed` outbox 进入 Worker，
再由受控 bridge 投影；`QITU_GRAPHITI_ENABLED` 未开启时，核心学习流程继续使用
PostgreSQL 事实和当前投影。


掌握度不是 Agent 关系记忆。当前和后续实现必须遵守：

- Mem0 只索引偏好、兴趣、目标和学习风格等非掌握类长期事实。
- 掌握度事件、当前 level、`TheoryMastered` 和项目阶段由 Projects & Learning 服务端维护。
- 时间线通过 `MasteryTimelinePort` 读取；Graphiti 如接入，只是异步可重建投影。
- Agent、模型和客户端都不能写 `mastery_events`、`mastery_records` 或项目阶段。
- 详细事件模型、双时间语义和 M0-M5 计划见 [`decisions/0009-mastery-timeline-and-graphiti.md`](./decisions/0009-mastery-timeline-and-graphiti.md)。


执行迁移后运行：

```bash
DATABASE_URL=postgresql://... pnpm --filter @qitu/database seed
```

种子会同时初始化 `qitu-learning-partner`、系统模板和核心教学知识文档。学生端灵感空间默认读取 `/api/v1/tutor/templates`，不会在真实模式静默退回 fixture。

## SDK 底座重设计说明（2026-10-04）

本轮将原先重叠的三个入口明确为不同层级：

1. `TutorAgentRuntime`：Agent 编排底座。绑定 server-issued scope，提供绑定后的 read facade、capability tool registry、context builder 和带幂等键的 structured run。
2. `TutorContextReader` / `TutorDomainWriter`：现有 Tutor workspace 的兼容适配层。读取与领域写命令分离，仍由 `TutorWorkspaceService` 提供数据库适配。
3. `QituSDK`：mastery、project、profile 的服务端领域 facade，不向浏览器或 Agent 暴露数据库能力。

`TutorAgentScope`、`TutorAgentContext`、`TutorAgentOutput` 和 `TutorAgentBoundReadPorts` 位于 `packages/contracts/src/agent-runtime.ts`，版本为 `qitu.agent-runtime.v1`。`packages/ai-client/src/agent-runtime.ts` 负责 scope 绑定和输出校验；`agent-context-adapter.ts` 将现有 Tutor bounded packet 适配为 runtime data。

当前明确不实现的部分：真实 Agent Runtime Resolver、持久化 capability 配置、工具执行 owner、成长/画像 projection worker 和真实模型 executor 接线。它们需要独立的权限、幂等、审计和运维合同，不能由 SDK facade 直接代替。
## Qwen 3.8 Flash

模型注册表预置了 `qwen3.8-flash`，兼容 OpenAI Chat Completions 协议。管理员仍需在模型注册表中配置供应商凭证并将用途 `tutor.chat` 绑定到该模型；凭证只能通过 `QITU_MODEL_SECRET_KEY` 加密存储，代码和种子不包含密钥。

建议 live 环境：

```bash
QITU_DATA_MODE=live
DATABASE_URL=postgresql://...
QITU_MODEL_SECRET_KEY=...
```

## 检索边界

当前知识空间使用 PostgreSQL 持久文档和受学生/项目作用域过滤的关键词相关度检索，检索结果以有限长度证据注入 `context_packet`。这已经是真实的检索增强链路，但尚未引入 pgvector/embedding 依赖；后续可以在不改 SDK 合同的情况下，将 `searchKnowledge` adapter 替换成向量或混合检索实现。

## 产品不变量

- 兴趣探索未确认前不创建正式项目。
- `TheoryMastered` 由服务端掌握度逻辑产生，实践不能由客户端解锁。
- AI 不能直接写成长档案；它只能追加带幂等键的成长信号，由 SDK 生成最小画像投影。
- 提示等级、阶段、序号、审计和权限全部由服务端决定。
- 学生端覆盖 loading、empty、error、offline、permission-denied 状态。
