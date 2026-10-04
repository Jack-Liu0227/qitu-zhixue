# Agent 记忆与上下文设计

> 文档状态：实现补充设计。Agent/Mem0/上下文边界以本文为准；掌握度时间线、mastery events、项目门槛和 Graphiti 定位以 [ADR 0009](../decisions/0009-mastery-timeline-and-graphiti.md) 为准；SDK 与 Agent Runtime 合同以 [SDK.md](./SDK.md) 为准。
>
> Graphiti 不是 `TheoryMastered`、项目状态或权限的权威来源，只是通过 outbox 异步构建的可重建掌握度时间线投影。

- 本地 DeepTutor 基线：`a053fecf6eeca51ded680de8b8fc41ef63857b11`（仅用于教学机制来源核对）。
- 产品与责任域基线：`AGENTS.md`、`docs/README.md`、`admin/ADMIN.md`、`student/STUDENT.md`、`teacher/TEACHER.md`、`parent/PARENT.md`、`SDK.md`。


## 1. 架构决策

保留 NestJS + TypeScript + PostgreSQL 的模块化单体。使用现有 Worker 工程承载异步记忆任务，不因记忆功能重写为 FastAPI，不预先引入 LangGraph、独立 Agent 平台或大量微服务。

推荐开源项目为 **Mem0 OSS**，通过业务自有 `MemoryIndexPort` 接入。首选验证 TypeScript `mem0ai/oss` + pgvector；如原生依赖、SDK 适配或部署隔离验证失败，改用内部 Mem0 服务适配器，业务合同保持不变。当前推荐不是生产验证完成的结论。

- PostgreSQL 中业务自有记录为权威数据。
- Mem0 管理的向量、关键词/实体检索数据为可重建索引，不是成长档案或掌握度真源。
- 先由启途抽取并校验记忆候选，批准后以 `infer: false` 写入已确认事实，避免 Mem0 再次重解释或直接摄取完整对话。
- `infer: false` 仅意味着写入时不进行 LLM 事实抽取，不意味着没有 embedding 调用、初始化行为、外部依赖或其他检索成本。
- Agent 身份、教学规则和全局策略不允许被学生对话直接改写。

## 2. 已实现与待实现

| 事项 | 当前实际情况 | 本轮目标方向 |
| --- | --- | --- |
| 后端与 SDK | NestJS、`TutorContextReadPorts` / `TutorDomainWritePorts`、PostgreSQL adapter | Tutor 读取与领域命令分离 |
| Partner | 固定 `qitu-learning-partner` 和描述性 capabilities | 版本化 Partner 配置、能力注册及准入 |
| 回合生成 | 一次 `ModelGateway.complete`，回答后分片，服务层缓冲 | 先统一回合合同；真实流式作为后续独立切片 |
| 会话上下文 | 本轮输入，近期活动为内容块计数 | 待答问题、学生尝试、有限近期历史/经校验摘要 |
| 长期记忆 | 存储和读取端口，无持续抽取与语义召回接线 | 候选、校验、纠错、失效、索引和召回闭环 |
| 成长投影 | 追加信号后 SDK 读改写画像 | 领域模块负责事务、版本和消费幂等 |
| 知识检索 | Tutor 私有文档检索与 `knowledge` 模块并存 | 接到统一 KnowledgeService 的授权/verified-only 边界 |
| Outbox | 写入端存在 | 实现有租约、重试、幂等和失败状态的消费 |
| Workers | `services/workers/src/index.ts` 仅启动占位 | 落地首个可靠记忆消费者 |
| 模型网关 | 文本 complete；尚无可调用 embedding 接口 | 增加有用途绑定、凭证隔离和计费的 embedding port |

当前实现以 NestJS 模块化单体、PostgreSQL 和本文定义的 Agent 记忆边界为准，不再引用旧归档提案作为设计依据。

## 3. 统一职责

```text
HTTP / SSE / 后续其他批准渠道
  -> TutorApplication / Turn Runtime
     -> AccessPolicy + PartnerRegistry + TeachingPolicy
     -> ContextBuilder
        -> SessionState / recent history
        -> authorized learner profile
        -> MemoryService -> MemoryIndexPort -> Mem0 OSS
        -> KnowledgeService -> RetrievalPort
     -> approved Capability
        -> current one-shot generation / later bounded tool loop
        -> ModelGateway
     -> output policy + atomic domain write / audit / outbox

Outbox consumer
  -> MemoryCandidateExtractor -> MemoryPolicy -> MemoryRecordStore
  -> MemoryIndexWorker -> Mem0 OSS
```

