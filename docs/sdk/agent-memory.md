# Agent 记忆与上下文

> 非权威边界说明：掌握度时间线 / 项目门槛 / Graphiti 定位以
> [`../student/growth.md`](../student/growth.md) §3 为准；
> SDK 与 Agent Runtime 合同以 [`agent-runtime.md`](./agent-runtime.md) 为准。
> **Graphiti 不是 `TheoryMastered`、项目状态或权限的权威来源。**

## 1. 架构决策

保留 NestJS + TypeScript + PostgreSQL 的模块化单体。使用现有 Worker 工程承载异步记忆任务，
**不**重写为 FastAPI，**不**预先引入 LangGraph / 独立 Agent 平台 / 大量微服务。

推荐开源项目 **Mem0 OSS**，通过业务自有 `MemoryIndexPort` 接入。
首选验证 TypeScript `mem0ai/oss` + pgvector；若原生依赖 / SDK 适配 / 部署隔离验证失败，
改用内部 Mem0 服务适配器，业务合同不变。**当前推荐不是生产验证完成的结论。**

- PostgreSQL 中业务自有记录为**权威数据**。
- Mem0 管理的向量、关键词 / 实体检索数据为**可重建索引**，不是成长档案或掌握度真源。
- 先由启途抽取并校验记忆候选，批准后以 `infer: false` 写入已确认事实，
  避免 Mem0 再次重解释或直接摄取完整对话。
- `infer: false` **仅**表示写入时不进行 LLM 事实抽取，不意味着没有 embedding 调用、
  初始化行为、外部依赖或其他检索成本。
- Agent 身份、教学规则和全局策略**不允许**被学生对话直接改写。

## 2. 统一职责

```text
HTTP / SSE
  -> TutorApplication / Turn Runtime
     -> AccessPolicy + PartnerRegistry + TeachingPolicy
     -> ContextBuilder
        -> SessionState / recent history
        -> authorized learner profile
        -> MemoryService -> MemoryIndexPort -> Mem0 OSS
        -> KnowledgeService -> RetrievalPort
     -> approved Capability -> ModelGateway
     -> output policy + atomic domain write / audit / outbox

Outbox consumer
  -> MemoryCandidateExtractor -> MemoryPolicy -> MemoryRecordStore
  -> MemoryIndexWorker -> Mem0 OSS
```

职责分离：

- **Partner**：谁在陪伴（稳定 ID、人格版本、提示版本、能力绑定、模型用途、工具准入）。
- **Capability**：本轮做什么（`manifest + run(context)`：explore / teach / review / reflect）。
- **TeachingPolicy**：允许怎样教学（掌握度门槛、实践准入、提示策略、引导预算、人工升级）。
- **Turn Runtime**：生命周期、会话归属、序号、幂等、取消、预算、事件恢复。
- **ContextBuilder**：输出有 token / 条数 / 字段预算的上下文；资料与记忆标记为**数据而非指令**。
- **Domain Services**：项目、掌握度、作品、成长档案和审计的唯一权威入口。

工具注册必须**逐次授权**；模型只能提出动作，执行器再次检查 actor、对象、阶段和幂等键。

### 2.1 端口草案（方向，非已存在 API）

```typescript
interface MemoryIndexPort {
  index(record: ApprovedMemoryRecord): Promise<IndexReceipt>;
  recall(request: AuthorizedRecallRequest): Promise<IndexHit[]>;
  remove(receipt: IndexReceipt): Promise<void>;
}
interface MemoryCandidateExtractor { extract(input: MinimizedLearningEvidence): Promise<MemoryCandidate[]>; }
interface MemoryRecordStore {
  loadActive(ids: readonly string[]): Promise<ApprovedMemoryRecord[]>;
  commitCandidates(input: ValidatedCandidateBatch): Promise<void>;
  invalidate(input: AuthorizedInvalidation): Promise<void>;
}
```

授权请求必须由服务端构造，含校验过的对象范围与读取目的；**不接受**客户端或模型提交 backend filters。
Mem0 返回的 ID / 分数必须回查本地记录，最终正文以当前有效版本为准。

## 3. 四类记忆不可混为一个向量集合

| 类别 | 范围 / 写权限 | 主要存储 |
|---|---|---|
| Agent 定义与程序性记忆 | agent-definition/version；管理员或评审后发布 | 配置 / 版本化策略记录 |
| Agent 与学生的关系记忆 | student + partner；候选校验后写入 | 业务记忆表 + Mem0 索引 |
| 学生共享画像 | student；领域服务投影，Partner 按授权只读 | learner/growth 领域表 |
| 当前会话状态 | session；服务端所有，短期 | session/turn store |

- 关系记忆隔离键为 `studentId` + `partnerId`（+ `projectId` / `sessionId` / 学校边界）。
- 学生共享画像是**另一次**授权查询，不用宽泛 OR 合并到关系记忆集合。
- 某一学生的对话**不得**自动成为全体学生共享的 Agent 经验；复用需脱敏 + 教学评审，可撤销回滚。
- 任何读取途径**不得**退回共享 default-user。

## 4. 写入、纠错和删除

```text
领域事实 / 允许使用的最小对话证据
  -> 同事务记录事件与 Outbox
  -> Worker 按 sourceEventId + extractorVersion 幂等抽取
  -> 候选 schema / 来源 / 敏感字段 / 冲突校验
  -> 本地记录批准并提交索引任务
  -> Mem0 写入 -> 保存 backendId 与版本映射
```

