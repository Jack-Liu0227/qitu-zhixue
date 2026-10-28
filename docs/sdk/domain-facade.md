# 领域 Facade（服务端 SDK）

> 服务端组合门面：`QituSDKFactory`（`services/api/src/modules/qitu-sdk`）→
> `packages/ai-client` 的 `createQituSDK`。子入口 `./qitu-sdk`。

## 1. 显式接口

```typescript
interface QituSDK<Input, Result, Profile> {
  scope: QituSDKScope;
  mastery: {
    evaluate(input): Promise<MasteryAssessmentResult>;
    getCurrent(input): Promise<CurrentMasteryProjection[]>;
    getTimeline(input): Promise<MasteryTimelinePoint[]>;
    snapshot(input): Promise<MasterySnapshot>;
    checkThreshold(input): Promise<ThresholdResult>;
    getRegressionAlerts(input): Promise<MasteryRegression[]>;
  };
  agent: { run(input: Input): Promise<Result> };
  project: {
    canAdvance(): Promise<QituProjectGate>;
    advance(idempotencyKey: string): Promise<...>;
  };
  profile: { get(): Promise<Profile> };
}
```

- mastery / agent / project / profile 领域 port **必须由调用方提供**；缺 port 不会退回 noop 或内存假成功——fail closed
  （`SDK_PORT_NOT_CONFIGURED`）。

## 2. 服务端调用形状

```typescript
const sdk: QituSDK<AgentInput, AgentResult, Profile> =
  sdkFactory.create(actor, { studentId, projectId }, agentRunner);

await sdk.mastery.evaluate(input);        // 服务端证据校验后才可写
await sdk.mastery.checkThreshold(input);
await sdk.agent.run(input);
await sdk.project.canAdvance();
await sdk.project.advance(idempotencyKey);
await sdk.profile.get();
```

## 3. 边界与门禁

- `project.canAdvance()` 只调用 `checkThreshold()`——项目推进的判定唯一来源是当前掌握度投影。
- `mastery.evaluate()` 只在服务端证据校验后才写；`MasteryTimelinePort` 不暴露 Graphiti 类型。
- `QituSDKFactory` 绑定 student / project scope；API 内部模块，**不导出数据库或 Graphiti 类型**。
- 领域事实由领域服务校验、幂等、审计，facade 不绕过项目状态机。
- API 内部 owner：`learning-plan`（评估 / 事件 / 投影 / `TheoryMastered`）、
  `projects`（生命周期与推进）、`growth`（记录与 profile 投影）、
  `agent-memory`（Mem0 关系记忆）、`workers`（投影）。

## 4. 与「预期结构」的差异

| 预期 | 当前实现 | 原因 / 迁移策略 |
|---|---|---|
| 独立 `packages/@qitu/sdk` | 没有独立 package；服务端 facade 在 `services/api/.../qitu-sdk`，纯组合 facade 在 `@qitu/ai-client` | 避免把数据库、Nest、浏览器 HTTP 和服务端领域逻辑混进一个包 |
| `@qitu/runtime` | Tutor 生命周期仍由 `TutorService`，掌握度由 `MasteryDomainService` | 模块化单体已有运行时 owner，不先引入第二套编排运行时 |
| `@qitu/memory` | 由 `@qitu/agent-memory` + `MasteryTimelinePort` + API owner 组成 | Mem0 关系记忆与掌握度事件保持不同权限、时间和数据边界 |
| `@qitu/project` | `ProjectsModule` + `ProjectLifecycleService` + `LearningPlanModule` | 项目状态机不能被 SDK facade 绕过 |
| `@qitu/template` | `TemplatesModule`、`PlanGenerator` 和 `@qitu/ai-client/src/curriculum.ts` | 计划模板和版本治理属于服务端 owner |
| 计划生成只有一套实现 | 两套：`plan-generator.ts`（旧形状）与 `packages/ai-client/src/curriculum.ts`（新形状） | 新模块用兼容层双向对齐；plan-api 切读新模块前保持双轨 |
| `@qitu/knowledge` | 当前为 `KnowledgeModule`，暂无独立 KnowledgePoint package | canonical KnowledgePoint 需要课程治理和数据回填后再抽包 |
| Graphiti 作为权威 | PostgreSQL 事件 / 投影是权威，Graphiti 是异步可重建投影 | 保护项目门槛、审计、权限和故障降级 |
| SDK 向浏览器提供 `mastery.evaluate` | 浏览器只有只读 mastery API | 未成年人掌握度和项目状态只能由服务端写入 |

## 5. 相关文档

- [`overview.md`](./overview.md)
- [`agent-runtime.md`](./agent-runtime.md)
- [`../student/learning-plan.md`](../student/learning-plan.md)

## 6. Skills、工具与团队目录（2026-10-21）

目录通过服务端 catalog 端口异步投影，使用 `await sdk.skills.list()`、`await sdk.tools.list()`、`await sdk.assistants.get(id)` 等调用。没有注入目录时返回空列表；未知团队不会回退到默认团队。API factory 当前提供所选助手、真实已发布技能、工具描述和两个只读 owner；团队组合方仍须提供经授权的冻结版本。

工具目录只返回描述与 schema，不暴露 execute closure。`sdk.tools.call()` 在每次调用时重新授权，绑定原 student/project scope。错误区分 `SDK_TOOL_NOT_FOUND`、`SDK_TOOL_NOT_CONFIGURED`、`SDK_TOOL_DENIED`；MCP 对应 `SDK_MCP_NOT_CONFIGURED` / `SDK_MCP_DENIED`，没有执行器不返回成功回显。

`RUNTIME_TOOL_CATALOG` 是 canonical 定义来源；领域服务描述、SDK 只读接口与模型工具有不同调用入口。目录中有名称不表示已授予模型执行权限，领域服务绑定不能停用服务端门禁。API factory 的 `mastery_query` 与 `student_profile_get` 复用现有 owner；知识搜索/读取经 Tutor 的受控 closure 执行。

完整边界与验证见 [本次优化报告](../../Plan/codex/runtime-governance-optimization-20261021.md)。
