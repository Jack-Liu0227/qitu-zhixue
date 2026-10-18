# 项目式学习动态交互深度调研报告

> 复核：2026-10-19；源码基线 `f88bb7354ef1bbaef7339f2b6163487c855386d5`。
> 本报告是工程源码/交互研究，不是系统综述或教学效果实验。
> 入口：[差距审计](./gap-audit-20261019.md) · [一体化架构](./theme-session-team-ima-design.md) · [实施计划](./implementation-plan.md) · [验证记录](./validation-20261019.md)。
> 本次更新仅同步产品架构决策，没有重新执行外部检索。上游 commit 和 Grok 记录保持原证据边界；最新本地方案见 [实时生成总架构](./architecture.md)。

## 1. 执行结论

接纳 Theme Core + Session Schedule + Deep Team Binding + IMA Knowledge Integration，但应完善现有模块化单体，不整体移植 OpenMAIC/DeepTutor。

最新需求明确要求真实 AI 实时生成。确定性代码负责冻结课程骨架、校验和计算；绑定团队实际生成个性化大纲、课时教学、逐轮追问及评审候选。此项是启途产品决策，不是由上游 README 或效果研究证明的结论。

启途已具备模板/团队版本、绑定快照、光学 8/16 节计划、DAG、服务端答题/mastery/gates、SSE 与可视化。还需补三个关键闭环：冻结版本对应的真实内容/角色/授权；当前任务/待答问题到下一动作；实验预测/操作/观察/CER 到可审计证据。Admin/IMA 桥已有范围控制，不等于 Tutor 已有项目级授权。

应借 OpenMAIC 的结构化规划、当前任务锚点、提交与评价分离，借 DeepTutor 的题目卡、服务端答案、跨轮待答恢复；正式事实继续由启途 owners 写入。增加 Agent 数量、动画或提示词不替代这些接线。

## 2. 范围与证据方法

问题：如何围绕高中光学驱动问题，生成可执行计划，跟随学生回答选择下一教学动作，并保证物理正确、未成年人权限、证据和版本不漂移？

核查官方仓库固定快照、启途 PBL 主链路/测试、产品规则与匿名网站。未对 Monorepo 每行作形式化审计，未读取线上学生原始对话，未运行完整共享线上教学周期。区分源码存在、配置存在、部署启用、真实请求成功；方法名、typecheck、mock E2E 和 readiness 各自不能跨层证明功能完成。

## 3. Grok Search MCP 检索记录

按要求多轮使用 Grok，并建立查询计划。代表查询：

| 主题 | 查询 | 采用原则 |
| --- | --- | --- |
| OpenMAIC | `OpenMAIC GitHub THU-MAIC README features official`；官方 planner/instructor/evaluator | 固定 commit 核验，不采无链接摘要 |
| DeepTutor | `DeepTutor adaptive question answer options official repository`；mastery/loop/question card | 搜索存在矛盾，改源码核验 |
| 光学/支架 | `high school PBL single slit diffraction misconceptions adaptive scaffolding` | 不采用未核实效果数字 |
| 治理 | UNESCO/PBLWorks/UNICEF 官方资料 | 仅设计/风险参考，不作法律结论 |
| 未核实名称 | `SimPBL multi-agent project-based learning ACL 2026` | 无可核验书目，不作为事实 |

已有代表会话：`fb629d00ee36`、`bbaa3df0c5ec`、`c1b2aeb4e261`、`97cbe08e161b`、`12358e7a1435`；光学轮：`520d804cfa5e`、`443ec4d0194c`、`9a1959ff33ea`、`52acde66d064`、`62d0c27f183c`、`4f36e40ab49b`、`7b5a8feb44f8`、`8ff760629201`。已有记录均为 sources_count=0，get_sources 为空，提取失败/超时不计成功来源。

本轮规划会话 `59f3928dbbc2`，检索会话 `5e06e6a1df28`。精确限定两个官方仓库的六个实现文件，要求可核实 URL、区分课堂多角色/PBL Instructor、不返回成效数字。仍返回 sources_count=0、get_sources=[]，文本自述无法核查，并给出层级错误的示例路径。

故 MCP 仅记为失败的证据发现/线索，不作为引用、不保留推理文本、不包装成论文结论。独立访问官方固定 commit 的 planner/question_card raw URL 均 HTTP 200，本地相同快照可读取。不能把替代核验说成 Grok 返回了成功来源。

## 4. OpenMAIC：规划、当前任务、提交评估

快照 `ecb940c136cc5b4ea56dc81b2505e64eff1dea29`（本地 OpenMAIC/）。

- `lib/pbl/v2/agents/planner.ts` 以结构化工具建立项目信息、角色、milestone、microtask，最后申请 design complete，检查缺角色、空里程碑/任务等。不只是一次生成长 JSON，而是步骤/schema/依赖/完成条件校验。
- `instructor.ts` 将 active milestone/microtask、最近提交和评价作为教学锚点；普通聊天不直接完成任务，要求进入规定提交/评价入口。
- `evaluator.ts` 承担任务/里程碑评价，与日常指导分工。迁入启途时仍只产候选，Works/Mastery/Projects owner 决定正式事实。
- 普通 PBL planner 明确只接受一个 Instructor role；课堂多角色、Planner/Instructor/Evaluator 职责分工、角色扮演不是“每节课多个 Agent 必须轮流发言”的证据。

迁移：Theme/Session 定义骨架；LLM 生成允许的文案/活动/题目候选，服务端检验目标 DAG、时长、必需证据、门禁、角色与工具。正式模板发布仍走 Admin。保留一个主要发言者和按阶段的责任角色，减少多人同时给答案的噪声。

