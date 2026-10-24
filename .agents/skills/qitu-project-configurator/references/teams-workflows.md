# 团队与教学安排

团队是当前可编辑配置。读取 teams、assistants 和 currentVersion，修改保留所有未涉及成员及其稳定 slotId。教学安排使用 binding.prepare，服务端自动保存团队配置。没有独立的教学绑定冻结配置目录或发布步骤。

| action | input |
| --- | --- |
| team.create | `{name,description,leaderAssistantId,members,workspaceMode?,sessionMode?,concurrencyLimit?,pblSpec?,enabled?}` |
| team.update | `{id,expectedUpdatedAt,patch}`，patch 使用创建字段的子集 |
| workflow.update | `{id:<team ID>,expectedUpdatedAt,pblSpec:<完整 PBL 规格>}` |

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

跨领域作品可显式使用 `evidenceProfile:"rubric_artifact"`，由既有 owner 推导 `rubric_artifact_validated`。只有 Works 对确切作品版本的服务端评价与发布回执可写该门禁，不能把写作、设计或历史作品套作代码运行/实验报告；理论门禁保留。课程可以设置独立 `artifactCriteria`，课堂回应与最终作品按各自冻结标准评价。使用前须确认当前服务端合同已经包含这些字段。

创建团队后可用 `$ref:"team.id"` 更新工作流，并用回读的 updatedAt 作为下一步 revision。模板的课时安排通过 binding.prepare 提交实际 teamId、assistantId、完整 sessions 与 teams 修订。服务端检查成员启用状态、模型和已发布教学技能，自动捕获配置并存入该教学绑定。客户端不得提供快照或 hash，也不需要手工发布团队。

| owner HTTP API | body / 回读 |
| --- | --- |
| GET /api/v1/admin/ai-runtime/teams | 读取团队及成员当前状态 |
| POST /api/v1/admin/ai-runtime/teams | 创建字段，带 Idempotency-Key |
| PATCH /api/v1/admin/ai-runtime/teams/:id | body 为 patch 本身，工作流用 `{pblSpec:...}`，带 Idempotency-Key |

团队配置保存、教学安排保存、模板绑定激活和实际 Team Run 是独立状态。管家当前目录没有“执行团队任务”action，不把保存或发布回执写成团队已运行。

## 测试与删除

`team.test {id}` 检查真实成员运行时、负责人、PBL 工作流和阶段分配。它是配置测试，不创建学生项目或 Team Run。真实协作测试仍须使用已有项目冻结范围及原 team-runtime owner。

`team.delete {id,expectedUpdatedAt}` 仅 global 可用。已有教学绑定或模板 linkedTeamId 引用时返回 TEAM_IN_USE，使用 team.update enabled:false 保留历史语义。删除无引用团队后回读目录确认消失；不会级联删除成员助手。

直接 HTTP 为 `DELETE /api/v1/admin/ai-runtime/teams/:id`，带 Admin 会话和 Idempotency-Key；管家增加 revision 检查。

## 真实团队委派

team.run {runId,senderAgentId,recipientAgentId,taskType,input?,parentTaskId?} 仅 global，使用现有已授权 run，不创建学生、项目或门禁证据。服务端从 run owner 读取真实 project/template 关系，并核对冻结教学包成员与 leader；缺冻结包拒绝。再读取当前 phase，检查对象、路由、角色与门禁后提交任务。team.run.status {runId} 回读 run 与任务状态，不返回学生原始对话。queued 只表示已入队，succeeded 才是任务完成，不能据此批准作品或阶段。team.test 仍是配置检查。删除 team.delete 等待管理员二次确认。
