# SDK 与预期架构差异

> 本文是包结构的实现盘点，不是新的合同。跨端规则和 Agent Runtime 合同以 [`SDK.md`](./SDK.md) 为准；本文只记录代码位置和验证结果。

更新：2026-10-04

## 当前实现结构

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

## 包导出面（当前）

### `@qitu/api-client`（浏览器边界）

| 入口 | 导出 | 说明 |
|---|---|---|
| `.` | `createApiClient(baseUrl: string): ApiClient`、`ApiError`、`createQituReadSDK(options?): QituReadSDK`、`QituReadSDK`（type）、`createMasteryReadPort`、`MasteryTransport`（type） | `ApiClient` 有 `get`/`post`/`patch` 与只读 `mastery` |
| `./readonly` | 指向 `src/qitu-sdk.ts` | 只给只读 facade 的窄入口 |

- `QituReadSDK` = `{ readonly mastery: MasteryReadPort }`；`createQituReadSDK` 返回
  `Object.freeze(...)`，没有 `evaluate` / `setLevel` / `advance` 等写入口。
- `ApiClient` 的写方法是 `post`/`patch`（学生自己的探索/意图确认等），但**不**提供掌握度或
  项目阶段写入；HTTP 传输固定 `credentials: 'include'`、`cache: 'no-store'`。
- **诚实标注**：截至本次文档更新，仓库内没有应用代码导入 `QituReadSDK` / `createQituReadSDK`
  （`grep -rn "createQituReadSDK" apps services` 无命中）；它是保留的公开浏览器 SDK 面，
  由 `packages/api-client/src/qitu-sdk.test.ts` 覆盖类型约束。

### `@qitu/ai-client`（服务端纯逻辑边界）

- 子入口导出：`.`、`./pedagogy`、`./context`、`./escalation`、`./agent-runtime`、`./agent-context-adapter`、`./qitu-sdk`、`./curriculum`、
  `./curriculum`、`./context-packet`、`./mastery`、`./questions`、`./grading`。
- `./qitu-sdk` 现在导出显式 `QituSDK<Input, Result, Profile>` 接口：`scope`、`mastery`
  （`evaluate` / `getCurrent` / `getTimeline` / `snapshot` / `checkThreshold` /
  `getRegressionAlerts`）、`agent.run`、`project.canAdvance|advance`、`profile.get`。
  缺任一 port 仍 fail closed（`SDK_PORT_NOT_CONFIGURED`）。
- `./curriculum` 导出两阶段学习计划引擎：`exploreCurriculumInterest`、`planCurriculum`、
  `generateCurriculumPlan`、`selectNextCurriculumStep`、`validateCurriculumPlan` /
  `assertValidCurriculumPlan`、`confirmCurriculumPlan`、`curriculumPlanKey`、
  `assertTemplateVersionFrozen`、`blockShapeFor`、`themeIndexFor`、`isTheoryObjective` /
  `isPracticeObjective`、`sessionObjectiveIds`，以及兼容层 `toLegacyLearningPlanDraft` /
  `validateLearningPlanDraft`。生成器是**纯函数**（无 DB、无网络、无时钟默认值：`now` 缺省时回落到
  `CURRICULUM_EPOCH`）。测试断言已并入 `pnpm --filter @qitu/ai-client test`。

### 已删除的导出（附调用方证据）

`@qitu/ai-client` 的 Tutor context/domain adapter 位于 `packages/ai-client/src/tutor-context.ts`；历史内存辅助函数已删除，仓库无源码命中。
记忆写入现在只走 `agent_memory_records`（服务端 owner），SDK 不再自带信心度夹取工具。

## 与预期结构的差异