## 5. DeepTutor：题目卡、待答与掌握循环

快照 `a053fecf6eeca51ded680de8b8fc41ef63857b11`（本地 DeepTutor/）。

- `deeptutor/agents/question/pipeline.py` 的一组题生成与 `capabilities/mastery/` 的持续路径不同；后者维护知识点、题目登记、pending question、答案处理与尝试状态。
- `deeptutor/learning/question_card.py` 区分 graded mastery question 和普通澄清 UI；公开投影不带 expected answer/explanation，学生有稳定可回答对象，而非只在聊天中列 ABC。
- `mastery/loop.py` 检查选定 quiz 是否真正发出题卡，避免“说要出题但没有可作答卡”；跨轮保持当前目标与题目，不随便覆盖待答。
- 上游已答卡可展示 expected answer；启途仍须遵守本项目 hint/答案隔离策略，不能照搬错答一次即给完整答案。

迁移：复用现有 pending_questions/answer owner/mastery，不复制新问答库。刷新恢复同一题；求助先给支架，不自动判错。开放观察、变量设计、CER/答辩不能全部单选化：被数据推翻的假设也是有效探究证据，不等同项目失败。

## 6. 模式映射

| 机制 | 可借鉴模式 | 启途基础 | 需补齐 |
| --- | --- | --- | --- |
| 大纲/计划 | OpenMAIC 结构化规划 | template + deterministic plan + PlanOutline | 冻结内容输入/大纲落库/标题 |
| 团队责任 | 规划/指导/评估分离 | 团队版本/绑定/快照优先解析 | roleMap/grant 持久化/hash/覆盖校验 |
| 课时 | milestone/microtask 可执行性 | 8/16 节与 12 目标 | 单一合同、新版本、真实当前任务 |
| 持续问答 | DeepTutor pending/card/answer | 服务端 quiz/attempt/mastery | 当前题投影、稳定动作、澄清与作答区分 |
| 动态展示 | 场景/题卡表达 | Board/Mermaid/KaTeX/SSE/实验 | 安全、恢复、按需展示，不改导航 |
| 动态实验 | 可操作而非静态解释 | 光学滑块/曲线原型 | owner action/event/观测/CER |
| 教材 | 有出处的解释 | Knowledge Center/IMA 桥 | 项目授权交集、文档 provenance |
| 宏观适应 | 持续任务轨迹 | stall/plan adjustment | 证据 + revision + 确认，不自动跨门禁 |

工程分层应区分静态文案、动态可视化、持久证据交互、有依据的教学调整。当前光学主要是动态可视化，正式 quiz 已有证据基础；有动画不等于完整自适应。这些是设计层次，不是学习效果评级。

## 7. 高中光学 PBL 的落点

驱动问题：怎样用可重复的探究区分传播方向改变、狭缝后条纹展开、介质使侧向光束可见，并交付带数据/边界的报告？

先观察/预测/变量，后操作/读数/解释/质疑/CER；理论期沿用四理论目标和 TheoryMastered owner。第 8 节只诊断，不自动过门。实践用注册单缝模型作单变量对照；散射先用封闭细雾室作定性比较，域外不乱套 Rayleigh/Mie 结论。每次回答驱动追问、提示、例子、检查、补救或教师支持，不能直接完成项目。

16 节/角色/授权见一体化架构；公式/分支见光学方案。教师看最小证据摘要，不复制学生原始对话。

## 8. 验证与评估边界

本轮 API/Admin typecheck 通过，API 全量测试仍有失败，学生端缺可解析 mermaid 安装；数字见验证记录。公网 readiness 数据库/Redis 为 ok，匿名项目 API 401；未核验部署 commit 或完整学生周期。

先完成一个可重放衍射任务，再进行 16 节隔离试点。记录证据完整、错误复现、提示淡出/独立作答、作品 rubric、引用、延迟/恢复与教师可操作性。没有受控设计和足够样本，不宣称提高成绩/留存或因果效果，也不用隐式情绪给未成年人自动分层。

## 9. 可复核来源

源码/README 是软件功能证据，不是 K-12 成效证据；引入第三方代码仍需相应许可/声明审查。

- OpenMAIC 官方（MIT）：<https://github.com/THU-MAIC/OpenMAIC>
- Planner：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/planner.ts>
- Instructor：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/instructor.ts>
- Evaluator：<https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/evaluator.ts>
- DeepTutor 官方（Apache-2.0）：<https://github.com/HKUDS/DeepTutor>
- Question generation：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/agents/question/pipeline.py>
- Mastery tools：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/capabilities/mastery/tools.py>
- Mastery loop：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/capabilities/mastery/loop.py>
- Question card：<https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/learning/question_card.py>
- OpenStax 单缝衍射（模型参考）：<https://openstax.org/books/university-physics-volume-3/pages/4-1-single-slit-diffraction>
- PBLWorks（设计参考）：<https://www.pblworks.org/what-is-pbl/gold-standard-project-design>
- UNESCO（治理参考，非法律意见）：<https://unesdoc.unesco.org/ark:/48223/pf0000386693>
- UNICEF（风险参考，非产品合规批准）：<https://www.unicef.org/globalinsight/reports/policy-guidance-ai-children>

DeepTutor README 引用的 arXiv 2604.26962 本轮未核验全文，不据此引用效果。SimPBL/ACL 2026 与未核实百分比不作为事实。未来引入论文需另行明确纳排标准、检索/全文深度和可复核结果。
