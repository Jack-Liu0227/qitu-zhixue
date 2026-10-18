# 项目式学习动态交互深度调研报告

> 状态：`research / proposal`
> 调研日期：2026-10-18
> 研究对象：项目与团队绑定、项目大纲/计划生成、跟随学生回答动态调整
> 项目：启途智学（模块化单体、PostgreSQL、Worker、Team Runtime）

## 1. 执行摘要

启途智学已经有项目模板版本、学习计划/目标/课次、`PlanOutline` 纯函数、服务端掌握度、Tutor 结构化回复块、互动测验接口和带门禁的 Team Runtime。下一步不应再造一个独立的 PBL 引擎，也不应直接复制 OpenMAIC 或 DeepTutor，而应补齐既有拼图之间的三个断点：

1. **可审计的项目—团队版本绑定**：当前正式项目冻结 `templateVersionId`；学生端 Tutor 当前通过模板信息与 `admin_teams.pbl_spec` 的项目标识/名称匹配团队，尚不是强外键的一等绑定关系。需要把有效绑定版本在项目确认时冻结，避免团队编辑后历史项目改变语义。
2. **模板结构到学生计划的连通性**：现有确定性课程生成和大纲派生逻辑能覆盖学习目标、课次和教学块；`PlanOutlineStore` 仍是端口/纯函数，需核实并完成正式持久化接线。动态计划应建立在不可变模板与计划快照上，而不是让模型直接重写项目阶段。
3. **作答证据到下一教学动作的明确闭环**：现有测验答案由服务端判分并接入掌握度，Tutor 也有提示阶梯、选项和实验卡片。需要统一有限、可解释的“下一教学动作”策略；更大范围的任务增补只能形成有版本、有依据、可复核的调整，不得自动跨越阶段或门禁。

OpenMAIC 值得借鉴的是结构化大纲到可执行 PBL 任务的分步生成，以及将课堂互动表达成类型化场景；DeepTutor 值得借鉴的是将“问答生成”和“掌握路径”做成目的明确的能力循环、服务端维护未答题/掌握状态并显式呈现答案卡片。两者均是产品/代码参考，不足以证明某个架构可以提升 K-12 学习成绩。Grok Search MCP 此次返回的检索结果没有可获取的引用来源，因此本报告把上游仓库代码/README 作为产品事实来源，把学习成效结论留作待验证假设。

## 2. 问题与范围

**核心问题**：如何把项目模板与团队绑定，并为学生生成可执行大纲/计划，再根据其每轮回答、测验尝试、提示请求和作品证据调整下一步教学动作，同时不破坏启途的项目状态、权限和未成年人数据规则？

**纳入范围**：OpenMAIC、DeepTutor 的公开上游实现；现有启途文档/源码；项目式学习的设计框架；AI 决策、题目和学生证据的服务端治理。

**不纳入/不宣称**：未能找到可核验来源的 SimPBL/ACL 2026 论文及其效果数字；未经实测的“提高 14%/18%/35%”等结果；模型能从自由文本可靠推断认知负荷、情绪或真实掌握度的主张；对任何具体国家/地区法规作法律结论。

## 3. Grok Search MCP 检索记录与证据质量

已用 Grok Search MCP 执行多轮检索，并在检索前建立了查询计划（产品源码核验、PBL/脚手架证据、知识追踪、智能体架构、未成年人隐私）。代表性原始查询：

| 检索主题 | Grok Search 查询示例 | 结果使用方式 |
|---|---|---|
| OpenMAIC 上游实现 | `OpenMAIC GitHub THU-MAIC README features official`；`OpenMAIC paper multi-agent interactive classroom official GitHub` | 搜索摘要提到的论文名与组件细节没有有效引用，改以仓库源码核验。 |
| DeepTutor 上游实现 | `DeepTutor GitHub official RAG tutor project`；`DeepTutor adaptive question answer options official repository` | MCP 对仓库是否存在给出过相互矛盾的回答，不采用摘要，改以本地上游仓库核验。 |
| 所谓 SimPBL | `SimPBL multi-agent project-based learning adaptive scaffolding orchestrator collaborator agents ACL 2026 paper` | 结果未提供任何可用书目/论文链接；既有草案中的 ACL 2026 和效果数字均不作为事实。 |
| 教学与适应方法 | `PBL evidence sustained inquiry formative assessment review authoritative`；`Bayesian knowledge tracing tutorial limitations education research` | MCP 内容包含未证实的数值、占位引用或泛化摘要；不从其提取成效数字。 |
| 架构与儿童保护 | `LLM multi-agent tutoring orchestration structured outputs planner executor education`；`UNESCO guidance generative AI education minors privacy official`；`UNICEF policy guidance AI children privacy education official` | 搜索结果没有来源清单，不能支撑具体法规条文或研究结论。 |

