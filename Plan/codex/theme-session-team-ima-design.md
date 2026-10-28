> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../README.md) 和各责任域文档。

# Theme、Session、团队与知识范围合同

> 状态：M1 合同、显式新 bootstrap、新 slug 生成器和路由校验已有源码，本地全量离线验证已通过；profile/digest/技能冻结与知识授权未接。2026-10-19。
> 这是 [总架构](./architecture.md) 的细则，不是另一份 curriculum/PBL schema。执行进度见 [实施计划](./implementation-plan.md)。

## 1. 合同归入唯一模板

Theme 描述驱动问题、目标、产物、rubric 与安全约束。Session 描述教学任务、目标引用、时间和责任角色。周只承载排期，不授予工具权限。角色是模板需求，绑定时必须映射到团队真实成员和助手。

当前结构沿用 `ProjectTemplateSpec` 治理 envelope，已合入 `theme.drivingQuestion` 和 `curriculum.profiles`。旧 `curriculum.ts` 导出已改为派生别名，不再平行定义教学语义。新模板 ID 为 `pbl-optics-inquiry-16s`、version `v2-16s`、profile `optics-16x60-v2`、API slug `optics-physical-inquiry-16s`、bootstrap key `optics-physical-inquiry:16s-v2`。CLI 显式 `--curriculum-16s` 才选新模板，默认旧 `optics-physical-inquiry:v1` 正文与 identity 不变。

模板规定内容与能力需求，binding 编译实际团队、助手配置、精确 Skill 制品、模型策略、工具 schema 和 KB ceilings。项目保存不可变 artifact 引用及完整性信息。模板不保存供应商 secret、路由 URL、任意 HTML/JS 或浏览器可自选 grant。

## 2. 校验与内容消费

`parseProjectTemplateSpec` 已严格拒绝未知字段、非法或非整数 session index、重复/缺失序号、未定义目标、DAG 循环、无效阶段/覆盖、时长不自洽及非法字段。实际 schedule、stable session ID 和 checkpoint 属于该合同。教学顺序是有序序列；role/KB 等集合的规范顺序由编译合同定义，不能排序后改变课程顺序。

新 slug 的生成器已收到解析版本的实际 `content.pbl`，按真实目标、profile、sessions 和 blocks 生成草稿；模板创建 validator、新 bootstrap 与 API 入口已有接线。旧 slug 仍走 legacy generator。目标仍是最终消费冻结正文/hash/profile，目前这些字段未冻结，不能将“读取实际版本”写成“项目历史内容已不可变”。反思 block kind、课时标题与活动指导已接入保存和回读，标题使用 0036 可空列并保留历史 fallback；迁移尚未部署，真实数据库验收待执行。

正式确认仍复用 `confirmIntent` 与 `confirmPlan`，目前只核对同一版本并冻结既有 binding snapshot，不按 slug 重选版本。尚无 profile ID、content digest、Skill artifact 冻结与确认时完整重解析。既有事务冻结不能弱化为 warning-only omitted。后续将 artifact ref 加入同事务后，再验收重试、revision 冲突和回滚。探索草稿允许在正式确认前生成受治理候选，但不能因此创建正式项目或提前借用项目权限。

## 3. 显式路由和身份

```text
actor/project permission
 -> frozen project snapshot and artifact integrity
 -> actual schedule profile, session, task and pending question
 -> approved role slot, real team member and assistant
 -> purpose-specific model pair, pinned skills and allowed tools
 -> current restrictions and task gates
 -> candidate generation and domain-owner acceptance
```

禁止按标题、团队名、版本 ID 前缀、成员正则、全局 1–16 或 fallback assistant 猜授权。当前 `getPhaseAndRoleForSession` 已要求实际 profile，TeamRuntime route 已要求真实成员；索引越界、非整数、角色未映射均拒绝，不默认送到 reviewer。完整 profile/project snapshot 与 runtime action 的接线仍是后续工作。

当前 Tutor/SDK 以真实助手贯穿 `displayAuthor.assistantId = effectiveRuntime.assistantId = executionTrace.assistantId`，并带同一模型 pair、skills/tools 与 IMA 当前授权。SDK 每轮回读配置 hash，配置或 model pair 不一致拒绝。本轮使用 Admin assistant 当前字段，保留 runtime-only Agent 路径，未完成全局写源迁移。助手历史指令、模型和 Skill 包尚未冻结。后台专家可提供候选，但不能扩大前台任务授权，日志保留其真实身份。

