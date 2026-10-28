# 干涉与衍射课程：实施与验收记录

> 状态：核心功能已实施并部署为受治理试点；真实课堂验收、正式发布及资产库自动归档尚未完成。

更新日期：2026-10-23。本文区分源码实现、Admin 配置、实际请求与课堂验收。课程设计依据仍为 [05](./05-interference-diffraction-curriculum.md)，通用职责与界面依据为 [01](./01-team-and-contract.md)、[02](./02-interface-and-dialogue.md)。

后续增量计划见 [07 零基础理论教学与可迭代课件资产](./07-zero-base-teaching-and-courseware-assets.md)。该计划区分项目内课件保存、候选审核和跨项目发布；提示词接线与资产机制尚待实施，不能计入下文已有验收结果。

## 当前可用范围

已实现并部署新的 **8 课 × 60 分钟**干涉与衍射专题、四位领域导师、逐课固定开场与编辑、动态板书及有来源的推荐／改编、单缝与有限宽双缝模拟、逐课证据与评价入口。新模板处于 `piloting`，教学绑定处于 `active`，不等于已经通过整班教学效果验收或正式发布。

学生可在[灵感空间的新模板详情](http://122.51.130.204/student/inspiration/recommended/tpl-f37fa560-ecc4-4559-83df-e888a01406e7)点击“与 AI 搭档开始”。先进入带模板名的探索；明确确认意图后才创建正式项目并显示实际八课安排。教师／管理员可在[模板编排页](http://122.51.130.204/admin/settings/templates?templateId=tpl-f37fa560-ecc4-4559-83df-e888a01406e7&versionId=tplv-efd7f9b0-3e59-4824-85c9-2f271a33eeb8)查看配置。

旧课程、团队版本和学生项目继续使用各自冻结的教学合同。新专题使用独立 identity，未把旧 16 课项目在读取时改成八课，也未用旧几何光学掌握记录放行新项目。

## 实现与责任边界

| 部分 | 已落地行为 | 主要实现入口 |
| --- | --- | --- |
| 课程合同 | 八课目标、主讲、协作触发、固定开场、动态资源策略、能力与证据要求进入 `ProjectTemplateSpec`；不另建 curriculum 状态库 | [wave-curriculum.ts](../../../packages/ai-client/src/quiz-bank/optics/wave-curriculum.ts)、[pbl-learning.ts](../../../packages/contracts/src/pbl-learning.ts) |
| 接待与正式教学 | 启途智学助手只负责兴趣与确认前引导；禁止担任团队负责人或新正式课时主讲；未确认探索不启动正式 Team Run | [tutor-team-run.ts](../../../services/api/src/modules/ai-tutor/tutor-team-run.ts)、[教学包编译](../../../services/api/src/modules/templates/teaching-bundle.compiler.ts) |
| 模板与团队编辑 | 逐课编辑主讲、目标、开场、教学指导及协作；保存为新课程版本并回读；团队成员编辑使用稳定成员身份与并发版本校验 | [LessonDraftEditor.tsx](../../../apps/admin-console/lib/components/teaching-binding/LessonDraftEditor.tsx)、[TeamRosterEditor.tsx](../../../apps/admin-console/lib/components/teaching-binding/TeamRosterEditor.tsx) |
| 运行路由 | 根据项目冻结模板、绑定、团队版本、计划 revision 和真实课时取主讲；协作是有明确课时／活动／证据范围的候选建议 | [tutor-teaching-context.ts](../../../services/api/src/modules/ai-tutor/tutor-teaching-context.ts)、[课时协作 owner](../../../services/api/src/modules/ai-tutor/tutor-lesson-collaboration.service.ts) |
| 动态教学 | 支持新生成 BoardBlock、读取授权资料后的推荐卡、保留来源的改编板书、当前检查活动内的有来源选择题；模型不能直接改完成事实 | [tutor-lesson-activity.ts](../../../services/api/src/modules/ai-tutor/tutor-lesson-activity.ts)、[tutor-activity-context.ts](../../../services/api/src/modules/ai-tutor/tutor-activity-context.ts) |
| 知识与引用 | 本项目冻结范围、当前全局授权、导师工具与对象权限取交集；实际读取后签发本轮短期引用凭据，撤权后重新拒绝；只把有界引用元数据交给课件 | [tutor-knowledge-access.ts](../../../services/api/src/modules/ai-tutor/tutor-knowledge-access.ts)、[knowledge-retrieval.service.ts](../../../services/api/src/modules/knowledge/knowledge-retrieval.service.ts) |
| 逐课学习 | 进度显示实际课时及当前活动；聊天底部“本课记录与评价”可展开保存表达、查看评价、完成活动及邀请协作；考核仅在适用时显示 | [LessonLearningDock.tsx](../../../apps/student-center/features/tutor/components/LessonLearningDock.tsx)、[CurrentLessonCard.tsx](../../../apps/student-center/features/tutor/components/CurrentLessonCard.tsx) |
| 历史与清理 | 仅按明确的来源探索外键合并项目聊天历史；删除会话永久清除对应聊天并保留项目；删除项目清除其相关计划、作品与学习记录；不按同名项目猜测合并 | [TutorSessionHistory.tsx](../../../apps/student-center/features/tutor/components/TutorSessionHistory.tsx)、[ProjectListScreen.tsx](../../../apps/student-center/features/projects/components/ProjectListScreen.tsx) |

课件翻页、选择快捷开场、对话次数、保存回答和运行滑块均不等于完成课时。`learning-plan`、`mastery`、`works/feedback`、`projects` 继续分别负责作答、掌握度、作品评价与项目转换。第 2 课有专题准备检查，但课号本身不产生 `TheoryMastered`；报告与反思也必须取得既有 owner 的回执。

普通教学允许明确讲解概念和独立示例。存在当前待答题时，服务端披露状态限制提示、答案及替换题；课件候选也不能成为旁路。`safety.answer_leak.guard` 是工具审计标签，不是新增 canonical Skill。

## 模拟协议与门禁

新增能力 `tutor.propose_wave_activity.v1`，保留旧 `tutor.propose_lesson_activity.v1` 的 schema 与摘要。模型侧沿用已审查技能使用的 wire alias，服务端按实际冻结能力选择协议。

注册模型包括单缝衍射和有限宽双缝干涉，双缝强度包含衍射包络。参数、单位、模型域及远场适用范围由纯模型和服务端复验。正式模拟使用 `specVersion`、稳定 action、项目／计划 revision／课时／活动范围、幂等事件、预测、观察持久化与证据引用；刷新可恢复已接受记录。

`TheoryMastered` 前只允许注册的只读图样预览，不提供正式实验 action 或保存实验观察。屏上结果标为模型计算或模拟观察，不冒称真实测量，不提供真实激光操作指令。旧散射协议继续保留给其历史模板，不混入本次八课专题。

## 线上配置回读

| 配置 | 当前值 |
| --- | --- |
| 模板 | `tpl-f37fa560-ecc4-4559-83df-e888a01406e7` |
| 模板版本 | `tplv-efd7f9b0-3e59-4824-85c9-2f271a33eeb8`，`piloting` |
| 排期 | `wave-optics-8x60-v1`，8×60 |
| 团队 | 干涉与衍射探究导师团队，四位领域导师，负责人 `optics-leader` |
| 团队版本 | v6，`team-version-97648af88b3a44bf19ada41589126ad3` |
| 教学绑定 | `bnd-4f1a274b280348f5`，`active`，校验错误与警告均为 0 |
| binding hash | `55df9db9c550c500470ad01c1804f8c2e227d5c44e014ca6f6c9351390e36ff4` |
| bundle digest | `29833aaaf76cab3f98011c663ac6f5ec3a6fc24a7e0d317732b173fff252535e` |
| 项目知识范围 | 仅本轮核验的“光学”“光学题库”两个既有连接，不继承全部全局库 |
| 新领域 Skill | `optics-coherent-wave-inquiry`，经 Admin 创建、发布与运行目录回读；旧 `optics-wave-inquiry` 字节未改 |
| 新 Skill 发布摘要 | `07fef6a8b3509c9b328757071e78bacad44d6b188d88d529d56bb21e615fda4a` |

四位导师依次承担问题聚焦与协调、概念讲解、模拟与观察取证、答辩评审与反思。模型仍使用 Admin 配置的提供商与模型组合；未在客户端新增模型路由或保存密钥。

## 验证及其限度

验证使用新源码构建依赖包，再编译 API、Worker 和应用类型，避免把 UNC 安装快照当作当前源码。自动化、实际请求、浏览器结果分别保留，不能相互替代。

| 验证层 | 已取得证据 |
| --- | --- |
| 隔离行为测试 | API 共 796 项，795 通过、1 项既有跳过、0 失败；团队 Worker 30 项通过；学生数据适配器 15 项及浏览器服务边界 7 项通过；共 18 个源码构建、行为及应用类型检查步骤通过 |
| 八课完整 owner fixture | 隔离合成 fixture 经作答、七条模拟观察、当前教师质量评价、作品审核发布及反思走到项目完成；不注入生产 mastery，不是实际学生学习效果 |
| 数据与构建 | 官方迁移、PGlite 项目永久删除与历史分页验证通过；工作区 lint、学生端及 Admin 生产构建通过 |
| Admin 浏览器 | 实际八课编辑器、四位领域导师选择、修改固定开场、保存新版本并回读、旧版本不变；临时模板已删除 |
| 学生浏览器 | 丰富开场、真实八课进度、四人成员投影、离线发送禁用与恢复、权限失败及重试、学习记录保存／刷新恢复、窄屏进度入口 |
| 灵感空间浏览器 | 可见试点模板与八课排期，实际点击入口跳转到对应模板开场及导师；历史标题使用模板名，确认前项目数不变；每课时长显示实际 60 分钟 |
| 真实模型与知识库 | 实际生成新板书；`knowledge_search`、`knowledge_read` 后生成一条有来源推荐卡与一块 `origin=adapted` 板书；全过程仍为第 1 课、完成数 0 |
| 永久删除浏览器 | 自由探索会话、项目会话和“我的项目”的删除按钮均调用实际 owner，刷新后不复现；删会话保留项目；删除本轮项目后项目数恢复为测试前的 1 个 |

初轮真实模型测试确实失败过：读取来源未接入课件引用缓存、候选错误仅表现为 `TOOL_UNAVAILABLE`，还有失败回合只留下工具调用。已补读取凭据接线、受限候选纠错和持久化友好错误文本，之后才接受推荐与改编成功结果。另发现课时记录组件未挂载，已恢复为可展开入口，并实测保存与刷新；灵感空间的每课时长也改为读取已启用绑定的实际排期，停止按总分钟数猜测。

目前真实知识推荐／改编成功证据来自受治理的 `knowledge_search`／`knowledge_read` 路径。直接 IMA MCP 工具在此前探测中有失败，不据此声称四个直接工具都已真实调用成功。没有把知识库读取、教师助手建议或模型自评当作学生掌握事实。

## 尚待真实课堂与后续迭代

正式发布继续使用既有试点、教学证据验证与发布 owner。需要真实学生按课时学习、当前班主任评价和作品审核形成证据；本次接口 fixture、浏览器操作与模型生成不替代这些证据，也未据此制造正式发布成功。

课件资产的独立版本、父子改编谱系、审核发布和跨项目检索尚未实现。本次交付的是已有授权资料推荐、当前回合动态生成／引用改编，以及对话与学习证据持久化。后续建设按 [07](./07-zero-base-teaching-and-courseware-assets.md) 单独立项，接现有知识与作品 owner；可以自动保存项目实例和整理受限候选，跨项目发布须经审核。学生自评与答题通过不构成自动发布或学习效果评分依据。

## 可复核记录

本次工作在 `main` 完成。业务提交包括 `ea6e814`、`1d91eca`、`bdc8fa0`、`4b45a1a`；`fdcfbbc` 补充了学生可读的成果名称。部署先构建，再应用已审查的 `0048_project_scoped_gate_evidence` 迁移，并重启 study-remote 全部 15 个服务。API 存活、数据库／Redis 依赖就绪及各平台 HTTP 探测单独验证。

可随仓库复核的脱敏结果见 [acceptance-20261023.json](./acceptance-20261023.json)，包含测试计数、执行步骤、四组浏览器检查、三类真实模型输出、配置与部署状态、原始报告摘要校验值。API 的一项既有工具迁移集成测试因没有显式可丢弃 fixture 数据库而跳过；本次项目历史／删除与迁移另有隔离数据库检查，不能把两者混作同一测试。

用户原有的 `packages/contracts/src/admin-copilot.ts` 可选 `AdminCopilotReceipt.input` 未提交修改，以及 DOCX 附件均保留，未加入本轮提交或生产 bundle。该类型改动在本机源码快照的依赖构建中通过，但其产品行为不在本轮验收范围；快照与提交的这一差别在验收 JSON 中注明。

本次新增记录的本地链接检查通过。仓库通用 `node tooling/check-codex-plan.mjs` 未通过：旧入口要求的 `architecture.md`、`delivery-status.json` 等文件已不在对应路径，另有历史文档状态标注及本机截图链接问题。这些问题未被计入业务测试通过数，也未通过伪造占位文件或修改历史归档来消除。

执行证据保留于本机忽略目录 `.codex-tasks/20261022-interference-diffraction-implementation/`：`final-verification.json`／`.log`、`final-extra-report.json`、`live-model-v2-results.json`（失败过程）、`live-model-results.json`（后续成功）、`admin-ui-results.json`、`student-ui-results.json`、`delete-ui-results.json`、`final-config-readback.json`、`final-deployment-report.json`、`live-health.json`。该目录不作为可跨机器自动取得的公共文档附件；正文记录脱敏结论与稳定配置 identity，不提交密码、密钥或学生原始对话。