| 预期 | 当前实现 | 原因/迁移策略 |
|---|---|---|
| `packages/@qitu/sdk` | 没有独立 package；服务端 facade 在 `services/api/.../qitu-sdk`，纯组合 facade 在 `@qitu/ai-client` | 避免把数据库、Nest、浏览器 HTTP 和服务端领域逻辑混进一个包；后续如需发布独立 SDK，可把纯合同 facade 移出，但不复制领域逻辑 |
| `@qitu/runtime` | Tutor 生命周期仍由 `TutorService`，掌握度由 `MasteryDomainService` | 当前模块化单体已有运行时 owner；不先引入第二套编排运行时 |
| `@qitu/memory` | 当前由 `@qitu/agent-memory` + `MasteryTimelinePort` + API owner 组成 | Mem0 关系记忆与掌握度事件必须保持不同权限、时间和数据边界 |
| `@qitu/project` | 当前为 `ProjectsModule` + `ProjectLifecycleService` + `LearningPlanModule` | 项目状态机不能被 SDK facade 绕过；owner 仍在 API domain module |
| `@qitu/template` | 当前为 `TemplatesModule`、`PlanGenerator` 和 `@qitu/ai-client/src/curriculum.ts` | 计划模板和版本治理属于服务端 owner；两阶段生成规则已在 ai-client 落地，plan-api 迁移见下行 |
| 计划生成只有一套实现 | **当前有两套**：`services/api/src/modules/learning-plan/plan-generator.ts`（`CURRICULUM_TEMPLATE_VERSION = 'curriculum-plan-v1'`，旧形状）与 `packages/ai-client/src/curriculum.ts`（新形状） | 新模块已用兼容层 `toLegacyLearningPlanDraft` + `validateLearningPlanDraft` 双向对齐；plan-api 按新模块切读前保持双轨，不删除旧生成器 |
| `@qitu/knowledge` | 当前为 `KnowledgeModule`；尚未有独立 KnowledgePoint package | canonical KnowledgePoint 需要课程治理和数据回填后再抽包 |
| Graphiti 直接作为权威 | 当前 PostgreSQL 事件/投影是权威，Graphiti 是异步可重建投影 | 保护项目门槛、审计、权限和故障降级 |
| SDK 直接提供 `mastery.evaluate` 给浏览器 | 浏览器只有只读 mastery API；服务端 facade 才有 evaluate | 未成年人掌握度和项目状态只能由服务端写入 |
| Graphiti 直接读入家长/教师端 | 读取先过 API `AccessPolicy`，再做字段投影 | Graphiti group/namespace 不是授权模型 |

## 当前已接入的公开入口

### 浏览器

```typescript
const sdk: QituReadSDK = createQituReadSDK({ baseUrl: '', studentId });
await sdk.mastery.getCurrent({ knowledgePointId, courseVersion });
await sdk.mastery.getTimeline({ knowledgePointId, courseVersion, limit: 50 });
await sdk.mastery.getSnapshot({ validAt });
await sdk.mastery.getThreshold({ knowledgePointId, courseVersion });
await sdk.mastery.getRegressionAlerts({ knowledgePointId });
```

浏览器 SDK 没有 `evaluate`、`setLevel`、`advance` 或任意项目状态写方法。

### 服务端

```typescript
const sdk: QituSDK<AgentInput, AgentResult, Profile> = sdkFactory.create(actor, { studentId, projectId }, agentRunner);
await sdk.mastery.evaluate(input);       // 服务端证据校验后才可写
await sdk.mastery.checkThreshold(input);
await sdk.agent.run(input);
await sdk.project.canAdvance();
await sdk.project.advance(idempotencyKey);
await sdk.profile.get();
```

这些端口都必须由调用方提供，缺少 port 会 fail closed；不会退回 noop 或内存假成功。

## SDK 底座重设计（2026-10-04）

当前 SDK 不是三套等价 SDK，而是三层职责：

| 层 | 入口 | 唯一职责 | 是否允许写领域事实 |
|---|---|---|---|
| Agent runtime | `createTutorAgentRuntime(scope, ports)` | 绑定授权 scope、构建 bounded context、限制读取端口、校验结构化输出 | 否；只能返回 output/projection |
| Tutor adapter | `createTutorContextReader` / `createTutorDomainWriter` | 把现有 Tutor workspace 适配为读端口和领域命令端口 | 仅通过 owner port 写成长、记忆等命令 |
| Domain facade | `QituSDKFactory` / `createQituSDK` | 绑定 mastery、项目推进和 profile 的服务端领域能力 | 由对应领域服务校验、幂等、审计后写入 |

### 新 Agent runtime 合同

`packages/contracts/src/agent-runtime.ts` 冻结 `qitu.agent-runtime.v1`：

