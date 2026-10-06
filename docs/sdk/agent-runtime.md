# Agent Runtime

> 版本：`qitu.agent-runtime.v1`（`packages/contracts/src/agent-runtime.ts`）。
> 入口：`packages/ai-client/src/agent-runtime.ts`、
> `packages/ai-client/src/agent-context-adapter.ts`。

## 1. 合同

- `TutorAgentScope` 由 API 授权后产生，包含 actor、student、school、partner、project、
  session 和 role。
- Agent **不能**构造可信 scope，也不持有 ORM、数据库连接或 unrestricted query。
- `TutorAgentBoundReadPorts` **不接受**调用者传入 `studentId` / `projectId`；
  scope 在 runtime 创建时绑定，底层 adapter 仍按 scope 做对象级授权。
- Knowledge、Template 和数据库只通过有限的 `search`、`listPublished`、`readProjection` 读取。
- `TutorAgentOutput` 必须包含 `runId`、`requestId`、agent/runtime version、`sourceRefs`
  和 `toolCalls`；版本、agent 或 request 不匹配的输出被拒绝。
- 每次 run 必须提供 `idempotencyKey`。幂等存储、审计、outbox 和领域命令由 API owner 实现，
  **runtime 不伪造写入成功**。
- Agent 只能返回 reply、plan 或 projection；项目阶段、掌握度、成长事实、画像、记忆和审计
  由服务端 owner 提交。

## 1.1 策略与模型解析

- `globalPolicy` 引用仓库根 `AGENTS.md` 的服务端版本和内容指纹；客户端不能替换它，Agent-local 定义也不能放宽其中的权限和领域规则。
- `agent.model` 由服务端从 Agent 的 `modelProviderId + modelId` 解析。调用方不能通过请求选择供应商、模型或凭证；模型不可用或未配置时运行时返回明确错误，不回退到另一 Agent 或旧用途绑定。
- 模型快照只包含脱敏的供应商、模型和能力信息。凭证解析、连接测试和对象级权限检查属于 API/model-registry owner。

## 2. Tutor context

- `TutorContextReader` 只组装有限 context packet：授权的学习者画像、关系记忆、
  模板证据、知识证据和有限近期消息。
- `TutorDomainWriter` 只提交服务端定义的成长命令；资源库治理由 Admin 控制面负责。
- 成长信号统一走 `TutorWorkspaceService.commitGrowthSignal()` 的原子事务，
  重复幂等键不会再次推进画像版本。
- `agent-context-adapter.ts` 把 Tutor bounded packet 转换为 runtime `data`，
  只读 packet 进入模型适配层。

## 2.1 Team Runtime 通信与候选投影

Team Leader 与子 Agent 的通信使用版本化的 `TeamRun`、`TeamTask`、`TeamMessage` 和 `TeamEvent`。服务端按 route allow-list 创建任务和 mailbox 消息，worker 以租约消费消息；重试使用幂等键，状态和事件通过 outbox 投影。SDK 可以读取运行状态，但不能直接创建可信任务或修改领域数据。

画像、成长轨迹等异步结果先作为候选投影提交给对应领域 owner。候选投影包含来源事件、学生/项目范围和幂等键；owner 必须重新校验权限、阶段和业务约束，再决定是否写入正式画像或成长档案并留下审计记录。

## 3. 统一 AI搭档会话上下文

学生端自由探索和项目辅导共用 `/student/tutor`：

- 无项目会话使用 `source: 'exploration'`。
- 项目会话使用 `source: 'project'`。
- 服务端**不再**把缺失项目上下文回退到 `project-demo-001`。
- 探索草稿通过 `/api/v1/explorations` 由 Projects owner 创建；
  Tutor session 可通过 `explorationId` 关联；确认意图仍只能由 Projects owner 的幂等命令建项目。

## 4. Tool Registry

- 内置工具 registry 只保存 server-owned descriptor、版本、风险级别、能力白名单和
  `TheoryMastered` 门禁。
- 工具实际执行**必须回到所属领域服务重新校验** actor、对象、阶段和幂等键。
- registry 工厂留在 `services/api/src/modules/platform-registry/built-in-tools.ts`，
  不放入只保留类型合同的 `packages/contracts`。
- 模型只能提出动作；人格、记忆或模型输出均不能绕过 `TheoryMastered`。

## 5. 未决事项

- [ ] 真实 runtime resolver、capability 配置持久化。
- [ ] tool execution owner。
- [ ] 候选投影的领域 owner 接受、审核和正式写入流程。
- [ ] 把 Tutor provider executor 接入新 runtime。

## 6. 相关文档

- [`overview.md`](./overview.md)
- [`domain-facade.md`](./domain-facade.md)
- [`../student/tutor.md`](../student/tutor.md)
