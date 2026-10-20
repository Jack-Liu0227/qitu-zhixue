# 团队、工作流和团队版本

团队是可变配置；team.version 产生不可变教学快照。先读取 teams、assistants、teamVersions 和 currentVersion，修改保留所有未涉及成员及其稳定 slotId。

| action | input |
| --- | --- |
| team.create | `{name,description,leaderAssistantId,members,workspaceMode?,sessionMode?,concurrencyLimit?,pblSpec?,enabled?}` |
| team.update | `{id,expectedUpdatedAt,patch}`，patch 使用创建字段的子集 |
| workflow.update | `{id:<team ID>,expectedUpdatedAt,pblSpec:<完整 PBL 规格>}` |
| team.version | `{id:<真实已持久化团队 ID>,expectedUpdatedAt}` |

members 为 `{assistantId,role,slotId?,roleLabel?,pblPhase?}`。role 为 leader/teammate/reviewer/coach；leaderAssistantId 必须命中成员。workspaceMode 为 shared/isolated，sessionMode 为 auto/plan/supervised，concurrencyLimit 为 1–8。成员模型通过 assistant.update 的 provider/model 对配置，成员展示字段不能替代真实模型路由。

工作流存储在 team.pblSpec，不创建独立 workflow 状态库。以下是完整阶段结构示例，分配给目录中真实的团队成员：

```json
{
  "projectId":"<模板 pbl 的真实项目 ID>","projectName":"光学探究","targetDomain":"physics",
  "theoryMasteredGate":true,"allowAutonomousAdvance":false,
  "phases":[
    {"phase":"exploration","title":"问题探索","assignedAssistantId":"<成员 ID>"},
    {"phase":"concept_mastery","title":"理论学习","assignedAssistantId":"<成员 ID>"},
    {"phase":"guided_practice","title":"模拟实践","assignedAssistantId":"<成员 ID>","deliverableType":"实验报告","evidenceProfile":"experiment_report"},
    {"phase":"deliverable_review","title":"作品评审","assignedAssistantId":"<评审成员 ID>"}
  ]
}
```

通常不提交 gateCondition，由 owner 根据阶段及 evidenceProfile 推导；提交时必须与既有注册门禁一致。不能关闭 theoryMasteredGate、允许自主推进或把课时检查点当作完成事实。修改 pblSpec 要保留用户未要求修改且属于可写合同的阶段和目标；只读扩展字段不能送回写入。先核对 supplied operation guide 与 owner 校验字段。

创建团队后可用 `$ref:"team.id"` 配置 workflow，并用前序返回的 updatedAt 作为下一步 revision。发布之前所有成员必须启用、模型可用、教学技能已发布，工作流完整且保留硬门禁。team.version 只接收 ID/revision，禁止客户端构造 runtimeSnapshot。

回读 team.version 的 id、teamId、runtimeSnapshotStatus=published、snapshotDigest 和 members。这个 id 才是 binding.create.teamVersionId。成员快照的 slotId 用作教学包 memberId；它不同于 assistantId。后续修改团队不会改写这个版本，需再次发布新版本并通过模板绑定治理。

| owner HTTP API | body / 回读 |
| --- | --- |
| GET /api/v1/admin/ai-runtime/teams | 读取团队及成员当前状态 |
| POST /api/v1/admin/ai-runtime/teams | 创建字段，带 Idempotency-Key |
| PATCH /api/v1/admin/ai-runtime/teams/:id | body 为 patch 本身，工作流用 `{pblSpec:...}`，带 Idempotency-Key |
| GET /api/v1/admin/teams/:id/versions | 读取真实团队版本列表 |
| POST /api/v1/admin/teams/:id/versions | `{expectedUpdatedAt}`，带 Idempotency-Key |

团队配置保存、团队版本发布、模板绑定激活和实际 Team Run 是独立状态。管家当前目录没有“执行团队任务”action，不把保存或发布回执写成团队已运行。
