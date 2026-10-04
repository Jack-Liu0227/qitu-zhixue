# SDK 与 Agent Runtime

## 分层

SDK 只提供合同、边界和组合能力，不替代领域服务。

| 层 | 入口 | 职责 | 直接写领域事实 |
|---|---|---|---|
| Agent Runtime | `createTutorAgentRuntime` | 绑定 server-issued scope、构建 bounded context、限制读取端口、校验结构化输出 | 否 |
| Tutor adapter | `createTutorContextReader` / `createTutorDomainWriter` | 读取 Tutor context、提交成长信号等 owner command | 仅通过 owner port |
| Domain facade | `QituSDKFactory` / `createQituSDK` | 组合 mastery、project、profile 服务端能力 | 由领域服务校验、幂等、审计 |
| Browser client | `createApiClient` / `createQituReadSDK` | HTTP 和只读 mastery projection | 否 |

实现入口：`packages/contracts`、`packages/ai-client`、`packages/api-client`。

## Agent Runtime 合同

版本：`qitu.agent-runtime.v1`。

- `TutorAgentScope` 由 API 授权后产生，包含 actor、student、school、partner、project、session 和 role。
- Agent 不能构造可信 scope，也不能持有 ORM、数据库连接或 unrestricted query。
- `TutorAgentBoundReadPorts` 不接受调用者传入 `studentId` / `projectId`；scope 在 runtime 创建时绑定。
- Knowledge、Template 和数据库只通过有限的 `search`、`listPublished`、`readProjection` 读取。
- `TutorAgentOutput` 必须包含 `runId`、`requestId`、agent/runtime version、sourceRefs 和 toolCalls。
- 每次 run 必须提供 `idempotencyKey`。
- Agent 只能返回 reply、plan 或 projection；项目阶段、掌握度、成长事实、画像、记忆和审计由服务端 owner 提交。

## Tutor context

`TutorContextReader` 只组装有限 context packet，包含授权的学习者画像、关系记忆、模板证据、知识证据和有限近期消息。`TutorDomainWriter` 只提交服务端定义的成长命令；资源库治理由 Admin 控制面负责。

成长信号统一走 `TutorWorkspaceService.commitGrowthSignal()` 的原子事务，重复幂等键不会再次推进画像版本。

## Tool Registry

内置工具 registry 只保存 server-owned descriptor、版本、风险级别、能力白名单和 TheoryMastered 门禁。工具实际执行必须回到所属领域服务重新校验 actor、对象、阶段和幂等键。

## 前后端边界

- 浏览器只能消费 API 合同和 projection。
- 前端不得提交阶段、提示等级、掌握度、成长档案或审计字段。
- API 必须在每个请求上执行对象级权限检查。
- 所有敏感读取和写操作考虑审计、幂等、outbox 和最小可见范围。

## 验证

- 合同：`pnpm --filter @qitu/contracts typecheck`
- AI client：`pnpm --filter @qitu/ai-client typecheck`、`pnpm --filter @qitu/ai-client test`
- API：`pnpm --filter @qitu/api typecheck`、`pnpm --filter @qitu/api test`
- 全仓：`pnpm build`

若 workspace 依赖未安装或服务器环境缺失，应记录为验证阻塞，不以 demo 模式冒充正式环境通过。

## 关联文档

- [ADMIN.md](./ADMIN.md)
- [STUDENT.md](./STUDENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PLATFORM_CONTROL_PLANE.md](./PLATFORM_CONTROL_PLANE.md)
- [LLM_MODEL_REGISTRY.md](./LLM_MODEL_REGISTRY.md)
