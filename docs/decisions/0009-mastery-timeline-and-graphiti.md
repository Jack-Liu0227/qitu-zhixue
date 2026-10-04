# ADR 0009：掌握度时间线与 Graphiti 投影架构

- 状态：**Accepted（领域能力确定；Graphiti 权威层否决）**
- 日期：2026-10-02
- 范围：掌握度事件、当前门槛、成长轨迹、Graphiti 时序投影、Mem0 边界
- 关联：ADR 0001、ADR 0002、ADR 0003、ADR 0006、ADR 0008、`docs/shared/ARCHITECTURE.md`、`docs/shared/DATABASE.md`
- 实施计划：本文第 9 节；详细接手顺序见 `docs/shared/HANDOVER.md`

## 1. 决策摘要

掌握度时间线提升为一等领域能力，但 Graphiti 不作为掌握度交易真源。

```text
PostgreSQL mastery events
        │
        ├── current mastery projection
        ├── TheoryMastered / project gate
        ├── mastery timeline API
        └── outbox → Graphiti temporal projection

Trajectory / L1 → 原始过程证据与审计引用
Mem0           → 长期偏好、兴趣、风格和关系记忆
L2 / L3        → 阶段摘要与综合画像
```

权威边界固定为：

1. **证据权威**：PostgreSQL 不可变掌握度事件，以及可回查的 Trajectory/L1 证据。
2. **当前状态权威**：PostgreSQL 当前掌握度投影。`TheoryMastered`、实践解锁和项目状态只能依赖它。
3. **时间线查询投影**：Graphiti 或 PostgreSQL 时间线读模型。Graphiti 是可选、异步、可重建的投影，不是项目门槛的依赖。
4. **长期偏好记忆**：Mem0 只索引经批准的非掌握类事实，不保存 `level`、`TheoryMastered` 或项目阶段。

## 2. 背景与评审结论

当前代码已经使用 PostgreSQL 保存 `mastery_records` 和 `mastery_attempts`，并由
`packages/ai-client/src/mastery/index.ts` 提供纯函数掌握度算法与
`computeTheoryMastered()`。仓库架构原则也明确 PostgreSQL 是 system of record，
跨模块写入必须通过 owner、事务、审计和 outbox。

Graphiti 的固定版本源码包含 `EntityEdge.valid_at`、`invalid_at`、`reference_time`
和 `created_at`，但这些字段不能直接承诺为启途的业务双时态事务模型。Graphiti 的
边保存/删除接口也不能证明“关闭旧边 + 写入新边”是跨操作原子的。因此掌握度事件
必须先在 PostgreSQL 中形成可重放事实，再异步投影到 Graphiti。

这次决策不否定时间线产品能力。即使最终不部署 Graphiti，M1-M3 也必须提供当前值、
曲线、时间切片、退步检测和跨项目知识点聚合。

## 3. 不变量

以下规则必须由服务端和数据库共同保证：

- 学生未确认意图不得创建正式项目。
- `TheoryMastered` 前不得进入实践。
- 客户端、模型、Mem0、Graphiti 都不能直接写项目阶段、掌握度或成长档案。
- 每次掌握度变更必须有唯一事件、算法版本和证据引用。
- 同一事件重试不能生成第二个掌握事件、审计记录或 outbox 消息。
- 乱序事件不能让旧评估覆盖新评估；补录事件必须显式携带有效时间和因果关系。
- 任何面向未成年人的读取都必须先做对象级授权，再做字段投影。
- Graphiti 不可用时，答题、判分、当前掌握和项目门槛仍可正常工作；时间线读取必须明确返回 stale/unavailable，而不能伪装成空数据。
- 任何 Graphiti 数据都可以从 PostgreSQL 事件账本全量重建。

## 4. 领域模型

### 4.1 Canonical KnowledgePoint

现有 `objectiveId` 是学习计划内目标，不能直接支持跨项目曲线。学习目标需要引用稳定
的 `knowledgePointId`：

```typescript
interface KnowledgePoint {
  id: string;
  canonicalKey: string;
  title: string;
  knowledgeType: 'memory' | 'concept' | 'procedure' | 'design';
  prerequisiteIds: string[];
  version: string;
  status: 'draft' | 'published' | 'archived';
}
```

`LearningObjective` 保留自己的 `objectiveId` 和教学上下文，但增加
`knowledgePointId`。跨计划聚合按 `(studentId, knowledgePointId)`，不能按计划内
`objectiveId` 猜测同一知识点。

### 4.2 MasteryAssessmentEvent

建议新增不可变 `mastery_events`：