- 索引失败**不回滚**已提交的学习事实；记录显式 pending/failed，可重试。
- 至少一次投递 ≠ 恰好一次写入；须有租约、唯一消费键、并发限制和超时后对账。
- 不从完整未成年人对话 / 语音构建通用共享知识；抽取输入先最小化、脱敏并设留存范围。
- 学生纠正时先在本地令旧记录失效，生成新版本，再异步改 / 删旧索引；
  即使索引未更新，召回回查也不得重新返回旧结论。
- 删除先使本地及缓存读取不可达，再清向量 / 实体索引 / 历史副本；备份按明确到期 / 恢复后删除重放策略处理。
- 审计只保留操作与不透明引用，不保留被删除的敏感正文。

## 5. 已核验事实与选型

| 项目 | 本项目判断 |
|---|---|
| Mem0 OSS | 本轮优先：可保留现有运行时和 PostgreSQL 基线 |
| Graphiti | 掌握度时间线的异步可重建投影；不参与门槛 / 项目状态 / 权限 |
| Letta / Letta Code | 思路可借；本轮不引入第二套回合 / 工具 / 身份运行时 |
| Cognee | 后续跨资料知识处理候选；当前需求窄，不先引入 |

已静态核验：npm `mem0ai@3.3.1`（Apache-2.0，`./oss`，Node ≥18）发布包含 pgvector、
`infer: false` 直接写入分支和 `MEM0_TELEMETRY=false`；但静态导入 `better-sqlite3`，
**不能**假定无需原生依赖 / 无需 Node/OS 兼容性验证。外部 graph store 已从 OSS 移走。
SDK 的 entity / metadata filters **不是**身份认证及对象权限模型。

模型用途：记忆候选抽取走 `memory.extract`，embedding 走新增 `memory.embed`；
统一注册、凭证、用量、超时、审计元数据和禁用策略。
**现有 ModelGateway 只有文本 complete，没有 embedding**——实施必须补此接口。

## 6. 必须先修的边界

1. `tutor-workspace.service.ts:91` 与 `:280` 使用 scope 不分支的 OR；当 `projectId=null` 时
   空 projectId 记录可能错误满足可读条件。先按 scope 验证必要字段、对象归属和非空项目访问权。
2. 同文件 `:63-66` 先按 student 取 limit 后才按 partner 过滤；扩展多 Partner 前改为 SQL 同时过滤。
3. 记忆 content 不能仅凭字符串进入模型上下文；需具体 `sourceRefs` 和有效版本字段。
4. 待答问题、近期历史、摘要和提示状态必须恢复自持久会话，不能用向量 topK 猜「上一轮在问什么」。
5. 输出关键词 / 问号护栏只是有限检查，不是答案语义安全保证；检索正文作为不可信数据。

## 7. 分阶段实施

| 顺序 | 交付 | 验证门 |
|---|---|---|
| 1 | 评审并统一架构文档；冻结 Partner / Memory / Context 合同 | 与冻结产品规则一致；合同可编译 |
| 2 | 知识准入统一、成长幂等修复、关系记忆数据模型 | null scope、跨学生、跨 Partner、重复事件测试 |
| 3 | 可靠 Outbox 消费者及 Mem0 小型准入试点 | 真 pgvector round-trip、原生依赖、模型出口、异常重试 |
| 4 | 候选抽取、批准、纠错 / 删除、关系与程序性记忆接线 | 无来源拒绝、可撤销、索引失效不可回读 |
| 5 | 灰度发布和比较验证 | 中文召回、误记忆、隐私、延迟 / 成本通过 |

拟新增 `services/api/src/modules/agent-memory/`；纯合同留共享 packages，
Mem0 第三方依赖放服务端 adapter / Worker，不进入学生端或纯教学函数包。

## 8. 验收与回滚

硬性通过：

- 同一学生不同 Partner 关系记忆隔离；不同学生及未授权教师 / 家长不可读取。
- 共享画像仅经批准的只读投影进入导师上下文；任何记忆不能设置 `TheoryMastered` 或项目阶段。
- 重复事件、重启、并发消费、外部超时均不产生重复业务记忆或重复成长投影。
- 纠错 / 删除立即对读取生效。
- 无来源事实、推断性敏感标签及提示词注入不能进入批准记忆或改变工具权限。
- Mem0 故障时明确标记个性化记忆不可用，继续基本学习流程；授权错误不能伪装成空结果。
- embedding 模型 / 维度变更需版本化索引重建及切换。

效果准入：用**合成**中文学习场景（不使用未脱敏儿童对话），比较无长期记忆 /
SQL 关键词记忆 / Mem0 召回，记录 recall@K、错误记忆引用、时间 / 否定 / 纠错识别、
P95 延迟和成本；**阈值在试点开始前冻结**。

回滚：关闭记忆召回开关，不撤销已提交的学习业务事实。

## 9. 未决事项

- [ ] Mem0 `better-sqlite3` 原生依赖与 Node/OS/打包兼容性验证。
- [ ] pgvector 独立 schema / 数据库权限与命名空间；中文分词与召回基准。
- [ ] embedding port 与用途绑定、计费。
- [ ] 程序性记忆发布权限、学生查看 / 纠错入口、保留周期。
- [ ] 真实 pgvector round-trip、部署、权限回归、独立安全审计。

## 10. 相关文档

- [`overview.md`](./overview.md)
- [`agent-runtime.md`](./agent-runtime.md)
- [`../student/growth.md`](../student/growth.md)
- [`../admin/model-registry.md`](../admin/model-registry.md)