### 3.1 Partner、Capability 与 Policy 分开

- Partner：谁在陪伴。包括稳定 ID、人格版本、提示版本、能力绑定、模型用途和工具准入配置。
- Capability：本轮做什么。采用 `manifest + run(context)`，如 explore、teach、review、reflect。注册表只是确定性路由，不等同于完整 Agent Loop。
- TeachingPolicy：允许怎样教学。掌握度门槛、实践准入、提示策略、引导预算、人工升级由服务端判断。
- Turn Runtime：生命周期、会话归属、序号、幂等、取消、预算和事件恢复。禁止每个导师复制一套运行时。
- ContextBuilder：输出有 token/条数/字段预算的服务端上下文，资料与记忆明确标记为数据而非指令。
- Domain Services：项目、掌握度、作品、成长档案和审计的唯一权威入口。

工具注册在下一步实现时必须逐次授权。模型只能提出动作；工具执行器再次检查 actor、对象、项目阶段和幂等键。人格、记忆或模型输出均不能绕过 TheoryMastered。

### 3.2 最小端口草案

以下是业务自有接口方向，不是当前已经存在的 API：

```typescript
interface MemoryIndexPort {
  index(record: ApprovedMemoryRecord): Promise<IndexReceipt>;
  recall(request: AuthorizedRecallRequest): Promise<IndexHit[]>;
  remove(receipt: IndexReceipt): Promise<void>;
}

interface MemoryCandidateExtractor {
  extract(input: MinimizedLearningEvidence): Promise<MemoryCandidate[]>;
}

interface MemoryRecordStore {
  loadActive(ids: readonly string[]): Promise<ApprovedMemoryRecord[]>;
  commitCandidates(input: ValidatedCandidateBatch): Promise<void>;
  invalidate(input: AuthorizedInvalidation): Promise<void>;
}
```

授权请求必须由服务端构造，包含经过校验的对象范围与读取目的，不能接受客户端或模型直接提交 backend filters。Mem0 返回的 ID/分数必须回查本地记录，最终正文以当前有效版本为准。

## 4. Agent 专属记忆

### 4.1 四种状态不可混为一个向量集合

| 类别 | 典型内容 | 范围/写入权限 | 主要存储 |
| --- | --- | --- | --- |
| Agent 定义与程序性记忆 | 人格、教学策略、已评审的工具使用经验 | agent-definition/version；管理员或评审后发布 | 配置/版本化策略记录 |
| Agent 与学生的关系记忆 | 明确偏好、阶段目标、反复出现的学习困难 | student + partner；候选校验后写入 | 业务记忆表 + Mem0 索引 |
| 学生共享画像 | 多项目兴趣、可信成长线索 | student；领域服务投影，Partner 按授权只读 | learner/growth 领域表 |
| 当前会话状态 | 待回答问题、当前尝试、提示档位、临时草稿 | session；服务端所有，短期 | session/turn store |

Agent 专属记忆不是仅给学生记忆加 `agentId`。本轮需具备关系记忆，以及经过审批的程序性记忆记录能力；本轮不开放 Agent 自动修改自身系统提示词、工具权限或全局教学规则。

某一学生的对话不得自动成为全体学生共享的 Agent 经验。可先保存隔离候选；确有复用价值时经过脱敏与教学评审再发布，必须可撤销及回滚。

### 4.2 隔离键

业务作用域至少表达 `studentId`、`partnerId`、`projectId`、`sessionId` 及现有学校/平台授权边界。没有学校租户合同的地方不能虚构租户系统。

- 关系记忆：学生与 Partner 的稳定组合；不是 Node 进程或临时模型实例。
- 共享画像：另一次经过授权的查询，不用宽泛 OR 合并到关系记忆集合。
- Agent 公共策略：独立的批准记录，不存学生身份或个人事实。
- 发给索引后端的标识优先使用不透明命名空间键；其映射和授权仍在启途后端。
- SQL、向量召回、实体索引及缓存都必须采用同一边界。任何读取途径不得退回共享 default-user。