检索系统状态检查显示 Grok API 连通成功；但 MCP `web_search` 响应的 `sources_count` 均为 0，`get_sources` 返回空列表，`web_fetch` 对官方 URL 的提取也失败过一次以上，另有一次检索超时。因此，本报告不把 Grok 生成的回答文本当作可引用事实，也不声称完成了系统综述或同行评审文献审查。为了满足可复核性，以下关于上游功能的判断以仓库快照与正式 README/代码链接为准；后续如能获得可验证的 Grok Search 来源，应补充来源链接、访问日期和对应主张。

在本次报告整理时另做了一轮四主题并行复查，OpenMAIC、DeepTutor、PBL 证据和 UNESCO 指南的 `web_search` 均再次返回 `sources_count: 0`，相应 `get_sources` 也全为空。搜索回答甚至出现“未找到 OpenMAIC 官方仓库”等与已知上游仓库相矛盾的断言，以及没有链接佐证的政策概述；这些回答被作为检索质量告警处理，不纳入事实依据。后文因此区分“Grok 检索记录”和“独立上游/项目材料核查”，不把前者包装成成功的文献检索。


## 4. 上游项目核查

Optics-focused Grok follow-up sessions were also recorded: `520d804cfa5e` (OpenMAIC), `443ec4d0194c` (DeepTutor), `9a1959ff33ea` and `52acde66d064` (high-school PBL and single-slit diffraction), `62d0c27f183c` (adaptive scaffolding and minors), and `7b5a8feb44f8` / `8ff760629201` (PBL evidence and diffraction misconceptions). These results informed the domain proposal in [optics-scattering-diffraction-analysis.md](./optics-scattering-diffraction-analysis.md); no unverified learning-effect number from the MCP output is used as evidence.

本地上游检出在调研日的快照：OpenMAIC `ecb940c136cc5b4ea56dc81b2505e64eff1dea29`；DeepTutor `a053fecf6eeca51ded680de8b8fc41ef63857b11`。仓库内容可通过下面的正式上游链接复核。

### 4.1 OpenMAIC：可迁移结构，不是现成的启途团队绑定引擎

正式仓库将 OpenMAIC 定义为多智能体互动课堂，README 展示大纲/课件生成、测验、交互模拟和 PBL 等模式，并描述生成从 outline 到 scene 的两阶段管线。当前仓库的 PBL v2 源码提供 Planner、Instructor、Evaluator 分工：Planner 以受限工具建立项目/里程碑/微任务；运行时 Instructor 围绕当前微任务回应；Evaluator 在任务/阶段提交后产生评价。源码还明确将普通 PBL 运行时限制为一个 Instructor role，并通过提交与检查机制推进任务。

**对启途有用的模式**：

- 计划采用结构化步骤/工具逐步构造，而不是一次生成任意 JSON 后直接发布。
- 项目必须能执行：阶段说明、任务、完成标准、证据与评估入口彼此对齐；上游附带的 PBL feasibility judge 提示也明确区分“项目实际做事”与“把课程标题写成项目”。
- 规划、教学执行、任务评价职责分离；运行态状态应由可验证操作/服务器记录维护，而不是由聊天语句暗示完成。
- 课堂互动可用场景/资产表达，但本项目不应因此开放任意 HTML、脚本或任意浏览器工具。

**不可直接外推**：课堂中的多 Agent 发言不等同于 PBL 项目中多 Agent 必要性；上游的场景、状态和存储假设也不是启途的合同。上游 README/源码不构成受控的 K-12 成效证据。

### 4.2 DeepTutor：区分一次性问题生成与持续掌握路径

正式仓库 README 将 DeepTutor 描述为 agent-native learning workspace，列出 Ask Questions/Quiz、Question Bank、Mastery Path 等不同能力。代码中 `agents/question/pipeline.py` 的 `deep_question` 是生成题目的一条独立流水线；`capabilities/mastery/` 则围绕掌握路径、题目卡、答案提交、掌握状态和错题回顾构建持续学习循环。掌握路径提示约束未答题和掌握检查；`MasteryQuizTool` 将题面、选项、期望答案/解析和评估分开处理。

**对启途有用的模式**：

