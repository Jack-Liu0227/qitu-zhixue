# 启途智学全平台诊断与 PBL 验证记录

> 日期：2026-10-18  
> 环境：`http://122.51.130.204/`（线上演示环境）+ 当前 Monorepo 源码  
> 范围：统一登录及学生、家长、教师、Admin 角色冒烟；学生 AI 搭档光散射/衍射探索；PBL 后端结构；管理端配置与数据库接线。  
> 隐私：未将学生原始对话、语音或认证凭据写入本报告。

## 结论

四类角色的登录与主要入口可用，但线上演示服务无法完成用户要求的光学 PBL 全流程：探索请求被接受，模型调用在上游超时，AI 搭档返回 `MODEL_UNAVAILABLE`，因此不能通过意图确认进入正式项目，也无法在线验证理论掌握、实践、作品复核和反思归档。不得以静态 fixture 或未连接数据库的 SDK 团队配置替代这项线上验证。

代码中已有项目意图确认、模板版本、学习计划、概念测验、`TheoryMastered` 服务端门控、团队运行时、工具/技能/MCP 注册及审计等组成模块；但原有光学课程验证主要覆盖反射/折射/全反射/透镜四项射线光学门控目标，散射缺少课程内容，衍射仅以非评分目录项出现，未覆盖本次要求的散射和衍射证据链。

## 按平台观察

| 平台 | 已观察 | 诊断 |
| --- | --- | --- |
| 学生端 | 登录成功；`today`、`tutor`、`projects`、`inspiration`、`growth`、`works`、`profile` 路由可返回应用页面；提交光学散射/衍射探索请求后，探索写入成功，模型流因上游超时失败 | 意图未确认时没有创建正式项目，符合安全约束；但线上 PBL 后续无法验证。需要修复模型供应商可用性后重跑。 |
| 家长端 | 登录成功；首页、进度、消息页可渲染，儿童摘要和进度/消息 API 正常返回 | 本次未对所有导出/反馈操作逐项做写入测试；对象级关系权限仍须以后端授权结果为准。 |
| 教师端 | 登录成功；教师工作台及其学生/干预/统计入口可打开；直接访问旧知识路由 `/teacher/knowledge` 返回 404 | 教师主导航不包含该页面；增加兼容页将旧路径导回工作台，避免书签 404。 |
| Admin | 登录成功；总览与设置入口展示技能、工具/MCP、团队、模板、知识库和数据库配置区域 | Admin 教师列表 API `GET /api/v1/admin/teachers` 在线返回 404；源代码方法缺少 `@Get('teachers')`，已补路由装饰器和元数据回归测试。线上需部署后再验证。 |

## PBL 能力核对

- **AI partner / student project detail**: Exploration and intent confirmation are server-backed, but the upstream model timeout still blocks a verified live end-to-end flow. The project adapter now reads learning-plan material/questions, submits server-graded answers, presigns files, creates artifacts, and records practice evidence through the read-only learningPlanId projection. Reflection persistence still returns 501 SERVER_CONTRACT_REQUIRED, and mentor-note projection remains empty because no reflection/mentor-note owner/API exists yet; do not claim a complete production PBL loop until those contracts are added.
- **Skills**：线上 Admin 运行时快照显示 1 项 ready 技能，但模型上游异常使技能注入和版本未能端到端确认。源码 Admin 技能矩阵此前把技能名与 ID 一起提交，而服务端只接受注册 ID，且失败时仍显示成功；本工作区已改为仅提交 ID、失败后回读服务端状态并如实提示。技能内容创建/编辑仍是本地草稿，因为服务端没有对应写接口。
- **MCP / 知识库**：代码存在绑定授权、服务器工具清单和知识引用读取；线上 Admin 显示 5 个 MCP。未执行真实学生知识检索，因为 AI 请求无法进入正常生成。
- **团队**：模板版本与团队运行时的绑定设计及项目阶段角色解析已在源码中；线上只有 2 个已启用团队，且探索未确认前没有项目团队投影。本次尚无可用的线上光学团队绑定证据。
- **工具**：服务端 AI Runtime 目录登记了六个点号格式的内建工具描述符：`tutor.context_packet`、`tutor.pedagogy_move`、`tutor.mastery_gate`、`tutor.escalation`、`agent-memory.index`、`project.next_step`。它们属于 `server_owned` 能力白名单/元数据，并不证明本次线上光学会话实际调用或持久化成功。旧 SDK/助手目录中的 `knowledge_search`、`mastery_query`、`learning_plan_advance` 等下划线 ID 与该目录不一致，不能作为本运行时已接通的工具能力；项目阶段和掌握状态仍由对应服务端域服务写入。
- **数据库**：已有模板版本、探索/意图确认、测验回答、掌握度、团队/成员、MCP/技能绑定和审计模型。线上写入只确认了探索会话，未确认光学模板版本、团队绑定或作品数据。
- **模板库/团队**：源码具有光学模板定义与受治理 bootstrap 脚本；线上模板列表和团队列表均未观察到已发布、已启用并绑定的光学资产，不能认定线上模板已可选或团队可执行。bootstrap 脚本要求已有 `teamVersionId`，只创建/绑定模板，不创建团队版本、发布或完成验收。

## 已修复与待办

- 已修复源码 `GET /api/v1/admin/teachers` 未注册的问题，并添加 Nest 路由元数据测试；已增加 `/teacher/knowledge` 兼容跳转页，不改动教师冻结导航。两项均须部署后再做线上验证。
- 本工作区已给家长首页、进展页和消息页添加“最新请求优先”保护，并在切换孩子时清除前一孩子的数据，避免较慢的旧响应覆盖当前孩子视图；尚未部署线上复测。
- 线上 Admin 设置页打开时观察到 7 个 Next 静态 chunk 请求返回 400，涉及 profile-growth、database、dialogs、ops、appearance、system、about。更像是部署静态资源不一致，需要用同一构建产物重新部署并清理旧 chunk 缓存后复验。
- Local verification: rebuilding @qitu/contracts, @qitu/database, and @qitu/agent-memory made pnpm --filter @qitu/api typecheck pass. @qitu/contracts build and @qitu/ai-client build/test also pass; student/Admin typecheck remain blocked only by the pre-existing @qitu/ui/preferences / @qitu/design-tokens eyecare export snapshot mismatch.
- 需先修复线上模型网关超时，再以学生账号重跑：确认意图 → 正式项目 → 4 项服务端掌握度证据 → `TheoryMastered` → 安全实践/模拟 → 数据分析与作品 → 教师复核 → 反思/成长记录；同时验证每个阶段的工具/技能/MCP 绑定和数据库审计记录。

## 验证边界

线上路由冒烟可验证应用服务器响应，并不代表每个按钮、对象级权限、所有错误状态或写入流程均已通过。本轮未绕过权限、未在 `TheoryMastered` 前进入真实实践，也未把失败的模型请求描述为成功的完整 PBL。
