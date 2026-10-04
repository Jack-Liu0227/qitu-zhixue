# SDK 与 Agent Runtime

> 本文是 SDK 的唯一合同入口。包结构盘点、导出面清单和历史差异记录都属于实现细节，合并到本文后不再单独维护。

## 分层

SDK 只提供合同、边界和组合能力，不替代领域服务。

| 层 | 入口 | 职责 | 直接写领域事实 |
|---|---|---|---|
| Agent Runtime | `createTutorAgentRuntime` | 绑定 server-issued scope、构建 bounded context、限制读取端口、校验结构化输出 | 否 |
| Tutor adapter | `createTutorContextReader` / `createTutorDomainWriter` | 读取 Tutor context、提交成长信号等 owner command | 仅通过 owner port |
| Domain facade | `QituSDKFactory` / `createQituSDK` | 组合 mastery、project、profile 服务端能力 | 由领域服务校验、幂等、审计 |
| Browser client | `createApiClient` / `createQituReadSDK` | HTTP 和只读 mastery projection | 否 |

实现入口：`packages/contracts`、`packages/ai-client`、`packages/api-client`。

运行时链路：

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

## Agent Runtime 合同

版本：`qitu.agent-runtime.v1`（`packages/contracts/src/agent-runtime.ts`）。

- `TutorAgentScope` 由 API 授权后产生，包含 actor、student、school、partner、project、session 和 role。
- Agent 不能构造可信 scope，也不能持有 ORM、数据库连接或 unrestricted query。
- `TutorAgentBoundReadPorts` 不接受调用者传入 `studentId` / `projectId`；scope 在 runtime 创建时绑定，底层 adapter 仍按 scope 做对象级授权。
- Knowledge、Template 和数据库只通过有限的 `search`、`listPublished`、`readProjection` 读取。
- `TutorAgentOutput` 必须包含 `runId`、`requestId`、agent/runtime version、sourceRefs 和 toolCalls；版本、agent 或 request 不匹配的输出会被拒绝。
- 每次 run 必须提供 `idempotencyKey`。幂等存储、审计、outbox 和领域命令由 API owner 实现，runtime 不伪造写入成功。
- Agent 只能返回 reply、plan 或 projection；项目阶段、掌握度、成长事实、画像、记忆和审计由服务端 owner 提交。

## Tutor context

`TutorContextReader` 只组装有限 context packet，包含授权的学习者画像、关系记忆、模板证据、知识证据和有限近期消息。`TutorDomainWriter` 只提交服务端定义的成长命令；资源库治理由 Admin 控制面负责。

成长信号统一走 `TutorWorkspaceService.commitGrowthSignal()` 的原子事务，重复幂等键不会再次推进画像版本。

`agent-context-adapter.ts` 把 Tutor bounded packet 转换为 runtime `data`，只读 packet 进入模型适配层。

学生端自由探索和项目辅导共用 AI搭档会话入口 `/student/tutor`。无项目会话使用 `source: 'exploration'`，项目会话使用 `source: 'project'`；服务端不再把缺失项目上下文回退到 `project-demo-001`。探索草稿通过 `/api/v1/explorations` 由 Projects owner 创建，Tutor session 可通过 `explorationId` 关联，确认意图仍只能由 Projects owner 的幂等命令创建正式项目。

## Tool Registry

内置工具 registry 只保存 server-owned descriptor、版本、风险级别、能力白名单和 TheoryMastered 门禁。工具实际执行必须回到所属领域服务重新校验 actor、对象、阶段和幂等键。registry 工厂留在 `services/api/src/modules/platform-registry/built-in-tools.ts`，不放入只保留类型合同的 `packages/contracts`。

## 包导出面

### `@qitu/api-client`（浏览器边界）

| 入口 | 导出 | 说明 |
|---|---|---|
| `.` | `createApiClient(baseUrl: string): ApiClient`、`ApiError`、`createQituReadSDK(options?): QituReadSDK`、`QituReadSDK`（type）、`createMasteryReadPort`、`MasteryTransport`（type） | `ApiClient` 有 `get`/`post`/`patch` 与只读 `mastery` |
| `./readonly` | 指向 `src/qitu-sdk.ts` | 只给只读 facade 的窄入口 |

- `QituReadSDK` = `{ readonly mastery: MasteryReadPort }`；`createQituReadSDK` 返回 `Object.freeze(...)`，没有 `evaluate` / `setLevel` / `advance` 等写入口。
- 浏览器可调用 `mastery.getCurrent` / `getTimeline` / `getSnapshot` / `getThreshold` / `getRegressionAlerts`。
- `ApiClient` 的写方法是 `post`/`patch`（学生自己的探索、意图确认等），但不提供掌握度或项目阶段写入；HTTP 传输固定 `credentials: 'include'`、`cache: 'no-store'`。
- 截至 2026-10-04，仓库内没有应用代码导入 `QituReadSDK` / `createQituReadSDK`；它是保留的公开浏览器 SDK 面，由 `packages/api-client/src/qitu-sdk.test.ts` 覆盖类型约束。

### `@qitu/ai-client`（服务端纯逻辑边界）

子入口：`.`、`./pedagogy`、`./context`、`./escalation`、`./agent-runtime`、`./agent-context-adapter`、`./qitu-sdk`、`./curriculum`、`./context-packet`、`./mastery`、`./questions`、`./grading`。

