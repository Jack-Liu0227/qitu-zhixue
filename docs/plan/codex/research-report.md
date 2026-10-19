# PBL 能力链研究与来源筛选

> 状态：复用 2026-10-19 固定来源，M1 源码已实现、本地全量离线复核已通过；当前实施轮次未重新联网抓取。来源锁基线 `43a0307`。
> 本报告是工程方案依据，不是系统综述、学习效果实验或法律结论。目标设计见 [总架构](./architecture.md)。

## 1. 结论与证据强度

采用小型共享教学 Skill 目录、现有 binding 内的编译制品、项目确认原子冻结和运行时最小权限。这个取舍来自启途的历史项目、Admin 控制和领域 owner 约束，不是外部仓库已证明的教育收益。

Skill 是可复用教学方法，Tool 是服务端可执行能力，MCP 是连接协议。扩大目录前先解决真实助手身份、配置真源、不可变版本和 IMA 项目范围。开发角色/开发 Skills 不自动成为学生团队或工具授权。

原有研究临时材料包括 `qitu-pbl-capability-grounding.md`、两个架构候选、交叉审阅以及 `qitu-pbl-research-20261019` 的抓取记录。当前仓库保留可审阅的结论和 [来源锁](./source-lock.json)，不提交第三方全文、抓取临时正文或学生数据。

## 2. 固定来源和借鉴范围

以下 URL、固定 commit 和抓取 hash 来自来源锁对应轮次。未在当前实施轮次宣称 URL 仍可访问或源码仍是最新。