```typescript
interface MasteryAssessmentEvent {
  id: string;
  schoolId: string | null;
  studentId: string;
  knowledgePointId: string;
  objectiveId: string | null;
  planId: string | null;
  projectId: string | null;

  eventType: 'assessed' | 'corrected' | 'revoked' | 'imported';
  level: number;
  confidence: number;
  qualitativeMastered: boolean;

  validFrom: string;
  recordedAt: string;
  aggregateSequence: number;

  evidenceRefs: string[];
  sourceType: 'quiz' | 'qualitative' | 'practice' | 'staff' | 'migration';
  sourceEventId: string;
  causationId: string | null;
  correlationId: string | null;
  supersedesEventId: string | null;
  assessmentVersion: string;
  idempotencyKey: string;
}
```

写入约束：

- `validFrom` 是掌握状态在业务上开始生效的时间；由服务端校验，不能直接信任客户端。
- `recordedAt` 是启途接受并落库的时间；由数据库/服务端产生。
- `validTo` 不写入事件，只在当前投影和时间线返回值中由下一条有效事件的 `validFrom` 推导。
- `level` 和 `qualitativeMastered` 是服务端判定结果，不是客户端输入。
- `evidenceRefs` 只保存不透明引用，正文留在 L1、Trajectory、attempt 或作品证据中。
- `aggregateSequence` 在 `(studentId, knowledgePointId)` 聚合内单调递增。
- 事件必须有 `assessmentVersion`，以后算法变更不能重写历史结果。

### 4.3 CurrentMasteryProjection

现有 `mastery_records` 降为当前投影，但保留对现有 API 的兼容字段，并增加：

```typescript
interface CurrentMasteryProjection {
  studentId: string;
  knowledgePointId: string;
  objectiveId: string | null;
  planId: string | null;
  level: number;
  confidence: number;
  qualitativeMastered: boolean;
  sourceEventId: string;
  aggregateSequence: number;
  algorithmVersion: string;
  validFrom: string;
  updatedAt: string;
}
```

`mastery_records` 可以继续作为物化表名，但它不再是唯一的历史事实来源。当前投影
必须能够从 `mastery_events` 删除后重建，并通过唯一键和版本条件防止旧事件覆盖新状态。

### 4.4 Historical snapshots

时间线 API 不应依赖每次请求重放所有答题。按日或按评估事件生成快照：

```typescript
interface MasterySnapshot {
  studentId: string;
  asOf: string;
  sourceSequence: number;
  points: Array<{
    knowledgePointId: string;
    level: number;
    confidence: number;
    status: 'new' | 'learning' | 'mastered';
    sourceEventId: string;
  }>;
  algorithmVersion: string;
}
```

快照是缓存/读模型，不能替代事件账本。快照落后时，服务端必须标识来源序列和新鲜度。

## 5. 时间语义

启途业务合同使用两种时间：

| 启途字段 | 语义 | Graphiti 映射建议 |
|---|---|---|
| `validFrom` | 学生掌握状态何时生效 | `valid_at`，同时保留结构化属性 |
| `validTo` | 状态何时被取代/撤销 | `invalid_at`，同时保留结构化属性 |
| `recordedAt` | 启途何时接收并提交事件 | `created_at` 仅作投影时间，不作为业务唯一真相 |
| 证据发生时间 | 评估所依据的作答/项目事件时间 | `reference_time` |
| 撤销/删除 | 外部索引何时失效 | 不使用 `expired_at` 表达掌握真相 |

Graphiti 的 `created_at`、`reference_time` 和启途业务时间必须同时保留，不能通过一个
时间字段复用两种语义。历史查询“当时系统已经知道什么”应以
`recordedAt <= asOf` 过滤；查询“当时学生处于什么掌握状态”应以
`validFrom/validTo` 过滤。

## 6. Graphiti 投影规则

Graphiti 只由 Worker 写入，API 和 AI 模型不得直接访问 Graphiti。

推荐结构：

```text
Student
  └── HAS_MASTERY_ASSESSMENT
        └── KnowledgePoint
```

每次评估作为不可变事实或 episode 投影，不只维护一条被反复覆盖的
`HAS_MASTERY` 边。Graphiti adapter 必须提供：

- `projectionKey = mastery-event:{eventId}`；
- 幂等写入和消费去重；
- 乱序事件检测；
- 版本/序列校验；
- 全量重建；
- 投影 receipt、失败原因和最后成功序列；
- 读取前回查 PostgreSQL 的学生权限、事件有效性和撤销状态。

Graphiti 的 group/namespace 不是授权系统。学校、学生、班主任和家长的权限必须由
启途 API 根据 `mentor_assignments`、`guardian_links` 和学校范围重新判定。

## 7. API 与模块边界

统一端口建议命名为 `MasteryTimelinePort`，不暴露 Graphiti 类型：

