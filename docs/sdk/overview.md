# SDK 与 Agent Runtime · 总览

> SDK 只提供**合同、边界和组合能力**，不替代领域服务。
> 实现入口：`packages/contracts`、`packages/ai-client`、`packages/api-client`。

## 1. 分层

| 层 | 入口 | 职责 | 直接写领域事实 |
|---|---|---|---|
| Agent Runtime | `createTutorAgentRuntime` | 绑定 server-issued scope、构建 bounded context、限制读取端口、校验结构化输出 | 否 |
| Tutor adapter | `createTutorContextReader` / `createTutorDomainWriter` | 读取 Tutor context、提交成长信号等 owner command | 仅通过 owner port |
| Domain facade | `QituSDKFactory` / `createQituSDK` | 组合 mastery、project、profile 服务端能力 | 由领域服务校验、幂等、审计 |
| Browser client | `createApiClient` / `createQituReadSDK` | HTTP 和只读 mastery projection | 否 |

## 2. 运行时链路

```text
浏览器应用
  → @qitu/api-client
      └── createQituReadSDK / createApiClient().mastery
          └── HTTP 只读掌握度投影

NestJS API
  → services/api/src/modules/qitu-sdk/QituSDKFactory
      └── packages/ai-client.createQituSDK
          ├── MasteryTimelinePort
          ├── agent.run
          ├── project.canAdvance / advance
          └── profile.get

业务 owner
  ├── learning-plan：掌握评估、事件、当前投影、TheoryMastered
  ├── projects：项目生命周期和推进命令
  ├── growth：成长记录和 profile 投影
  ├── agent-memory：Mem0 关系记忆
  └── workers：mastery.assessed → Graphiti projection
```

## 3. 前后端边界（硬规则）

- 浏览器只能消费 API 合同和 projection。
- 前端**不得**提交阶段、提示等级、掌握度、成长档案或审计字段。
- API 必须在每个请求上执行对象级权限检查。
- 所有敏感读取和写操作考虑审计、幂等、outbox 和最小可见范围。

## 4. 验证

```bash
pnpm --filter @qitu/contracts typecheck
pnpm --filter @qitu/ai-client typecheck
pnpm --filter @qitu/ai-client test
pnpm --filter @qitu/api typecheck
pnpm --filter @qitu/api test
pnpm build
```

若 workspace 依赖未安装或服务器环境缺失，应记录为**验证阻塞**，
不以 demo 模式冒充正式环境通过。

## 5. 相关文档

- [`agent-runtime.md`](./agent-runtime.md)
- [`browser-client.md`](./browser-client.md)
- [`domain-facade.md`](./domain-facade.md)
- [`agent-memory.md`](./agent-memory.md)