| 来源 | 固定版本/路径 | 用途与限制 |
| --- | --- | --- |
| [Agent Skills 规范](https://agentskills.io/specification) | 规范及仓库 `69ef37e9424c0a7ea9dd2293b559e43ec8176379` | 包格式、元数据、按需加载；格式兼容不授予工具权限 |
| [Anthropic Skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44) | `skills/skill-creator`、`skills/mcp-builder` | 开发/审核方法，不进入学生 prompt |
| [OpenAI Skills](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431) | `.curated/jupyter-notebook`、`.curated/pdf` | 教师/开发离线方法，不开放学生 REPL/shell |
| [K-Dense Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills/tree/a1043ef544e3a100c28e70a736b6cf32554d0677) | `scientific-brainstorming`、`hypothesis-generation`、`experimental-design`、`uncertainty-and-units`、`scientific-critical-thinking` | 提炼问题、预测、变量和证据方法，重新适配年龄与合同 |
| [MCP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) | 固定 2025-11-25 authorization/security/tools | 输入输出校验、受众、最小授权；不声称当前实现已符合全部条款 |
| [MCP Registry](https://github.com/modelcontextprotocol/registry/tree/11b7b0e274d518b6f449c5ee3518a6151d9848b9) | README 与 FAQ | 发现工具，不是安全认证或官方背书 |
| [PBLWorks](https://www.pblworks.org/gold-standard/pbl-project-design) | 设计要素页面 | 驱动问题、探究、反思、反馈与产物设计，不提供本项目效果数字 |
| [OpenStax](https://openstax.org/books/university-physics-volume-3/pages/4-1-single-slit-diffraction) | 单缝衍射页面 | 物理模型参考，不证明 PBL 教学效果 |
| [OpenAlex](https://help.openalex.org/) / [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | 元数据 API 文档 | 后续只读适配候选，不冒称已接官方 MCP |

`openai/plugins@0722921d5542fc593105c27bd52630babd8b8c2a` 的 notebook 工作流只作开发侧比较，不增加第二套教学编排。

### 许可不能按仓库名称推断

来源锁中的仓库 `licenseMetadata: null` 表示未由仓库元数据得到结论，不代表没有许可。已有逐文件抓取记录显示 Anthropic `skill-creator` 和 `mcp-builder` 为 Apache-2.0；其 PDF/PPTX 文件有不同限制，不可按同仓库默认开源复制。OpenAI 所核验 notebook/PDF 文件为 Apache-2.0，K-Dense 固定根许可为 MIT。

这些是抓取时文件内容的记录，不是当前完整权利审查。脚本、资源、数据集、依赖和 NOTICE 仍须逐包复核。学生教学只采审核的方法与年龄适配内容，不搬安装命令、临床框架、任意代码执行或终稿代写。完整准入流程见 [技能目录](./skills-catalog.md)。

## 3. OpenMAIC 与 DeepTutor 的取舍

[OpenMAIC planner](https://github.com/THU-MAIC/OpenMAIC/blob/ecb940c136cc5b4ea56dc81b2505e64eff1dea29/lib/pbl/v2/agents/planner.ts) 和 [DeepTutor question card](https://github.com/HKUDS/DeepTutor/blob/a053fecf6eeca51ded680de8b8fc41ef63857b11/deeptutor/learning/question_card.py) 的固定原文件有来源锁记录。相应许可记录分别为 MIT、Apache-2.0，不能由此省略资源/依赖审核。

借鉴结构化规划、当前任务锚点、提交与评价分离，以及稳定题卡/pending 的模式。继续使用启途已有 Projects、Learning Plan、Mastery、Tutor、Works 和 Team Runtime，不移植第二个状态库或后台。上游已答卡可展示答案的做法不照搬，启途继续执行不泄活动题答案和分级提示。

历史归档含更广的源码阅读结论，但当前来源锁不覆盖的文件不能冒称本轮逐文件独立抓取。课堂多角色或 planner/instructor/evaluator 分工，也不是每节必须并发多个 Agent 的依据。

## 4. Grok 的零来源记录

| session ID | sources_count | sources 列表数 | 处理 |
| --- | --- | --- | --- |
| `31c80cb2cbb4` | 0 | 0 | 发现线索，不作引用 |
| `273fcc94d77a` | 0 | 0 | 发现线索，不作引用 |
| `bd101ce178fb` | 0 | 0 | 发现线索，不作引用 |

规划会话 `29fe8679925a` 未暴露完整 complexity_assessment 阶段，不能声称完成全部搜索计划协议。更早的会话保留在 [更新前研究快照](../../archive/codex-before-capability-20261019/snapshot/research-report.md)，同样零来源，不把摘要包装成论文、软件事实、法律结论或学习效果。

本轮不再用无链接摘要补证据。后续检索须保存 query、session ID、sources_count 和实际来源，对重要事实再访问原始官方内容并固定版本。未脱敏学生原话、身份、学校或私有教材不能发给公开搜索。

## 5. 研究如何进入实施

技能目录保持 1 个现有基础、8 个首批候选、6 个后续候选。候选不是已安装、更不是已发布。先实现统一模板/纯编译器/身份，再持久化绑定和项目冻结，再完成 IMA 与实验闭环，最后教师评测、隔离试点和灰度。

M1 当前已有唯一模板 strict parser、独立新 16 节 identity/profile 与显式 bootstrap、实际正文草稿生成，以及无 I/O 的能力编译器。Tutor/SDK 按 Admin assistant 当前字段统一身份/模型/skills/tools/trace，未完成 `agent_configs` 全局迁移。profile/content digest/Skill 尚未冻结，课时标题与活动回读已有源码但 0036 迁移未部署，Worker closures 与 IMA 项目 provenance 未接。focused 离线测试通过不等于真实教学请求；最终全量数字以 [验证记录](./validation-20261019.md) 为准。没有因研究结论直接安装或发布 8+6 候选。

首个试点只验证单缝“问题、预测、单变量比较、模拟观察、数据、CER、反思”的教学链。记录真实费用、耗时、恢复和教师分歧；未经受控研究不报告学习提升百分比。来源抓取 HTTP 200/hash 只证明抓取字节，不证明内容安全、许可完备、运行可用或教育有效。
