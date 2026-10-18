# 启途智学工程协作规则

## 项目基线

- 产品名称：启途智学
- 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**，以真实任务挑战、探究证据链与人机协同育人为核心。
- 主要开发文档：`docs/README.md`；按责任域阅读 `docs/admin/platform-governance.md`、`docs/student/today.md`、`docs/teacher/dashboard.md`、`docs/parent/home.md`、`docs/sdk/overview.md`。
- 代码结构采用 Monorepo（`apps/`、`packages/`、`services/`）。
- 学生端核心交互：对话入口集中于学生端的 **AI搭档（`/student/tutor`）**，并保留 **灵感空间（`/student/inspiration`）** 的探索与项目详情跳转入口。
- 四个平台共享认证、API 合同、权限和数据模型。
- 首期采用模块化单体后端与异步任务，不提前拆分大量微服务。

## 必须遵守

- 不改变已经冻结的产品导航和 UI 信息架构，除非先更新产品文档并通过评审。
- 后台控制权全在 Admin：所有模型底座与提供商（Model Providers / Model Gateway）、运行时技能、项目与课程模板、知识库范围和全局教学策略均由 Admin 后台统一控制，客户端不得自行路由或越权覆盖。
- 前端权限只负责显示；所有对象级权限必须在后端再次校验。
- 项目状态转换、AI 决策、成长档案和审计日志不能由客户端直接写入。
- 一个学生同一时间只能有一个当前班主任。
- 学生未确认意图时不得创建正式项目。
- `TheoryMastered` 之前不得进入实践阶段。
- 涉及未成年人数据时，默认最小化可见范围并保留审计记录。
- 所有写操作考虑幂等性，尤其是项目、任务、作品、导师分配和干预操作。

## 安全

禁止提交：

- `.env`、API Key、Token、密码
- OAuth 或模型认证文件
- SSH 私钥、证书私钥
- 未脱敏的未成年人原始对话或语音

## 开发要求

- 单个代码文件行数不超过 2500 行；长文件必须全部拆分为多个模块进行组合与拼接。
- 页面必须覆盖 loading、empty、error、断网和权限失败状态。
- 后端模块需要同步补充权限、错误码、日志和测试说明。
- Pull Request 必须说明影响范围、验证方式和数据/权限风险。
- 不在没有 Issue 的情况下进行大范围重构。

## 当前架构补充

- 项目式学习继续采用模块化单体：`projects`、`learning-plan`、`mastery`、`ai-tutor`、`team-runtime`、`works/feedback` 共同维护项目、计划、掌握度、团队候选和作品证据；不要另建第二套 PBL 状态机或 mastery 数据库。
- 模板版本、团队版本和绑定是历史项目的语义边界。正式项目确认时冻结 `templateVersionId`、`bindingId`、`teamVersionId` 和 hash；运行时不得按团队名称、标题或客户端传入的 `teamId` 猜测绑定。
- Tutor 输出使用闭合集合 `TutorReplyBlock` 和 SSE。模型只能产生候选教学动作/文案；项目阶段、`TheoryMastered`、作品通过、成长记录、审计和计划 revision 必须由对应服务端 owner 写入。
- 动态交互采用“回答/操作产生证据，策略选择下一教学动作”的双循环。允许追问、提示、例子、检查题、同目标补救和教师介入；禁止客户端或 Agent 直接 `advance_stage`、`mark_mastered`、`approve_artifact` 或放行实践。

## 光学 PBL 规则

- `optics-physical-inquiry` 当前源码覆盖 12 个排程目标、4 个阶段与 4 个质化波动模块（含散射和衍射仿真）；散射和衍射是实践/非门禁波动模块，不得被误写成新的 `TheoryMastered` 目标。
- `TheoryMastered` 之前只能展示低风险模拟提示；真实/模拟实践工具必须由服务端再次校验门禁、项目对象权限、实验版本和参数范围。
- `optics_experiment` 目前是结构化可视化原型。正式接入前必须补 `specVersion`、`objectiveId`、稳定 `actionId`、幂等事件、观测证据和 CER/rubric 引用；摘要文本不能直接成为掌握度或作品通过事实。
- 光学实验只允许注册的单缝衍射和封闭细雾室散射模型；禁止模型生成任意 HTML/JS、开放浏览器工具或不安全激光操作指令。

## 动态展示与交互体验

- 学习全过程坚持“PBL 驱动的 AI 育人共成长”，强化多维动态展示与沉浸式交互体验：前端标配 Mermaid 流程拓扑图、KaTeX 数学/物理公式、BoardBlock 看板卡片、微观实验仿真（如单缝衍射与细雾室散射）及自动首轮启发式开场引导（auto-launch opening turn）。
- 拒绝纯静态长文本灌输：交互严格遵循“回答/探究产生证据 -> 服务端策略选择下一教学动作”的双循环，通过追问、动态提示、例子与实时板书促进学生思维进阶。
- 对话核心入口为学生端“AI搭档”（`/student/tutor`），并与“灵感空间”（`/student/inspiration`）保持跳转连通，实现从灵感捕捉到项目式深度探究的无缝流转。

