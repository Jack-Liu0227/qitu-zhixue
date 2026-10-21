# 真实 Tutor 回合的画像与成长观察闭环

本文补充 `growth-projection-settings.md` 的首批设置与路由实现，取代其中“尚无真实内容装配与自动接受”的旧范围说明。历史回填、作品/反思/掌握度事件生产者尚未完整接通。非 Tutor 事件仍只有有界引用元数据，不能据此宣称完成内容分析。

## 事务事件与私有证据

`PostgresTutorSessionStore.appendTurns` 接收服务端 `projectionEvent` 描述，在保存学生/助手回合的同一事务写入 `tutor.turn.completed` 和 `agent.team.event` outbox。事务从会话推导学生与项目，校验实际团队 run 归属与 leader；事件只保存稳定回合 ID、序号和 `learning_interaction` 引用，不复制原文。`TutorService` 必须传入实际运行时 leader；原来的诊断事件改为 `tutor.turn.trace`，不得重复触发画像。

该事件分发给当前配置的两个用途助手。执行时私有读取实际会话与回合，最多装配 4,000 字的学生文本和有界项目元数据，明确不把助手回答当作学生证据。原文只进入这一授权调用的内存输入；任务、候选、审计、学生和家长投影均不新增原文副本。manifest 保存来源 ID、原文哈希、最近分析的回合时间与上一版 candidate/version。

## 固定自动审核策略

模型结果先保存为 `proposed`，同时产生 `growth.projection.ready`。API 内部消费器默认随持久化服务启动，可通过 `QITU_GROWTH_PROJECTION_WORKER=false` 关闭。消费器带租约、重试和幂等 owner 回执，没有模型可调用的接受工具，也没有新增公开自动接受 HTTP 接口。

Worker 落库前先执行同一固定策略作为输出最小化检查。若模型回显整段私有输入、添加未知字段或生成超出策略的内容，只保存 `result:null`、`analysisErrorCode` 与 manifest；违规模型文本不会写入候选或任务结果。此检查不接受事实，符合约束的输出仍须 owner 在事务内重新读取来源、授权与上一版本。已延后候选的同一自动审核回执可安全重放，不重复写审计；需要重新分析时应产生新任务/候选。

固定自动审核策略为 `tutor-expression.v1`：只接受可在本轮原文逐字定位的短主题、学生明确表达的兴趣/偏好，以及固定句式的继续探究问题/学习表达摘要。历史知识、目标、时间预算、优势、成就与里程碑保持不变。仅凭对话不得授予掌握度、通过、完成、能力或诊断。成长观察固定为低置信度。任何其他输出、原文变化、上一版本变化、授权撤销或证据不足均保留 `proposed` 和错误码；不会直接展示候选。手工 Admin 接受 `learning_interaction` 候选也不能绕过这些检查。

普通 `question_asked` 活动仍保存幂等活动收据，但“学生完成一次对话”不再写入个人画像 `nextQuestions`。

历史成长若已有里程碑、优势或非对话来源证据，本批 Tutor 自动更新保留待审核（`PROJECTION_HISTORY_REVIEW_REQUIRED`），继续展示旧版已接受结果。多来源证据合并尚未实现，不能把旧成就的引用替换成一个新对话引用，造成证据归属误解。首次及纯对话观察的后续版本仍可按固定策略接受。

## 共享读取与边界

学生 `GET /students/me/profile` 与 `GET /students/me/growth/analysis` 从同一已接受候选读取。后者返回 `StudentGrowthAnalysisView {trajectory,analysis}`。`analysis` 包含 `status/policyVersion/observedThrough/sourceEventId/pendingReason`；`observedThrough` 只说明最近分析的真实回合时间，不承诺此前全部对话连续覆盖。更新尚待审核时继续展示上一版已接受内容，并标记 pending。旧版本冲突目前保留待审核，不自动基于过时输入重写历史。

新增主要错误码：`PROJECTION_EVENT_ROUTE_UNAVAILABLE`、`PROJECTION_MANIFEST_STALE`、`PROJECTION_COVERAGE_STALE`、`PROJECTION_EVIDENCE_CONTENT_UNAVAILABLE`、`PROJECTION_AUTHORITY_CLAIM_FORBIDDEN`、`PROJECTION_POLICY_REVIEW_REQUIRED`、`PROJECTION_NO_NEW_OBSERVATION`。

## 验证

新增合成隔离 fixture 测试：事务回滚、重复提交、外来 run 拒绝；实际学生回合读取、source hash/base version 复验、配置/route 撤销、错误任务拒绝；受限 owner 接受后的学生投影与无原文复制；违规输出保持 proposed；队列消费与重放；通用活动不污染个人问题。fixture 对实际 Drizzle 查询条件进行过滤，不连接生产数据库。依赖构建与测试在统一 integration 工作树运行；本文件不宣称真实模型、线上数据库或全量历史验收通过。