```typescript
interface MasteryTimelinePort {
  evaluate(input: EvaluateMasteryInput): Promise<MasteryAssessmentResult>;
  getCurrent(input: GetCurrentMasteryInput): Promise<CurrentMasteryProjection[]>;
  getTimeline(input: GetMasteryTimelineInput): Promise<MasteryTimelinePoint[]>;
  snapshot(input: GetMasterySnapshotInput): Promise<MasterySnapshot>;
  checkThreshold(input: CheckMasteryThresholdInput): Promise<ThresholdResult>;
  getRegressionAlerts(input: GetRegressionAlertsInput): Promise<MasteryRegression[]>;
}
```

当前仓库中的 owner 不改变：

| 模块 | 新职责 |
|---|---|
| `packages/contracts` | MasteryLevel、时间范围、事件和投影合同 |
| `packages/ai-client` | 纯函数评估、门槛、算法版本；零 I/O |
| `learning-plan` | 答题/证据转评估命令，写事件与当前投影 |
| `projects` | 通过 `checkThreshold()` 决定项目推进 |
| `growth` | 读取授权时间线和快照，生成学生/家长/教师投影 |
| `agent-memory` | 关系记忆和 Mem0 索引，不写掌握度 |
| `workers` | outbox、Graphiti 投影、对账和重建 |
| `knowledge` | KnowledgePoint 定义和前置关系 |
| `QituSDKFactory` / `createQituSDK` | 服务端 facade：绑定 student/project scope，组合 mastery、agent、project、profile ports | API 内部模块；不导出数据库或 Graphiti 类型 |
| `createQituReadSDK` / `createApiClient().mastery` | 浏览器只读 facade | 只能查询掌握度投影，不能评估、写事件或推进项目 |


## 8. 一次评估的事务协议

```text
答题 / 实践 / 阶段结束
  → 服务端判分与评估
  → 同一 PostgreSQL 事务：
       mastery_attempts
       mastery_events
       mastery_records/current projection
       audit_logs
       outbox(mastery.assessed)
  → 提交事务
  → Worker 幂等投影 Graphiti
  → 写 graph_projection_receipts
  → 对账与告警
```

当前 `completePendingQuestion()` 已能原子写入 pending question、attempt 和 mastery，
但 `TheoryMastered` 的审计/outbox 仍需收进同一事务。`submitEvidence()` 也必须与答题
路径共用同一个评估命令，不能由多个独立写操作拼成“看起来原子”的流程。

并发写入使用数据库锁或条件更新校验 `aggregateSequence`。禁止简单的
“先读 attempts、进程内重算、无条件 upsert”，因为这会在并发答题时丢失更新。

## 9. 分阶段实施计划

### M0：决策、合同和事务修复

**目标**：在引入新表前冻结边界并消除现有半状态风险。

交付：

- 本 ADR 进入 Accepted 状态；
- `MasteryAssessmentEvent`、`CurrentMasteryProjection`、`MasteryTimelinePort` 合同；
- `KnowledgePoint` 与学习目标的映射方案；
- 答题、实践证据、纠错和撤销的统一命令设计；
- `TheoryMastered` audit/outbox 同事务；
- 修复 `recomputeMastery` 的并发读改写；
- 核对 mastery upsert 的 FSRS 字段和连续计数语义；
- 冻结算法版本和事件版本。

出口条件：重复请求、并发答题、事务回滚、审计失败、outbox 失败都有测试。

### M1：PostgreSQL 事件账本和时间线

**目标**：不依赖 Graphiti 提供核心时间线能力。

交付：

- `mastery_events` 迁移；
- `knowledge_points` 或等价 canonical 知识点表；
- `mastery_records` 增加投影元数据；
- 日/事件快照表或可重建查询；
- `getCurrent`、`getTimeline`、`snapshot`、`getRegressionAlerts`；
- 学生/家长/班主任授权投影。

出口条件：90 天曲线、任意 `asOf` 快照、退步检测和跨项目同知识点聚合可重放且可解释。

### M2：统一评估流水线

**目标**：所有掌握变更都产生同一种事件。

交付：

- quiz、qualitative、practice、staff correction 统一进入 `evaluate()`；
- LLM 只提供候选评估，服务端 schema、范围和证据校验；
- 幂等键、因果 ID、关联 ID、聚合序列；
- 补录、纠错、撤销、重新评估；
- Trajectory/L1 证据回查。

出口条件：乱序、重复、补录和撤销测试通过，历史结果不因算法升级漂移。

### M3：成长轨迹主路径和项目门槛收敛

**目标**：掌握度时间线成为成长轨迹和项目推进的统一来源。

交付：

- 学生成长轨迹的曲线、时间切片和退步提示；
- 家长脱敏快照、教师授权详情；
- `project.canAdvance()` 只调用 `checkThreshold()`；
- Graphiti 尚不参与阻塞性判断。