## 4. 16 课时参考教案

以下内容已进入新模板源码，尚非已发布数据库配置。8 周、每周 2 节、每节 60 分钟。沿用 12 个核心排程目标和四阶段。散射、衍射是非门禁实践模块，不能变成新的 TheoryMastered 目标。第 8/14/16 节 checkpoint 只请求已有 owner 验证，不写完成事实。

| 节 | 任务 | 角色槽 | 证据或限制 |
| --- | --- | --- | --- |
| 1 | 观察光学现象，记录差异 | inquiry/lead | draft，低风险材料，无实践工具 |
| 2 | 聚焦驱动问题与产物 | inquiry/lead | 学生显式确认，不能按课时自动立项 |
| 3 | 反射与法线 | concept | 当前题与解释 |
| 4 | 镜像与模型边界 | concept | 反例/作图，允许复习同一目标 |
| 5 | 折射和介质 | concept，按需 curator | 有范围的引用，命中不证明掌握 |
| 6 | 全反射条件 | concept | 临界条件诊断 |
| 7 | 透镜成像 | concept | 光路和概念证据 |
| 8 | 综合诊断 | concept | mastery owner 判门禁；未过继续同目标补救 |
| 9 | 校准、单位与变量 | lab | TheoryMastered 后注册实践 action |
| 10 | 单缝预测与比较 | lab | prediction、参数、模型版本、observations |
| 11 | 封闭细雾室散射对照 | lab | 区分定性结果和模型适用域 |
| 12 | 图表、趋势和误差 | analyst | 引用已存读数，不补造测量 |
| 13 | CER 草稿与质疑 | lab/reviewer | 具体 observation refs，不代写结论 |
| 14 | 报告修订与提交 | lab/reviewer | works 接受版本，不自动批准 |
| 15 | 答辩、边界和评审 | reviewer | 候选反馈，正式评审仍归 owner |
| 16 | 反思与归档建议 | reviewer/lead | 不自动归档、打分或写成长事实 |

角色槽是模板职责要求，不是七个已存在助手。绑定必须使用真实 roster；一个获批助手可承担多槽。一次由一个前台导师负责，不默认多 Agent 并行。五段式课时的 practice 块名也不能绕过理论门禁，门禁前只能纸笔、概念练习和低风险提示。

## 5. 回答驱动下一动作

微循环是“回答/操作产生证据，策略选择下一教学动作”。宏观循环只提出带 evidence/revision 的补救或教师支持，不另建 pending/mastery store。

| 信号 | 可接受下一步 | 不可接受捷径 |
| --- | --- | --- |
| 待答题时求助 | 保留原题，给分级支架 | 自动判错或覆盖 pending |
| 预测与模型结果冲突 | 保留预测，要求比较已存观察 | 改学生原答案凑结论 |
| 控制变量缺失 | 追问只改变哪个量 | 关键词命中就标掌握 |
| CER 没有数据 | 指向证据缺口和修订问题 | 引教材替代学生观察 |
| 超模型域或来源不可用 | 明示未核验/域外，建议教师支持 | 编造 Mie 结果或教材事实 |
| 学生提交作品 | works/feedback 校验版本、证据和 rubric | Agent 直接 approve 或写成长分 |

模型在允许动作内生成文案，不产生 `advance_stage`、`mark_mastered`、`approve_artifact`。稳定题目/选项/action ID 由 owner 签发，作用域包含 project/session/revision；label 和缓存 ID 不能授权。普通对话不重写整个计划 revision。

## 6. IMA 与实验引用

IMA 有效权限为冻结项目、当前 Admin、真实助手/工具、对象权限和当前任务的交集。四工具、参数/结果过滤与限期 provenance 统一遵循 [MCP 治理](./mcp-tool-governance.md)，不在这里另建 grant store。缺 scope 默认拒绝，撤权立即生效，新增库不扩旧项目。

实验协议细化见 [光学方案](./optics-scattering-diffraction-analysis.md)。action 签发、参数/模型域、幂等事件、observations 和 CER 引用都需要服务端 owner 回执。摘要发给 Tutor 不代表证据已保存；读到教材不等于学生掌握。
