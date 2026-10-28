> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../README.md) 和各责任域文档。

# 教学 Skills 目录与引入规范

> 状态：capability-v1-m1 / 2026-10-20；`tutor-guided-learning`、首批 8 项技能和 9 项扩展候选现均有 `.agents/skills/<canonical-id>/SKILL.md` 源码包，当前目录式 runtime 会发现这些非空教学包。扩展包是 Qitu-authored 候选，尚未完成对抗评测及不可变制品/项目冻结治理；本次未改 Admin seeds、助手绑定或项目快照。目录发现不等于已通过教学评审，也不等于已绑定到助手。能力链见 [总架构](./architecture.md)，源码和行为状态见 [验证记录](./validation-20261019.md)。

## 1. 先补教学方法，不追求大而全

保留 1 个基础技能、首批 8 个通用 PBL 技能和后续 9 个 Qitu-authored 候选，形成最多 18 项可评测目录。新增 `pbl-ai-output-audit`、`pbl-independent-transfer` 与 `pbl-understanding-coach`，分别补上 AI 输出核验、无脚手架迁移和最早断点定位；所有新增源码只为进入评审，不表示通过教学/安全验收。单缝闭环和对抗评测通过前，不得发布或绑定这些扩展候选。18 项是当前目录规划上限，不是同轮加载数量。

全局安全、未成年人保护、工具授权、意图确认和门禁由服务端强制执行，不能因某 Skill 被关闭而失效。`tutor-guided-learning` 提供短轮引导和不代答方法，不拥有写事实的权力。

当前 `getAssistantRuntime` 已按真实 Admin assistant 的 canonical ID bindings 加载当前教学文件；Tutor/SDK 同身份消费所选 skills，SDK 每轮校验配置 hash。纯编译器已能校验精确 Skill version/package digest、published/teaching 状态和工具依赖，但未持久化制品，也未接项目确认冻结。不能把编译器 fixture 中的 reviewed artifacts 当作真实已发布目录。

| 类别 | 用途 | 学生使用条件 |
| --- | --- | --- |
| 教学 runtime Skill | 追问、假设、变量、读图、CER、反思、AI 输出审查 | 审核、发布、版本冻结且本轮选中 |
| 领域资源包 | 年龄适配例子、误解分类、物理说明 | 许可/学科审查，按冻结资源 hash 加载 |
| 教师/开发 authoring Skill | 编写/评测技能、离线 notebook、MCP 开发 | 不进入学生 prompt，不开放 shell/脚本 |
| MCP/Tool | 检索、注册模拟计算、证据提交合同 | 单独服务端授权；Skill 不等于 Tool grant |

## 2. 首批 8 项候选

所有输出都是候选，持久化与事实接受由已有 owner 完成。ID 小写/连字符并与目录名一致，不以展示名冒充 canonical ID。

| 候选 ID / 主角色 | 触发与输入 | 输出和依赖 | owner / 最小验收 |
| --- | --- | --- | --- |
| `pbl-driving-question` / inquiry | draft、兴趣、审核 Theme/年龄 | 一个可探究问题、选择理由、下一观察；无工具 | projects 保留意图确认；不预创建正式项目，不强改学生问题 |
| `pbl-hypothesis-coach` / inquiry | observation/prediction refs、当前目标 | 假设、可区分预测和反例提示；无工具 | Tutor/plan 接受；假设不写成发现，不替学生改预测、不虚构新颖性 |
| `pbl-concept-probe` / concept | 当前题实例、允许的误解标签、求助/作答类型 | 分级提示、澄清、同目标检查题候选 | learning-plan/mastery 判分；求助不算错、不覆盖 pending，模型不看答案键 |
| `pbl-experiment-design` / lab | frozen task、gate、安全域、预测/变量表 | 单变量操作建议、控制变量缺口；仅注册模拟器 | 实验/证据合同接受；门禁前只低风险提示，拒绝任意脚本和危险激光操作 |
| `pbl-data-literacy` / analyst | 已存 observation IDs、单位、数据来源类别 | 比较/读图/误差追问、有限图表候选；注册计算 handler | evidence/plan 验来源；不补造数据，不用小样本作因果结论 |
| `pbl-cer-coach` / lab/reviewer | 学生 claim 草稿、observation refs、冻结 rubric | 标出主张-证据-推理缺口，提出下一修订问题 | works/feedback 管作品；教材不替代实验数据，不代写终稿、不自动通过 |
| `pbl-source-literacy` / curator | 待核验主张、项目 KB、服务端检索结果 | 有界引用、来源限制/冲突提示；scoped IMA | knowledge 管 provenance；无来源标未核验，不虚构页码、不以命中证明掌握 |
| `pbl-reflection-coach` / lead/reviewer | 已有证据、提示历史摘要、目标/rubric | 一条反思/迁移问题、可选改进目标 | Tutor/works；不做心理诊断，不凭打字速度/情绪自动改路线，不自动写成长事实 |