- `./qitu-sdk` 导出显式 `QituSDK<Input, Result, Profile>` 接口：`scope`、`mastery`（`evaluate` / `getCurrent` / `getTimeline` / `snapshot` / `checkThreshold` / `getRegressionAlerts`）、`agent.run`、`project.canAdvance|advance`、`profile.get`。缺任一 port 仍然 fail closed（`SDK_PORT_NOT_CONFIGURED`）。
- `./curriculum` 导出两阶段学习计划引擎：`exploreCurriculumInterest`、`planCurriculum`、`generateCurriculumPlan`、`selectNextCurriculumStep`、`validateCurriculumPlan` / `assertValidCurriculumPlan`、`confirmCurriculumPlan`、`curriculumPlanKey`、`assertTemplateVersionFrozen`、`blockShapeFor`、`themeIndexFor`、`isTheoryObjective` / `isPracticeObjective`、`sessionObjectiveIds`，以及兼容层 `toLegacyLearningPlanDraft` / `validateLearningPlanDraft`。生成器是纯函数（无 DB、无网络；`now` 缺省回落到 `CURRICULUM_EPOCH`）。
- Tutor context / domain adapter 位于 `packages/ai-client/src/tutor-context.ts`。早期内存辅助函数已删除，记忆写入只走 `agent_memory_records`（服务端 owner）。

服务端调用形状：

```typescript
const sdk: QituSDK<AgentInput, AgentResult, Profile> = sdkFactory.create(actor, { studentId, projectId }, agentRunner);
await sdk.mastery.evaluate(input);       // 服务端证据校验后才可写
await sdk.mastery.checkThreshold(input);
await sdk.agent.run(input);
await sdk.project.canAdvance();
await sdk.project.advance(idempotencyKey);
await sdk.profile.get();
```

所有 port 必须由调用方提供，缺 port 不会退回 noop 或内存假成功。

## 与预期结构的差异

| 预期 | 当前实现 | 原因 / 迁移策略 |
|---|---|---|
| 独立 `packages/@qitu/sdk` | 没有独立 package；服务端 facade 在 `services/api/.../qitu-sdk`，纯组合 facade 在 `@qitu/ai-client` | 避免把数据库、Nest、浏览器 HTTP 和服务端领域逻辑混进一个包 |
| `@qitu/runtime` | Tutor 生命周期仍由 `TutorService`，掌握度由 `MasteryDomainService` | 当前模块化单体已有运行时 owner，不先引入第二套编排运行时 |
| `@qitu/memory` | 由 `@qitu/agent-memory` + `MasteryTimelinePort` + API owner 组成 | Mem0 关系记忆与掌握度事件保持不同权限、时间和数据边界 |
| `@qitu/project` | `ProjectsModule` + `ProjectLifecycleService` + `LearningPlanModule` | 项目状态机不能被 SDK facade 绕过 |
| `@qitu/template` | `TemplatesModule`、`PlanGenerator` 和 `@qitu/ai-client/src/curriculum.ts` | 计划模板和版本治理属于服务端 owner |
| 计划生成只有一套实现 | 当前有两套：`services/api/src/modules/learning-plan/plan-generator.ts`（`CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1'`，旧形状）与 `packages/ai-client/src/curriculum.ts`（新形状） | 新模块用兼容层双向对齐；plan-api 切读新模块前保持双轨 |
| `@qitu/knowledge` | 当前为 `KnowledgeModule`，暂无独立 KnowledgePoint package | canonical KnowledgePoint 需要课程治理和数据回填后再抽包 |
| Graphiti 作为权威 | PostgreSQL 事件/投影是权威，Graphiti 是异步可重建投影 | 保护项目门槛、审计、权限和故障降级 |
| SDK 向浏览器提供 `mastery.evaluate` | 浏览器只有只读 mastery API，服务端 facade 才有 evaluate | 未成年人掌握度和项目状态只能由服务端写入 |

## Graphiti 配置状态

仓库已配置 `services/graphiti/bridge.py`（结构化、最小化、无 LLM/embedding 抽取）、`services/graphiti/Dockerfile`、`docker-compose.yml`（Neo4j + bridge）、`requirements.txt`、`tooling/qitu-graphiti.sh`（up/init/status/down）和 `services/workers`（receipt、lease、retry、rebuild、reconcile）。`QITU_GRAPHITI_ENABLED=false` 默认关闭。

当前环境没有 Docker，也没有安装 `graphiti-core`，因此真实 Neo4j round-trip、备份恢复、性能和成本尚未验收。启用前必须运行 bridge 单元测试、迁移 replay、合成数据 round-trip、断电恢复和权限/删除对账。

## 待补能力

- 真实 runtime resolver、capability 配置持久化、tool execution owner、growth/profile projection worker，以及把 Tutor provider executor 接入新 runtime。
- `QituSDK`、旧 Tutor workspace 表和 `api-client` 只读 facade 暂不删除：仓库仍有明确 API/测试/文档引用，删除前需要外部消费者和数据库迁移证据。

这些项不在纯合同底座改造中伪装成已完成。

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

- [ADMIN.md](../admin/ADMIN.md)
- [STUDENT.md](../student/STUDENT.md)
- [AGENT_MEMORY.md](./AGENT_MEMORY.md)
- [ARCHITECTURE.md](../shared/ARCHITECTURE.md)
- [DATABASE.md](../shared/DATABASE.md)
- [PLATFORM_CONTROL_PLANE.md](../admin/PLATFORM_CONTROL_PLANE.md)
- [LLM_MODEL_REGISTRY.md](../admin/LLM_MODEL_REGISTRY.md)
