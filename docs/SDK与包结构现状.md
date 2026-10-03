# SDK 与预期架构差异

更新：2026-10-03

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

## 与预期结构的差异

| 预期 | 当前实现 | 原因/迁移策略 |
|---|---|---|
| `packages/@qitu/sdk` | 没有独立 package；服务端 facade 在 `services/api/.../qitu-sdk`，纯组合 facade 在 `@qitu/ai-client` | 避免把数据库、Nest、浏览器 HTTP 和服务端领域逻辑混进一个包；后续如需发布独立 SDK，可把纯合同 facade 移出，但不复制领域逻辑 |
| `@qitu/runtime` | Tutor 生命周期仍由 `TutorService`，掌握度由 `MasteryDomainService` | 当前模块化单体已有运行时 owner；不先引入第二套编排运行时 |
| `@qitu/memory` | 当前由 `@qitu/agent-memory` + `MasteryTimelinePort` + API owner 组成 | Mem0 关系记忆与掌握度事件必须保持不同权限、时间和数据边界 |
| `@qitu/project` | 当前为 `ProjectsModule` + `ProjectLifecycleService` + `LearningPlanModule` | 项目状态机不能被 SDK facade 绕过；owner 仍在 API domain module |
| `@qitu/template` | 当前为 `TemplatesModule`、`PlanGenerator` 和已有 `@qitu/ai-client` curriculum | 计划模板和版本治理属于服务端 owner，纯生成规则留在 ai-client |
| `@qitu/knowledge` | 当前为 `KnowledgeModule`；尚未有独立 KnowledgePoint package | canonical KnowledgePoint 需要课程治理和数据回填后再抽包 |
| Graphiti 直接作为权威 | 当前 PostgreSQL 事件/投影是权威，Graphiti 是异步可重建投影 | 保护项目门槛、审计、权限和故障降级 |
| SDK 直接提供 `mastery.evaluate` 给浏览器 | 浏览器只有只读 mastery API；服务端 facade 才有 evaluate | 未成年人掌握度和项目状态只能由服务端写入 |
| Graphiti 直接读入家长/教师端 | 读取先过 API `AccessPolicy`，再做字段投影 | Graphiti group/namespace 不是授权模型 |

## 当前已接入的公开入口

### 浏览器

```typescript
const sdk = createQituReadSDK({ baseUrl: '', studentId });
await sdk.mastery.getCurrent({ knowledgePointId, courseVersion });
await sdk.mastery.getTimeline({ knowledgePointId, courseVersion, limit: 50 });
await sdk.mastery.getSnapshot({ validAt });
await sdk.mastery.getThreshold({ knowledgePointId, courseVersion });
await sdk.mastery.getRegressionAlerts({ knowledgePointId });
```

浏览器 SDK 没有 `evaluate`、`setLevel`、`advance` 或任意项目状态写方法。

### 服务端

```typescript
const sdk = sdkFactory.create(actor, { studentId, projectId }, agentRunner);
await sdk.mastery.evaluate(input);       // 服务端证据校验后才可写
await sdk.mastery.checkThreshold(input);
await sdk.agent.run(input);
await sdk.project.canAdvance();
await sdk.project.advance(idempotencyKey);
await sdk.profile.get();
```

这些端口都必须由调用方提供，缺少 port 会 fail closed；不会退回 noop 或内存假成功。

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