### 4.3 记忆记录字段

建议业务自有记录包含：

- `id`、`kind`、`scope`、`studentId`、`partnerId`、`projectId`。
- `content`、`sourceType`、`sourceRefs`、`sourceEventId`、`extractorVersion`。
- `status`：candidate / active / superseded / rejected / deleted。
- `version`、`supersedesId`、`visibility`、`validFrom`、`expiresAt`。
- `confidence`、`confirmedBy`、`createdAt`、`updatedAt`。
- 索引映射：`backend`、`backendId`、`recordVersion`、`embeddingVersion`、`indexStatus`。

`confidence` 是抽取或核验元数据，不是掌握度分数。每条模型抽取结论必须有可授权访问的来源；无来源或不支持的推断应拒绝，不能靠模型自报置信度通过。

### 4.4 写入、纠错和删除

```text
领域事实/允许使用的最小对话证据
  -> 同事务记录事件与 Outbox
  -> Worker 按 sourceEventId + extractorVersion 幂等抽取
  -> 候选 schema / 来源 / 敏感字段 / 冲突校验
  -> 本地记录批准并提交索引任务
  -> Mem0 写入 -> 保存 backendId 与版本映射
```

- 索引失败不回滚已提交的学习事实；记录显式 pending/failed，可重试。
- 至少一次投递不等于恰好一次写入。必须有租约、唯一消费键、并发限制和外部写入超时后的对账机制，避免重复索引。
- 不从完整未成年人对话/语音构建通用共享知识。允许抽取的输入必须先最小化、脱敏，并设置留存范围。
- 学生纠正时先在本地令旧记录失效，生成新版本，再异步修改/删除旧索引。即使索引未更新，召回回查也不得重新返回旧结论。
- 删除先使本地及缓存读取不可达，再清理向量、实体索引、历史副本和批准的衍生记录。备份须按明确的到期/恢复后删除重放策略处理，不能宣称所有备份即时抹除。
- 审计只保留操作与不透明引用，不保留被删除的敏感正文作为永久审计证据。
- 记忆拒绝、删除、停用及纠错接口均需对象级授权、幂等、审计与稳定错误码。

## 5. 开源选型

| 项目 | 适合的职责 | 本项目判断 |
| --- | --- | --- |
| Mem0 OSS | 可插拔长期事实记忆、索引与召回；Python/TS 入口 | 本轮优先：能保留现有运行时和 PostgreSQL 基线 |
| Graphiti | 掌握度时间线的异步、可重建查询投影 | M4 PoC / M5 非阻塞读取灰度；不参与门槛、项目状态或权限 |

| Letta / Letta Code | 有记忆和自我修改能力的完整 stateful Agent harness | 思路可借；本轮不引入第二套回合/工具/身份运行时 |
| Cognee | 多来源摄取、结构化记忆、图与向量处理 | 后续跨资料知识处理候选；当前需求窄，不先引入更宽处理系统 |

Graphiti 是 Zep 的开源框架，不意味着 Zep 托管平台全功能开源。Letta 原仓库 README 当前将源码指向 letta-code，应按目标版本核对，不照抄旧 MemGPT 接口介绍。Cognee 当前 README 包含无 LLM 的本地模型路径，不能一概说它一定需要外部 LLM。

### 5.1 已核验 Mem0 事实

- npm `mem0ai@3.3.1` 存在，许可证 Apache-2.0，导出 `./oss`，Node 要求 `>=18`。
- 下载发布 tarball 仅作静态检查，SHA-512 与 npm integrity 一致；没有安装或执行包代码。
- 发布 bundle 包含 pgvector、`infer: false` 直接事实写入分支和 `MEM0_TELEMETRY=false` 关闭遥测路径。
- 发布 bundle 静态导入 `better-sqlite3`。即使关闭内部 history，也不能假定无需原生依赖或无需验证 Node/OS/打包兼容性。
- Mem0 官方迁移文档明确新版抽取为 ADD-only；这不意味着显式 update/delete API 被全部删除。启途仍要管理冲突、有效版本和删除一致性。
- 官方迁移文档明确外部 graph store 集成已从 OSS 移走；不承诺当前 OSS 给本项目提供图记忆。
- README 的平台性能结果包含非开源优化，不能当作本项目 OSS 中文环境的效果承诺。
- pgvector 关键词路径使用 PostgreSQL `simple` 文本搜索。中文分词、语义 embedding、实体处理和纠错召回需要本项目数据集验证。
- SDK 的实体/metadata filters 不是身份认证及对象权限模型；必须由启途授权后构造，并回查本地记录。

