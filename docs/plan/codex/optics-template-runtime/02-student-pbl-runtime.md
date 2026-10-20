# 02 · Student PBL Runtime

## 端到端流程

```text
/student/inspiration 或 /student/tutor (exploration)
  -> 启途智学助手（qitu-intake-assistant）
  -> 服务端检索已发布模板并返回 idea_cards
  -> 学生选择/微调目标与兴趣
  -> confirmExploration（事务内冻结 templateVersionId + bindingId + teamVersionId + digest）
  -> /student/tutor/:projectId
  -> 当前 frozen session/task + 对应 phase assistant 接管
```

## 复用的现有接口

- `GET /api/v1/tutor/session`、`POST /api/v1/tutor/sessions/:id/stream`：对话和 SSE。
- `GET /api/v1/tutor/project-context`：项目、阶段、当前课时、团队身份和 phase 投影。
- `GET /api/v1/tutor/team-graph`：脱敏 Agent 状态、历史消息和工具调用。
- `POST /api/v1/tutor/sessions/:id/interactive/:quizId/answer`：服务端判分和 mastery owner 接线。
- `GET/POST /api/v1/learning-plans/**`：课时、题目和 evidence owner。

## 前端任务

1. `TutorPage` 只使用 `project-context` 的 `stages/phases/lesson`，删除任何按标题、team 名或 ID 前缀推断阶段的逻辑。
2. 右侧预览拆成“项目阶段”和“团队运行”两个只读 Tab；团队 Tab 统一复用 `TutorTeamGraph`，不得在 `TeamAgentHud` 内置 Agent 列表。
3. `idea_cards` 的确认按钮只调用 confirm API；请求失败时不跳转、不乐观显示正式项目。
4. 题库仅在 `concept_mastery` 的服务端投影出现；解析由 quiz owner 返回，客户端不计算对错、掌握度或放行实践。
5. loading、empty、error、offline、permission-denied、model-unavailable 都必须有独立状态。

## 知识库巩固题

理论单元完成后，由服务端按 frozen `knowledgeGrant` 与当前 session/objective 检索授权材料，再让对应教学助手提出结构化题目候选。候选要带稳定的服务端 `questionId`、`objectiveId`、答案/rubric、解析和 opaque KB provenance；不能把浏览器传入的 KB ID 当授权，也不能将未核验检索摘要当成教材事实。

闭合选项题沿用 `TutorQuizService`/`LearningPlanService` 的服务端作答与掌握度 owner；开放作答的 AI 判读必须是带 rubric 和 evidence refs 的候选，经过同一个 assessment owner 校验后才能记录。学生提交前不下发答案/完整解析；提交后在对话中显示判定与可追溯解析。题目生成、答案揭示和作答都需要稳定实例 ID、project/session/revision scope 与幂等键。

## 右侧一致性

后端一次返回 `projectStage`（项目状态机当前阶段）、`curriculumPhase`（模板 4 阶段映射）与 `lesson`（冻结的 16-session profile 当前课时）。三者是不同粒度，不能把十个全局项目状态当成课时，也不能让 UI 自己再推一次。团队历史/工具调用提供项目或 session 范围、cursor 分页和脱敏状态；不能只依赖 SSE 最近 50 条事件作为完整历史。

## 服务端约束

- `TheoryMastered` 以前只能返回低风险模拟提示；真实/模拟实践 action 必须再次检查项目权限、frozen bundle、实验版本、objective、课时和参数范围。
- session index 只从 frozen curriculum profile 解析，不能使用全局 1–16、标题、团队名称或 fallback assistant。
- SSE 中的 team/tool frame 只包含 frameId、runId、phase、taskType、状态和脱敏摘要，不发送 prompt、原始对话或内部思维。