## Admin 全局控制与 Runtime 约束

- 后台控制全在 Admin（`apps/admin-console`）：统一收口模型底座与提供商网关（Model Providers / Model Gateway，默认启途运行时引擎）、运行时技能矩阵（Runtime Skills）、项目模板生命周期、知识库/IMA 范围及全平台策略配置；客户端严禁私自硬编码或变更路由。
- Admin 技能矩阵只提交运行时目录返回的 canonical skill ID；不得把展示名称与 ID 混写进 `enabledSkills`。本地草稿只能在当前会话编辑，不能绑定运行时助手或伪装成已发布技能。
- 批量绑定使用幂等 PATCH，服务端回读结果后再显示成功；部分失败、权限失败、目录读取失败和回读失败必须明确提示，不能乐观地显示“已生效”。
- 运行时快照、线上探测结果和本地源码不是同一事实层；诊断报告必须区分“源码存在”“配置存在”“已发布/已启用”“真实请求成功”。

## 并发与验证

- 家长端切换学生时采用“最新请求优先”：旧的 home/progress/messages 响应不能覆盖当前学生；涉及异步加载的页面应保留同样的 request identity/abort 约束。
- 开始修改前先检查 `git status` 和目标文件 diff；发现不属于当前任务的用户修改时不得回滚或覆盖，需在结果中列出并单独验证。
- 跨 workspace 类型检查先按依赖顺序构建 `@qitu/contracts`、`@qitu/database`、`@qitu/ai-client` 等包，再运行 API/应用测试；不能把依赖快照不一致导致的全量 typecheck 错误当作业务修复完成。
- 研究、架构和实施文档入口为 `docs/plan/codex/README.md`；光学领域细节见 `docs/plan/codex/optics-scattering-diffraction-analysis.md`。文档中的效果数字必须有可复核来源，Grok MCP 返回 `sources_count: 0` 时只能记录为检索线索。

## Audit Addendum (2026-10-19)

- Runtime optics selection must use the frozen template/binding snapshot (`templateVersionId`, `bindingId`, `teamVersionId`, and hash); never infer it from a project title, team name, display label, or client-supplied identifier.
- Formal project confirmation must fail closed when the active binding snapshot cannot be frozen in the same transaction; a warning-only `omitted` binding is not an accepted success path.
- Theme/session/team/IMA data must remain one versioned contract. Prefer the existing `ProjectTemplateSpec` + schedule owners or explicitly migrate/re-export a new contract; do not create a second curriculum schema in parallel.
- The draft `packages/contracts/src/curriculum.ts` is only canonical after it is tracked, tested, and wired to template/bootstrap/API owners. A new 16-session optics shape must use a new template version; never mutate `optics-physical-inquiry:v1` in place or let two schedule schemas drift.
- IMA MCP access is read-only and binding-scoped: the frozen project snapshot must authorize both tool IDs and knowledge-base IDs. Never trust model/client tool arguments to select a knowledge base; validate or inject the scope server-side and persist bounded citation metadata.
- An `optics_experiment` block is not production evidence until its contract includes `specVersion`, `objectiveId`, stable `actionId`, idempotency, server range validation, persisted observations, and CER/rubric references. A client summary sent as ordinary tutor text is not evidence.
- Admin `enabledSkills` writes must contain only canonical IDs returned by the runtime catalog. Normalize legacy display names before a PATCH; block saves when the catalog is unavailable instead of sending an unvalidated full array.
- `docs/plan/codex` is the canonical current proposal. `docs/plan/antigravity` and `docs/plan/combined` are historical/comparison material and must not introduce parallel PBL state, binding, or plan stores.
- Any learning-effect number in research documentation requires a reproducible source. Grok MCP responses with `sources_count: 0` are leads only and must not be cited as empirical evidence.
- On the UNC workspace, `node_modules` may be an install snapshot rather than a workspace link. Record that limitation and build source packages in dependency order before attributing type errors to business code.
- Ad-hoc SQL or Node scripts that seed `TheoryMastered`, mastery events, provider/model bindings, or encrypted provider-key probes are development fixtures only. Keep them out of production migrations, scope them to an isolated database, make writes idempotent and auditable, and never commit secrets or raw learner data.
- Student project adapters may only call server-owned plan, answer, evidence, and artifact contracts; a cached task/session id or client summary is not proof of completion, mastery, or experiment evidence. Unsupported reflection or dynamic-action paths must remain visibly unsupported until a versioned API exists.
- Model pickers must preserve the `(modelProviderId, modelId)` pair. Never send a bare model id when multiple enabled providers can expose the same id; provider/model selectors must fail closed when the configured catalog is unavailable.
- Grok Search MCP is an evidence-discovery aid, not a citation source by itself. Record the session id and `sources_count`; when sources are empty, use the result only to guide repository/official-link verification and do not claim learning-effect numbers or legal conclusions.