- 把“问一组题”和“继续一个掌握目标直到达标”视为两种不同的教学动作，不要把普通聊天里的模型生成选项直接等同于掌握度事实。
- 题目绑定明确知识目标，服务端保有判分依据；学生端收到题目投影，作答后服务端返回受控解释/下一步提示。
- 学习路径要跨轮保留当前目标、未答题、尝试与掌握状态；新题生成不应跳过待答题或重复计分。
- 单选项可以帮助学生聚焦，但对开放设计/探究问题强行构造唯一正确选项会把开放任务错误地测验化。

**不可直接外推**：上游功能是一个可借鉴的软件实现，不证明多项选择、长期记忆或多智能体必然提高项目学习效果；也不代表启途应复制其个人工作区、记忆或题库架构。

### 4.3 名称与论文核验

Grok Search 给出的“SimPBL ACL 2026”及其成绩增益、认知负荷变化数字没有附可验证来源，本次无法在正式仓库快照或有效搜索来源中确认，故标为**未核验**，不作为事实或实施依据。OpenMAIC、DeepTutor 的官方仓库均存在；DeepTutor README 链接到 arXiv `2604.26962`，但本次未能通过 MCP 抓取论文全文，也未使用该论文主张具体实验效果。若未来引入此类论文，应先核对论文题名、版本、研究对象、对照条件、样本与结果。

## 5. 启途现有能力与差距

| 领域 | 当前可复用事实 | 仍需处理的缺口 |
|---|---|---|
| 项目/模板 | `project_template_versions` 不可变；`projects.template_version_id` 冻结模板版本；学生通过确认意图创建正式项目。 | 模板与 `admin_teams` 的一等版本绑定还未形成。Tutor 运行时的团队解析仍从模板/`pbl_spec` 配置匹配；需替换为唯一、可验证的绑定 ID。 |
| 计划/大纲 | `learning-plan` 已有确定性计划生成、目标 DAG、课次时长校验、`PlanOutline` 派生与按课次惰性教学计划；确认计划时创建项目的 owner 流程已定义。 | `PlanOutlineStore` 已定义但源码/文档显示正式持久化尚待接线；课程生成未等同于带项目阶段/团队责任人的完整执行安排。 |
| 掌握度 | `pending_questions` 服务端保有答案；作答由 `learning-plan` / `mastery` 服务端判分；`mastery_events` 是追加式事实，门禁有 `TheoryMastered` owner。 | 需要让项目 Tutor 的 quiz/action 与目标映射和掌握度证据一一对应；不可新建第二套算法/掌握记录。 |
| Tutor 交互 | `TutorReplyBlock` 已有 `options`、`quiz`、`interactive_experiment`、`circuit_experiment`, `optics_experiment`、`pbl_card`、`idea_cards`；现有 quiz 回答接口带幂等键。 | 普通选择目前主要以 `optionLabel` 进入 turn；若需要可靠分支，应传稳定 option/action ID，并由服务端校验动作与项目/节点版本。`board` 等资产不应为“像 OpenMAIC”而抢先扩展。 |


| Optics follow-up | The repository now contains diffraction/scattering wave modules, two simulation prompts, practice objectives, and an `optics_experiment` renderer. | The renderer is still a local visual prototype: it needs stable action IDs, experiment versioning, persisted observations, CER evidence, and server-side policy before it can affect a project artifact or rubric. |
| Optics objective count | The current source and `optics-plan.e2e.test.ts` cover 12 core objectives (2 exploration + 4 theory + 4 practice + 2 review), plus four qualitative non-gated wave modules. | Diffraction/scattering are currently optional domain activities, not independent objectives or mastery gates; promoting them requires a new template version, question mapping, rubric and tests. |
| Team Runtime | Typed delegation 包括 `pbl.plan`、`pbl.advance`、`project.review`；有 run/task/mailbox、对象范围、阶段门禁、客户端 context 白名单与只读团队投影。 | 团队结果依然是候选；必须在模板版本/项目绑定上下文中解析，不能由学生请求指定任意团队/Agent/阶段。 |
| 隐私/审计 | AGENTS.md 强制对象级授权、最小可见范围、敏感访问审计，禁止客户端直接写阶段、掌握度、成长和审计；异步写走 owner/事件。 | 动态调整的依据建议持久化为事件/证据引用与结构化 reason code，而不是复制原始对话或语音到计划日志。 |

## 6. 综合结论与设计原则

### 6.1 推荐采用