选择 `3.3.1` 是已核验候选基线，不是“最新稳定版本”或“生产安全版本”承诺；接入时须锁版本与 integrity，并检查依赖、安全公告及回归结果。

### 5.2 模型与部署

记忆候选抽取走 `memory.extract`，embedding 走新增 `memory.embed`；统一注册、凭证、用量、超时、审计元数据和禁用策略。不能把模型供应商密钥交给前端或散落到 Mem0 自行管理的配置。

现有 ModelGateway 只提供文本 complete，没有 embedding 能力。实施必须补此接口，不能把文本模型当 embedding 模型使用。

SDK provider 桥接是试点的准入任务：官方 TS 支持 LangChain 实例型 adapter，但现有 Gateway 不是这种接口。需验证窄适配器能保留统一模型出口，不引入编排框架；未验证前不承诺可以零修改注入 Gateway。

pgvector 使用业务库之外的独立 schema/数据库权限与命名空间。创建 extension/index 属于迁移/运维职责，不依赖 SDK 在普通业务凭证下自动创建。禁止业务 SDK 获得跨业务表写权限。

关闭遥测，限制出站地址，明确 embedding、抽取模型和数据库的部署地。自托管索引不代表调用外部模型时数据不出域。

## 6. 现有实现必须先修的边界

1. `tutor-workspace.service.ts:91` 与 `:280` 使用 scope 不分支的 OR；当 query 的 `projectId=null` 时，记录的空 projectId 可能错误满足可读条件。先按 scope 验证必要字段、对象归属和非空项目访问权，再检索；接到 KnowledgeService 的统一规则。
2. 同文件 `:63-66` 先按 student 取 limit 后才按 partner 过滤。扩展多 Partner 前改为 SQL 中同时过滤，排序、有效版本和 limit 在授权候选内执行。
3. `tutor-context.ts` 的成长信号现在只走服务端原子 `commitGrowthSignal`，重复事件不会再次推进画像版本；事务提交失败时不会留下半成品画像。
4. `TutorMemory` 没有具体 `sourceRefs` 和有效版本字段；记忆 content 不能仅凭字符串进入模型上下文。
5. 待答问题、近期历史、摘要和提示状态必须恢复自持久会话。不能用向量 topK 猜“上一轮到底在问什么”。
6. 输出关键词/问号护栏只是有限检查，不是答案语义安全保证。新增记忆不能扩大提示注入面；检索正文作为不可信数据，不作为系统规则。

## 7. 分阶段实施

| 顺序 | 交付 | 主要允许文件范围 | 验证门 |
| --- | --- | --- | --- |
| 1 | 评审并统一架构文档；冻结 Partner/Memory/Context 合同 | docs、packages/contracts、packages/ai-client 的新增端口 | 与冻结产品规则一致；合同可编译 |
| 2 | 知识准入统一、成长幂等修复、关系记忆数据模型 | api/knowledge、ai-tutor、画像归属模块、database migrations | null scope、跨学生、跨 Partner、重复事件测试 |
| 3 | 可靠 Outbox 消费者及 Mem0 小型准入试点 | workers、model-registry embedding port、独立 Mem0 adapter | 真 pgvector round-trip、原生依赖、模型出口、异常重试 |
| 4 | 候选抽取、批准、纠错/删除、关系与程序性记忆接线 | agent-memory 模块、workers memory handlers、ContextBuilder | 无来源拒绝、可撤销、索引失效不可回读 |
| 5 | 灰度发布和比较验证 | memory feature flag、测试与运维文档 | 中文召回、误记忆、隐私、延迟/成本通过 |

拟新增 `services/api/src/modules/agent-memory/`；纯合同留在共享 packages，Mem0 第三方依赖放在服务端 adapter/Worker，不进入学生端或纯教学函数包。保持既有 API 兼容，不同步进行前端或长生命周期项目状态机重构。