出口条件：`TheoryMastered` 前实践不可达；权限失败返回 403；离线和时间线投影不可用不影响核心学习流程。

### M4：Graphiti PoC 和影子投影

**目标**：验证 Graphiti 是否值得承载复杂时间线查询。

交付：

- 固定 Graphiti 版本和图库选型；
- Graphiti adapter、Worker、receipt、重试和对账；
- 只导入合成数据和最小结构化事件；
- PostgreSQL 与 Graphiti 并行查询但只返回 PostgreSQL 结果；
- 完整重建和故障恢复脚本。

出口条件：重复/乱序事件最终收敛，时间切片与 PostgreSQL 参考实现一致，延迟/成本/恢复指标达到预先冻结的目标。

### M5：非阻塞读取灰度

**目标**：只在已验证场景启用 Graphiti。

首批允许：掌握曲线、跨项目聚合、退步分析、教师辅助建议。

暂不允许：`TheoryMastered`、实践解锁、项目状态转换、审计结论、权限判定。

Graphiti 完全失效时必须能关闭 feature flag，回退到 PostgreSQL 查询或明确返回
`timeline_unavailable`，不能把技术故障解释为学生未掌握。

## 10. 数据、权限和隐私

- Graphiti 不保存未成年人原始对话、语音或完整答案。
- Graphiti 只保存不透明对象 ID、最小数值事实和证据引用。
- 家长/教师读取先通过 API 做关系授权，再返回字段投影；Graphiti group_id 不能代替授权。
- 学生纠错先让 PostgreSQL 当前读取立即失效，再异步清理/标记外部投影。
- 删除、撤销和失效必须可对账；索引失败不能让旧事实重新进入 prompt。
- 所有 Graphiti 读取记录用途、对象、时间范围和审计引用。

## 11. 验收指标

正式实现前冻结基准，不把估算延迟当作实测：

- 当前掌握查询 P95；
- 时间线和快照查询 P95；
- Graphiti 投影延迟 P95；
- PostgreSQL/Graphiti 结果一致率；
- 重复消费去重率；
- 乱序事件最终收敛率；
- 从 PostgreSQL 完整重建成功率；
- Graphiti 故障时答题和门槛成功率；
- 越权请求 403 率；
- 撤销后旧事实不可召回率；
- 未成年人原始内容出域检查通过率。

## 12. 开放决策

以下问题在 M0 评审中冻结：

1. `KnowledgePoint` 是独立表，还是由知识库 verified 文档中的结构化节点提供。
2. `level` 使用 0..1 连续值还是离散等级；不同 `knowledgeType` 是否允许不同标尺。
3. 掌握度时间线的学生、家长、教师字段投影矩阵。
4. 快照生成频率、保留周期和删除策略。
5. Graphiti 选 Neo4j 还是 FalkorDB，以及是否允许外部 LLM/embedding。
6. Graphiti PoC 的数据规模、P95、同步延迟和成本门槛。
7. 是否需要“当时系统已知什么”的审计查询；该查询必须使用 `recordedAt`，不能只看 `validFrom`。

### 只读查询复验状态

当前 `services/api/src/modules/mastery/` 通过事件账本实现 current、timeline、snapshot、
threshold 和 regressions；无需 KnowledgePoint 参数即可枚举学生事件。
`LearningPlanModule` 导出同一 store，MasteryModule 不新建存储实例。
课程版本独立计算区间；历史查询使用 `validAt` 与 `knownAt`；撤销和未知不填零，
也不作为实测退步。timeline 游标已接通，controller 拒绝未知字段和重复参数。

标准 API 测试已纳入该模块，当前 250/250 通过（包含 14 项 mastery 只读回归用例）。
这些证据仅覆盖当前读路径和已有事务测试，不代表 Graphiti、完整纠错/撤销写命令、
项目状态机接线、前端曲线或生产规模性能已经完成。

## 13. 文档治理

- 本 ADR 是掌握度时间线和 Graphiti 定位的唯一决策源。
- 当前已落地 Graphiti projection scaffold：`services/graphiti/bridge.py`（固定结构化 HTTP bridge，禁用 telemetry/LLM 抽取）、`services/workers/src/mastery-projection-worker.ts`、`mastery_graph_receipts` 和 0012 migration。
- 真实 Graphiti/Neo4j round-trip、备份恢复和生产规模性能仍需 M4 外部环境验收。
- `docs/shared/ARCHITECTURE.md` 描述稳定模块边界；`docs/shared/DATABASE.md` 描述表 owner 和迁移顺序；本文描述掌握度具体协议。
- `docs/sdk/AGENT_MEMORY.md` 保留 Agent/Mem0 设计，但 Graphiti 相关表述以本文为准。
- 历史 FastAPI/LangGraph 提案已移除，不作为当前实现依据。