1. **模板是骨架，计划是学生实例，执行轨迹是证据**：模板定义目标、阶段、门禁、团队责任、证据与量规；确认时用学生明确选择与排期生成学生计划；执行过程的答题、作品和状态由既有 owner 保存。
2. **先确定性，后有限生成**：MVP 由模板/计划生成器确保目标覆盖、课时和依赖；如用模型，只允许输出候选的面向学生文案、题目变体或补救活动，经类型/领域验证后发布。模型不得改变阶段、目标依赖、门槛和权限。
3. **回答驱动的是教学动作，不是项目状态**：根据可靠信号选择追问、解释、提示、题目、例子、教师协助或可选补救任务；阶段转换仍依赖 owner 证据、门禁与显式服务端命令。
4. **微调与宏观调整分层**：每轮可调整提示层级/题目类型；跨轮计划调整必须有触发证据、前后 revision、幂等、审计和可复核投影。首期只允许增加同一目标下的补救任务或建议人工协助，不删除必做目标、不改变阶段门禁、不自动快进。
5. **只观察可解释的学习证据**：优先使用答题结果、提示请求、学生显式选择、提交作品及其评审；不将鼠标、键入速度、未经同意的情绪识别等隐式信号用于未成年人分层或自动处置。
6. **团队执行受限**：Tutor Leader 是学生交互入口；子 Agent 按团队版本与任务类型白名单产生候选。项目阶段、教学状态、掌握度、作品通过和成长事实仍归领域 owner。

### 6.2 需验证的假设

- 与只有静态清单相比，学生是否更能理解“为什么下一步是这项任务”？
- 基于 `pending_questions`/错误类别的微调是否减少重复卡点，而不是增加提示依赖？
- 受控 quiz/options/少量白板是否比纯聊天更能帮助学生表达与解释概念？
- 对教师而言，卡点摘要是否能提升发现与干预效率，同时不暴露不必要的原始对话？

上述问题应通过一个 4 周、约 2 小时/周项目试点评估，不能在方案阶段宣称效果已经成立。

## 7. 来源与复核清单

### 正式上游实现（产品功能核查）

- OpenMAIC GitHub（MIT）：<https://github.com/THU-MAIC/OpenMAIC>
- OpenMAIC README（调研快照）：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/README.md>
- OpenMAIC PBL Planner（调研快照）：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/planner.ts>
- OpenMAIC PBL Instructor（调研快照）：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/instructor.ts>
- OpenMAIC PBL evaluation criteria（调研快照）：<https://github.com/THU-MAIC/OpenMAIC/tree/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/eval/pbl-v2-planner>
- DeepTutor GitHub（Apache-2.0）：<https://github.com/HKUDS/DeepTutor>
- DeepTutor README（调研快照）：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/README.md>
- DeepTutor question generation pipeline（调研快照）：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/agents/question/pipeline.py>
- DeepTutor mastery quiz tools（调研快照）：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/capabilities/mastery/tools.py>
- DeepTutor mastery-loop teaching protocol（调研快照）：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/capabilities/mastery/prompts/zh/mastery_loop.yaml>
- DeepTutor README 中引用的预印本（本报告未用其作效果主张）：<https://arxiv.org/abs/2604.26962>

### 教学设计/治理参考

- PBLWorks Gold Standard PBL：<https://www.pblworks.org/what-is-pbl/gold-standard-project-design>。用于项目设计要素参考，不视为本产品有效性评估。
- UNESCO, *Guidance for generative AI in education and research*：<https://unesdoc.unesco.org/ark:/48223/pf0000386693>。作为风险识别参考；具体产品权限仍以启途 AGENTS.md 和适用政策审查为准。
- UNICEF, *Policy Guidance on AI for Children*：<https://www.unicef.org/globalinsight/reports/policy-guidance-ai-children>。作为儿童中心风险识别参考，不替代法律意见。

### 启途事实源

- [`../../README.md`](../../README.md)、[`../../student/projects.md`](../../student/projects.md)、[`../../student/learning-plan.md`](../../student/learning-plan.md)、[`../../student/tutor.md`](../../student/tutor.md)
- [`../../sdk/team-runtime.md`](../../sdk/team-runtime.md)、[`../../design/pbl-template-team-binding-architecture.md`](../../design/pbl-template-team-binding-architecture.md)、[`../../design/20261018-pbl-dynamic-interaction-openmaic.md`](../../design/20261018-pbl-dynamic-interaction-openmaic.md)
- `packages/contracts/src/pbl-learning.ts`、`packages/contracts/src/tutor.ts`、`packages/contracts/src/team-runtime.ts`
- `services/api/src/modules/learning-plan/plan-outline.ts`、`services/api/src/modules/learning-plan/plan-generator.ts`、`services/api/src/modules/ai-tutor/tutor.service.ts`、`services/api/src/modules/team-runtime/team-runtime.service.ts`