共享合同先落地，再允许独立实现者分别负责 runtime/context、memory worker、retrieval adapter；数据库迁移与共同文件保持单写者。所有子代理是叶子，父会话拥有集成与验证。

## 8. 验收与回滚

硬性通过：

- 同一学生的不同 Partner 关系记忆隔离；不同学生及未授权教师/家长不可读取。
- 共享画像仅经过批准的只读投影进入导师上下文，任何记忆不能设置 TheoryMastered 或项目阶段。
- 重复事件、重启、并发消费、外部超时均不会产生重复业务记忆或重复成长投影。
- 纠错/删除立即对读取生效，旧向量、缓存或备份恢复不能使失效事实再次出现在 prompt。
- 无来源事实、推断性敏感标签及提示词注入不能进入批准记忆或改变工具权限。
- Mem0 故障时明确标记个性化记忆不可用，继续基本学习流程；授权错误不能伪装成空结果或切换共享作用域。
- embedding 模型/维度变更需要版本化索引重建及切换，不能混用向量。
- 遥测关闭、模型调用用途绑定、日志脱敏及存储权限通过检查。

效果准入：用合成中文学习场景，不使用未脱敏儿童对话。分别比较无长期记忆、SQL 关键词记忆与 Mem0 召回，记录 recall@K、错误记忆引用、时间/否定/纠错识别、P95 延迟和 token/embedding 成本。数值阈值在试点开始前冻结，不能看到结果后调整门槛。

回滚：关闭记忆召回开关，不撤销已提交的学习业务事实；保留本地记忆及索引映射供修复/重建。所有新 UI 信息架构变更不在本轮范围。

## 9. 证据与未验证项

官方来源：

- Mem0：<https://github.com/mem0ai/mem0>。
- 新版 OSS 迁移：<https://docs.mem0.ai/migration/oss-v2-to-v3>。
- npm 版本元数据：<https://registry.npmjs.org/mem0ai/3.3.1>。
- 已静态核对的发布包：<https://registry.npmjs.org/mem0ai/-/mem0ai-3.3.1.tgz>。
- Mem0 TS 源码路径：`mem0-ts/src/oss/src/memory/index.ts`、`vector_stores/pgvector.ts`、`utils/telemetry.ts`、`llms/langchain.ts`、`embeddings/langchain.ts`。
- Graphiti：<https://github.com/getzep/graphiti>。
- Letta 原入口与当前代码入口：<https://github.com/letta-ai/letta>、<https://github.com/letta-ai/letta-code>。
- Cognee：<https://github.com/topoteretes/cognee>。

本地来源：

- `packages/ai-client/src/tutor-context.ts`、`context-packet.ts`。
- `services/api/src/modules/ai-tutor/{tutor.service,tutor-workspace.service,gateway-tutor.provider}.ts`。
- `services/api/src/modules/knowledge/README.md` 与 scope/retrieval 实现。
- `services/api/src/common/outbox/outbox.service.ts`、`services/workers/src/index.ts`。
- DeepTutor `services/partners/interaction.py`、`runtime.py`、`workspace.py`、`tools/partner_memory.py` 及 `services/memory`。

调查限制：

- 加载了 tutor-engine、dispatching-parallel-agents、orchestrate、context-mode 和 mcp-scripting 工作流。四个只读子代理均因当前会话未在 herdr 中运行而启动失败，因此没有多 Agent 独立复核结果。
- 常规搜索与官方原始文档/源码检索可用。xAI 搜索接口缺认证；随后连接 Grok Search MCP 成功，但补充核验请求超时，没有可用于支撑结论的 Grok 答案。
- GitHub MCP 连接认证不兼容，GitHub REST 查询遭共享出口限流；不以 main 分支读取结果冒充已经锁定的上游 commit。Mem0 选型另以 npm 发布包及 integrity 固定证据。
- 未安装/执行 Mem0，未跑真实 pgvector、中文 benchmark、部署、权限回归或独立安全审计。本轮只是设计与静态选型。
- 程序性记忆发布权限、学生查看/纠错入口和具体保留周期须评审确定；无须为此改变现有产品导航。