- `TutorAgentScope` 由 API 授权后产生，包含 actor、student、school、partner、project、session 和 role；客户端不能构造可信 scope。
- `TutorAgentBoundReadPorts` 对外不再接受 `studentId` / `projectId`，读取调用只能使用创建 runtime 时绑定的 scope。底层 adapter 仍需按 scope 做对象级授权。
- Knowledge、Template 和数据库只通过 `readProjection` / `search` / `listPublished` 暴露；不暴露 ORM、数据库连接、任意 SQL 或原始会话。
- `TutorAgentOutput` 必须带 `runId`、`requestId`、runtime/agent 版本、来源引用和工具调用记录；runtime 会拒绝版本、agent 或 request 不匹配的输出。
- `idempotencyKey` 是 Agent run 的必填字段。幂等存储、审计、outbox 和领域命令仍由 API owner 实现，runtime 不自行伪造写入成功。
- `createTutorAgentToolRegistry` 只返回匹配 capability 的 server-owned descriptor；工具函数、凭证和学生数据不进入 registry。

### 迁移与兼容策略

- `createTutorAgentRuntime` 是唯一 Agent runtime 入口，负责 scope 绑定、读取端口和结构化输出校验。
- `TutorContextReader` / `TutorDomainWriter` 是 Tutor 适配层；API 的 `TutorService` 分别依赖两者，避免读写端口混用。
- `QituSDK` 不与 Agent runtime 合并。它负责 mastery/project/profile 的领域 facade，不能被 Agent 或浏览器直接替代。
- `agent-context-adapter.ts` 将旧 Tutor bounded packet 转换为 runtime `data`，只读 packet 进入模型适配层；后续真实 executor 接入时不需要重新设计上下文合同。

### 已识别的冗余与暂不删除项

- 冗余已清理：旧聚合入口和早期未版本化运行入口已删除，统一使用窄适配器和版本化 runtime。
- 暂不删除：`QituSDK`、旧 Tutor workspace 表和 `api-client` 只读 facade。仓库仍有明确 API/测试/文档引用，删除前需要外部消费者和数据库迁移证据。
- 待补：真实 runtime resolver、capability 配置持久化、tool execution owner、growth/profile projection worker，以及把 Tutor provider executor 接入新 runtime。它们不在本次纯合同底座改造中伪装成已完成。
## Graphiti 配置状态

仓库已经配置：

- `services/graphiti/bridge.py`：结构化、最小化、无 LLM/embedding 抽取 bridge；
- `services/graphiti/Dockerfile`；
- `services/graphiti/docker-compose.yml`：Neo4j + bridge；
- `services/graphiti/requirements.txt`：固定 `graphiti-core` 候选版本；
- `tooling/qitu-graphiti.sh`：up/init/status/down；
- `services/workers`：receipt、lease、retry、rebuild、reconcile；
- `QITU_GRAPHITI_ENABLED=false` 默认关闭。

当前环境没有 Docker，也没有安装 `graphiti-core`，所以真实 Neo4j round-trip、备份恢复、
性能和成本仍未验收。启用前必须运行 bridge 单元测试、迁移 replay、合成数据 round-trip、
断电恢复和权限/删除对账。

## 学生端统一导师会话（Issue #14）

学生端自由探索和项目辅导共用 AI搭档会话入口 `/student/tutor`。无项目会话使用 `source: 'exploration'`，项目会话使用 `source: 'project'`；服务端不再把缺失项目上下文回退到 `project-demo-001`。探索草稿通过 `/api/v1/explorations` 由 Projects owner 创建，Tutor session 可通过 `explorationId` 关联，确认意图仍只能由 Projects owner 的幂等命令创建正式项目。

浏览器侧只提交学生文本和幂等键；阶段、提示等级、教学策略、项目状态、掌握度、成长档案和审计由服务端决定。AI搭档界面只保留左侧上下文进度、文字对话和 Composer。

该合同和 `0013_tutor_exploration_context.sql` 仍属于 Issue #14 进行中阶段；真实数据库迁移、跨学生 exploration/session 授权测试和全量构建通过后，才能将 ADR 0010 改为 Accepted 并关闭 Issue。