### 上游启发与改编

- driving-question / hypothesis：参考 K-Dense `scientific-brainstorming`、`hypothesis-generation` 的问题-候选解释-可区分预测，不直接移植临床框架或复杂研究计划。
- experiment-design：参考 `experimental-design` 的变量、控制和设计局限，去掉 Bash/Python、人体/动物/临床操作与自动实验部署。
- data-literacy：参考 `uncertainty-and-units`、`statistical-analysis` 的单位/不确定性纪律；首期只描述统计和读图，不移植依赖栈/安装命令。
- CER / source-literacy：参考 `scientific-critical-thinking`、`citation-management` 的证据核验；不做任意全文采集、Google Scholar 抓取或外部凭据使用。
- concept / reflection：基于启途教学规则、pending/quiz owner 和 PBLWorks 要素原创；不声称上游已有同名开箱即用 K12 技能。

固定版本、实际路径和许可见 [研究报告](./research-report.md) / [来源锁](./source-lock.json)。来源锁对应轮次未穷尽审查上游脚本、资源和依赖，当前实施未重新联网；MIT/Apache 不等于适合未成年人或可直接执行。

## 3. 后续 9 项（源码已新增，仍待审核）

| 候选 ID | 角色/价值 | 启用条件与反向验收 |
| --- | --- | --- |
| `pbl-team-facilitation` | lead：学生分工、协作阻塞 | 真实协作者授权；不自动邀请他人，不把 AI 团队当真人协作证据 |
| `pbl-peer-critique` | reviewer：rubric 具体反馈 | 授权脱敏作品；不公开个人资料，不凭同伴赞同判通过 |
| `pbl-artifact-revision` | reviewer：学生自己的修订计划 | works 版本/反馈 ID；保留旧稿，不代写或覆盖提交 |
| `pbl-defense-coach` | reviewer：证据答辩与反例 | claim/evidence refs；不泄正式考核答案，不替教师评审 |
| `pbl-visual-explainer` | concept/analyst：板书、KaTeX、Mermaid | 安全渲染、规模限制、移动端验证；不生成 HTML/JS/外链脚本 |
| `optics-wave-inquiry` | lab/analyst：衍射/散射和模型边界 | 正式 action/observation/CER；域外拒绝定量，不新建 mastery 目标 |
| `pbl-ai-output-audit` | concept/reviewer：审查一条 AI 生成主张或建议 | 当前目标和服务端范围；只比对授权证据，不打分、不写作品或学习状态 |
| `pbl-independent-transfer` | concept/analyst：把一个已学关系迁移到近邻新案例 | 服务器提供的 bounded transfer task；不代答、不自动判定掌握或推进项目 |
| `pbl-understanding-coach` | concept/coach：定位解释中的最早断点并做同目标检查 | 仅使用服务端题目/证据/提示等级；不写学习记录、不判定掌握或生成未注册题目 |

### 本批源码和开源参考

下列上游仓库仅作方法参考，没有将整包复制进 `.agents/skills`；新增文件依据 Qitu 的项目权限、冻结版本、未成年人保护及 PBL owner 规则重新编写。引用均固定到检查时的 commit，许可仅表示上游授权，不代表技能通过 Qitu 的教学或安全评审。当前仓库没有项目级开源许可证，因此这 9 个 Qitu-authored 候选不写 `license` 字段；在权利人确认并补充适用许可前，不得对外发布或宣称它们是开源包。

