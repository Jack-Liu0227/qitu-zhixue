# 冻结课时教学运行

此模块把已确认项目的 TeachingBundle 与 learning-plan owner 的计划、课时、目标、未答题合并为只读上下文。`getProjectContext` 与普通 Tutor 回合使用同一解析结果；模板 `sessionRoutes` 决定导师，不从项目标题、阶段序号或当前助手提示推断。

## 边界与权限

- 项目对象权限先检查 studentId。binding owner 负责验证冻结快照、模板要求和摘要；无有效绑定拒绝，不读取当前 active 绑定补语义。非 TeachingBundle 历史模板仍须有 owner 接受的治理快照。
- 未答题优先定位真实 session/objective。否则以现有 mastery owner 的证据选择未完成目标；读取不写学习状态。目标已掌握不等于课时或检查点完成，只有 plan owner 的 completed 才显示计划完成。
- 保留冻结助手指令、模型 `(providerId, modelId)`、Skill version/digest 与工具上限。当前停用、模型不可用、删除能力立即收紧；更改提示或新增能力不扩大旧项目。
- 旧 Skill 包必须与冻结 version/digest 精确匹配。当前未具备多版本包存储时，旧包缺失返回错误，不静默使用新包。
- SDK 的 `resolveRuntime` 是服务端闭包，无客户端字段；在执行前重新投影当前限制并保留 identity/hash/model 校验。
- 冻结项目 IMA 通过服务端 scope 执行：冻结 KB grant 与当前 Admin 授权交集、实际工具 schema/handler pin、调用前后项目对象权限检查。列库过滤、检索/列文档 KB 参数及读文档 provenance 均检查。参考元数据限定本轮、最多 256 个、5 分钟有效，不存全文；跨轮/过期重新检索。
- managed knowledge 目前没有冻结本地 KB 与远端 KB 的授权映射，冻结项目不调用该无范围适配器。无可用项目 IMA grant 时明确展示“资料尚未核验”，仍可进行一般教学。

## 错误与记录

`PROJECT_TEACHING_PLAN_UNAVAILABLE/MISMATCH` 表示未接入唯一有效计划或计划版本不匹配；`PROJECT_TEACHING_SESSION_INVALID/OBJECTIVE_INVALID/ROUTE_INVALID/PENDING_SCOPE_INVALID` 表示持久课时、目标、路由或未答题范围不一致。模型、Skill 不可用分别返回 `PROJECT_TEACHING_MODEL_UNAVAILABLE`、`PROJECT_TEACHING_SKILL_UNAVAILABLE`；停用继续使用 `AGENT_ROLE_DISABLED`。均在调用模型前拒绝，不新增第二套状态库。

团队回合事件补充 planId、planRevision、learningSessionId、roleSlotId 与 objectiveId，仅记录身份元数据，不写原始学生对话。既有回合幂等重放继续复用已存事件。

## 验证与剩余接线

`tutor-teaching-context.test.ts` 覆盖未答题定位、真实课时索引、任务与 revision、无完成事实推导、越界/小数/跨作用域拒绝；`tutor.runtime-identity.test.ts` 覆盖完整 Tutor → SDK → gateway 的冻结模型/提示、当前撤权、Skill pin、实际课时与右侧同源，以及未授权工具不下发。

`ima-project-scope.test.ts`、`ima-mcp.client.test.ts` 使用本地合成 HTTP 响应验证正常检索、四工具范围、schema 漂移、当前撤权、跨项目引用及过期；`tutor-knowledge-access.test.ts` 验证项目对象和冻结摘要回读。错误 `IMA_PROJECT_SCOPE_DENIED/ACCESS_REVOKED/REFERENCE_REQUIRED/TOOL_VERSION_CHANGED/INVALID_RESULT` 均阻止引用资料，现有工具事件展示资料暂不可用，不暴露上游原文错误。

下一步需要在 `KnowledgeRetrievalService.search/read/tools` 增加冻结本地 KB 授权映射。动态出题沿 `pending_questions` owner 创建正式题实例；动态课件沿 `TutorExperimentService` 与证据 owner 提交 action/observation。当前解析暴露实际 plan/session/revision/objective，供这两条生成链使用；它自身不生成题目、不新建任务完成记录，也不替代门禁验收。


## Dynamic lesson candidates

`tutor-activity-context.ts` prepares a server-only `tutor.propose_lesson_activity` tool under the actual frozen plan/session/objective. The tool is exposed only when both the canonical `pbl-dynamic-lesson` reviewed/published skill and pinned tool survive current restrictions. The source skill is initially quarantined; source presence is not Admin activation. Publish/review and a new governed binding are required before live use.

The gateway lets the Agent choose one closed candidate: a server-built Mermaid/TeX board, an approved optics model with bounded initial parameters, or a formative question accepted by `LearningPlanService`. It does not accept arbitrary HTML, JavaScript or SVG. Frozen projects no longer use keyword-triggered experiment cards or unconditional static quiz injection. Existing unbundled paths retain their compatibility behavior.

The source verifier accepts only bounded metadata from successful scoped IMA document reads in this turn; it rechecks the frozen/current grant intersection and read permission. Unknown/expired references fail closed. Source text stays out of audit/projection metadata. Managed local KB still needs a frozen grant-to-local-index mapping before it can support this path.

Question keys and explanations stay inside the question owner, and accepted question turns suppress model free text. The owner read method restores a pending public question after a partial failure, preserving its IDs and scope; help cannot overwrite it. Generated questions are formative and do not write mastery or TheoryMastered. Optics proposals use the experiment owner, actual lesson model, revision and current mastery check; parameter changes and runs are not completion evidence.

Validation: `tutor-lesson-activity.test.ts`, `tutor-activity-optics.test.ts` and `ima-project-scope.test.ts` cover revocation, stale scope, source expiry, agent selection, duplicate concurrent tool calls, pending restoration, injection rejection, parameter bounds and answer suppression. Integration builds/tests are run centrally in the isolated integration checkout; no live model or student data are used.