| Qitu 技能 | 参考来源与许可 | 处理方式 |
| --- | --- | --- |
| `pbl-team-facilitation` | Qitu `Theme-Session-Team-IMA` 规则 | 由项目团队版本、真实成员和授权约束原创，不引入通用组队脚本或写权限。 |
| `pbl-peer-critique`、`pbl-artifact-revision` | [idstack `assessment-design`](https://github.com/savvides/idstack/blob/1767027166aeeae1c64c21925b01a9c848abcf99/skills/assessment-design/SKILL.md)（MIT）；[AI Socratic Tutor](https://github.com/bstellato/ai-teaching-skills/blob/6d3f85726e7b0fedacc8a078e174161293777044/ai-socratic-tutor/SKILL.md)（MIT） | 仅参考 rubric 对齐、一次聚焦反馈、保留学习者推理的方法；不引入 idstack 的 Bash/Write/Edit/Agent 工具指令，也不复制其成品文本。 |
| `pbl-defense-coach` | [AI Socratic Tutor](https://github.com/bstellato/ai-teaching-skills/blob/6d3f85726e7b0fedacc8a078e174161293777044/ai-socratic-tutor/SKILL.md)（MIT）；idstack `assessment-design`（MIT） | 仅参考逐步追问和围绕 rubric 检查证据；正式考核答案、评分及通过事实仍归服务端/教师 owner。 |
| `pbl-visual-explainer` | idstack [`accessibility-review`](https://github.com/savvides/idstack/blob/1767027166aeeae1c64c21925b01a9c848abcf99/skills/accessibility-review/SKILL.md)（MIT）；[ACCESSIBILITY accessibility skill](https://github.com/KreerC/ACCESSIBILITY.md/blob/2bf8ddcf87e09dd0caac609abb979cc19aca2555/accessibility/SKILL.md)（MIT） | 只参考可访问替代文本和包容性检查；未移植上游 shell、文件写入、子 Agent 或网页审计工作流。 |
| `optics-wave-inquiry` | 已锁定的 [K-Dense scientific-agent-skills](./source-lock.json)（MIT） | 只参考科学探究方法；运行范围仍由光学注册模型、服务端 gate 和参数域限定。 |
| `pbl-ai-output-audit` | [Jack Skills `ai-literacy-course`](https://github.com/gcmdnt90/Jack_Skills/blob/a0258db8c5b84df385f2a75a47990681658bfda1/skills/ai-literacy-course/SKILL.md)（MIT） | 仅参考批判性核验 AI 输出的方法；不复制课程流程，不创建学习者 tracker/画像/掌握记录，候选只处理当前单条输出及服务端授权证据。 |
| `pbl-independent-transfer` | [dsh-project-based-learning](https://github.com/Kirisame1969/dsh-project-based-learning/blob/2e0d8d1942e84221c514d455016c5ea402447cec/skills/dsh-project-based-learning/SKILL.md)（MIT） | 仅参考“真实作品—新情境迁移—证据化修订”的教学结构；不复制其本地 `.learning/state.json`、课程状态迁移或执行脚本。 |
| `pbl-understanding-coach` | [understanding-coach-SKILL](https://github.com/eiainano/understanding-coach-SKILL/blob/a217857c4a6f0a9d9aeca9ee88e96c5df3b017f5/SKILL.md)（MIT） | 仅参考“定位最早断点—等待独立判断—用近邻案例验证”；不复制本地进度文件、HTML/文件写入或持久化流程。 |

额外筛选但不直接导入：[Learning Commons `k12-check-for-understanding`](https://github.com/learning-commons-org/agent-skills/blob/5894a3c9dcda8d4499bb73fad85b2b11a2b78344/skills/k12-check-for-understanding/SKILL.md)（Apache-2.0）定位为教师侧数学形成性评估，与学生侧 `pbl-concept-probe` 不同；[Kirisame1969 `dsh-project-based-learning`](https://github.com/Kirisame1969/dsh-project-based-learning/blob/2e0d8d1942e84221c514d455016c5ea402447cec/skills/dsh-project-based-learning/SKILL.md)（MIT）面向 DeepSeek Harness，要求本地课程状态文件，不接入 Qitu 服务端状态 owner；[full-stack-skills `learning-assessor`](https://github.com/full-stack-skills/teaching-skills/blob/97d1da15c82b1131011f90011c19f91e323d39b3/skills/learning-assessor/SKILL.md)（Apache-2.0）是通用评测/authoring 方法；[JcDizzy `teaching-programming`](https://github.com/JcDizzy/teaching-programming/blob/b4cd31cf427a1013db5bd88e8e3cce54bde8a54c/SKILL.md)（MIT）专用于编程教学并要求本地掌握度记录。以上均未原样导入；[learn-anything-with-AI](https://github.com/read2017/learn-anything-with-AI/blob/0b06235ed73890018a40d058c03308c97312b51c/skills/learn-anything-skill/SKILL.md)（MIT）同样包含规划、文件产物和掌握度流程，与服务端 owner 边界不符。

来源 URL、固定 commit、许可证文件、原始字节哈希和 Grok 搜索状态见 [source lock](./source-lock.json)。Grok 本轮有一次检索返回 4 个与候选仓库无关的引用，另两次 `sources_count: 0`；均只作检索线索。许可与内容判断来自 GitHub API、固定 commit 的仓库树及原始文件，不来自 Grok 摘要。

`scientific-visualization` 仅启发图示检查；`scientific-writing` 仅启发草稿反馈，不自动代写学生论文；`sympy` 仅启发已测试的服务端计算，不给学生 Python REPL。

## 4. 团队与助手矩阵

以下为目标角色槽，不表示数据库已有七位正式导师。一个真实助手可经审核承担多槽；一次由一个前台导师负责，后台专家按需产候选，不默认并行七次模型调用。

| role slot | 典型任务 | 按任务选用的方法 | 工具上限 |
| --- | --- | --- | --- |
| lead | 协调、大纲、反思 | driving-question、reflection、后续 team-facilitation | 只读上下文，无领域事实写权限 |
| inquiry | 1–2 探索、确认前 draft | driving-question、hypothesis | 审核观察资源，不预创建项目 |
| concept | 3–8 概念/同目标补救 | concept-probe、按需 source-literacy | 题目候选、只读检索，不读答案键 |
| lab | 9–11 操作、13–14 报告过程 | experiment-design、hypothesis、CER | gate 后注册模拟器及 action 合同 |
| analyst | 12 数据/误差 | data-literacy、后续 visual-explainer | 有界计算、已存观测读取 |
| reviewer | 15–16 质疑/修订/反思 | CER、reflection、后续 critique/defense | 授权作品/rubric 只读、评审候选 |
| curator | 按需后台核验 | source-literacy | scoped IMA 四只读工具的批准子集 |

前台教学角色共享基础 `tutor-guided-learning`。缩写仅为表格阅读便利，真实绑定必须使用完整 canonical ID。自动选择只限 frozen role/purpose allowlist。服务端先按任务看元数据，再加载选中正文，再按需读已审核资源，这才是 Agent Skills 的 progressive disclosure；它与提示答案等级是两套机制。

“基础引导 + 最多 2 个专门方法”可作可调试点预算，不是实测结论。另设 token/资源字节/工具调用/费用预算，超额拒绝或缩减候选，不能截掉安全规则后继续。记录实际使用与教师评测，低价值技能不发布。

## 5. 制品合同与标准兼容

项目字段放入 `metadata`，由显式适配器读取。当前 loader 读顶层 `version/runtime`，下例不能未经迁移直接放进生产：

```yaml
---
name: pbl-experiment-design
description: Coach one-variable inquiry using an approved project task.
license: LicenseRef-Qitu-Reviewed
metadata:
  version: "1.0.0"
  qitu-runtime: teaching
---
```

license 必须按真实原创/改编权利填写，示例不覆盖上游许可；保留适用版权/许可/NOTICE。标准的 `allowed-tools` 只作提示，不转 grant。新制品目录名/name/canonical ID 不一致拒绝；旧别名做一次性迁移，不在运行时猜名。缺 runtime 分类的新导入拒绝，修正现有“缺字段仍作为 teaching”的兼容默认。

制品记录 canonical ID/version、完整文件清单/package digest、来源 repo/commit/path、许可文本 hash/归属、作者/审核人、年龄/学科/purpose、输入/候选输出 schema、必需/可选工具依赖、兼容模板/策略及评测集版本/结果。正文/资源由服务端保留，浏览器仅见摘要。

状态：`quarantined → reviewed → published → deprecated`，风险可 `revoked`。同 ID/version 不可换包；重试幂等。published 不等于已绑定，绑定回读不等于真实执行；deprecated 不终止旧 pin，revoked 阻止后续调用。

## 6. 导入发布流水线

1. 隔离登记：固定 commit，仅下载有界候选，不 `git pull main`，不由学生触发安装。
2. 权利/供应链：逐技能许可、资源/依赖 NOTICE、路径穿越/符号链接/归档/二进制/脚本、secret/未成年人数据/答案库、网络目的地检查。
3. 教学改编：仅提取审核方法、原创年龄适配提示、保留归属；无执行脚本/任意网络/终稿代写。
4. 合成与对抗评测：正常、误解、信息不足、求助非作答、索要答案、检索注入、跨项目/旧 revision、撤权、依赖不可用。
5. Admin 发布：显示差异、依赖、风险、评测和 digest；目录失败/未知 ID 不覆盖；部分失败不显示全成功。
6. 绑定编译：新团队/binding 选精确版本；旧项目不自动升级；受控 canary 后扩大。
7. 维护撤回：观测候选接受、提示适切性、证据完整性、泄漏/越权、实测延迟/成本；撤权不删除旧证据。

## 7. 评测门槛

固定对抗集中，越权、答案键泄漏、伪造引用/观察、直接写掌握/作品通过、危险实验指令零容忍；测试通过不证明现实风险为零。教师按年龄/目标盲评并保留分歧，不凭空承诺通过率或学习提升。

用相同合成任务/模型比较单技能基线和新增方法，记录教师评分、恢复、token/耗时/费用；仅保存合成/脱敏数据，不默认把学生原话交给 Grok/公开搜索。先证明少量技能改进一条闭环，再扩目录；ready、后台勾选或仓库数量不是教学生效证据。
