# PBL 能力链架构与实施入口

- 2026-10-24：[光学与雷霆战机逐课录屏验收](../../issues/20261024-recorded-journeys.md)：多 agent 实际学生操作、失败与恢复录像、视觉审计、修复部署及验收限制；已完成。
- 2026-10-24：[问答、课件与课时完成的修复方案](./interaction-remediation-20261024.md)：问答保存闭环、补讲与来源故障恢复、注册演示和资产发布的分批实施；部分实施，各项状态见文内矩阵。

- 2026-10-24 晚间：[项目问答与课件交互风险复核](../../issues/20261024-interaction-risk-audit.md)：两模板线上只读核对、课件发布状态与隔离缺陷复现；区分已修复展示问题和仍开放的问答、补讲、来源恢复及资产复用问题。

- 2026-10-24：[光学与雷霆战机自主学习线上全流程验收](../../issues/20261024-autonomous-fullflow-live.md)：真实模型自动评价、两项目逐课记录、思考页图示保留、实际模拟/游戏运行与全部应用服务重启复核；结果和限制以验收记录为准。

- 2026-10-24：[灵感空间新增八类项目、团队与模板计划](./inspiration-eight-project-expansion-20261024.md)及[实施记录](./inspiration-eight-project-implementation-20261024.md)：八个新类别、领域团队、64 课时和通用作品证据已部署；学生目录十项，模板库合并教学编排台，实际课时与线上回执见[交付证据](./evidence/inspiration-eight-projects-release-20261024.json)。

- 2026-10-24：[自主学习评价与教师只读](../../issues/20261024-autonomous-learning.md)：学习、作品与课时推进取消教师审批依赖，保留服务端证据和掌握度门禁；本轮验证与发布边界见记录。

- 2026-10-24：[两模板逐课工具、课件与问答重测](../../issues/20261024-tools-courseware-full-retest.md)：工具参数修正、IMA 调用诊断、动态条纹与课件重播、正式问答求助及线上逐课验收；执行进度和验证边界以该记录为准。

- 2026-10-24：[两个模板的自然学习链路复核](../../issues/20261024-learning-chain-gap-audit.md)：历史实验门禁误报的实际复现与修复，以及两模板 16 课的教学、课件、巩固、评价和续学断点；修正合成流程通过不等于自然教学闭环的验收口径。

- 2026-10-24：[家校反馈私有附件](../../issues/20261024-feedback-attachments.md)：上传、工单事务归属、双方下载及部署验收，已补齐此前的附件缺口。

- 2026-10-24：[三端学习数据与家长模块接入](../../issues/20261023-family-learning-integration.md)：学习足迹、共享统计、家校沟通的部署与验证记录，含账号场景及附件边界。

- 2026-10-23：[课时级助手与团队绑定](./template-session-bindings-20261023.md)，包含绑定限制诊断、逐课冻结路由、验证和四阶段兼容边界。

- 2026-10-23 新增量计划：[零基础理论教学与可迭代课件资产](./tutor-course-team-redesign-20261022/07-zero-base-teaching-and-courseware-assets.md)。先依据知识库讲解与动态演示，再出题、补救和完成课时；课件按项目实例、候选审核、版本发布和按需复用推进。仅更新计划，提示词接线和资产机制尚待实施。

- 2026-10-23 当前专题：[干涉与衍射八课设计](./tutor-course-team-redesign-20261022/05-interference-diffraction-curriculum.md)、[实施与验收记录](./tutor-course-team-redesign-20261022/06-implementation-and-acceptance.md)。新专题已部署为受治理试点，正式课堂验收与课件资产库自动归档仍按记录中的边界推进。下方 2026-10-19 交付状态属于当时基线。

- [知识中心配置与助手绑定矩阵](./knowledge-center-config-matrix-20261022.md)：2026-10-22 已确认的配置界面、增量授权、IMA 重新关联与验证边界。

> Release update (2026-10-19 21:39:47 +08:00): `63e3be8` is deployed, main is synchronized, and migration 0036 is applied. Earlier offline-only statements below describe the pre-release round. Full teaching acceptance and 16-session bootstrap activation are still not complete. [Release evidence](../../admin/release-20261019-main.md).

> 状态：2026-10-19 / capability-v1-m1 首批源码已实现，本地全量离线验证已通过（1040 项 API 测试），生产未验收；源码基线 `43a0307eb776185d7561f213d75b3d7312616aa9` 加当前工作树。
> 本轮复用已有联网研究，实现唯一模板合同、纯编译器与 Tutor 身份一致性，并收口全部当前方案文档。没有安装/发布新 Skill/MCP、迁移数据或部署新功能。目标设计不等于全部接线完成。

## 当前交付边界

M0 基线审计部分完成，不能宣称所有 characterization tests 已完成。M1 已实现以下源码切片；focused runner 已通过，本地全量离线验证通过，但不将未接线能力标为 verified。实际结果统一写入 [验证记录](./validation-20261019.md) 和 [机器可读状态](./delivery-status.json)。

- `ProjectTemplateSpec` 统一 Theme/课时合同与严格解析。新 16 节模板使用 `v2-16s`、profile `optics-16x60-v2`；显式 `--curriculum-16s` bootstrap，默认旧 v1 不变。
- 新 slug `optics-physical-inquiry-16s` 根据实际版本正文生成草稿，旧 slug 保留兼容生成器；反思 block kind、课时标题与活动指导已接入保存/回读，0036 标题迁移尚未部署。
- 纯编译器验证实际 profile、真实成员/角色、模型 pair、精确 Skill 制品、工具 schema 和 KB ceilings，输出确定性 payload/digest。尚无制品入库、activate 或项目确认冻结接线。
- Tutor/SDK 的显示、模型、技能、trace 与 IMA 当前授权使用真实助手身份。当前教学能力来自 Admin assistant 字段；这是过渡解析，不是已迁移为 `agent_configs` 或历史版本冻结。SDK 每轮回读并校验配置 hash 和模型 pair。

两个确认入口目前只冻结既有同版本 binding snapshot。profile/digest/Skill 尚未冻结，session 路由的真实 profile/member 检查也不能冒称冻结制品运行时完成。

后续 M2–M6 的不可变制品、两个确认事务、完整运行时、IMA 项目权限、实验闭环和灰度部署仍未完成。`.agents/skills` 当前含 1 项基础技能、首批 8 项和 6 项扩展候选源码；新增候选未完成评测且未发布，默认助手仍只绑定基础技能。新增授权不扩大旧项目，当前禁用与撤权立即收紧。

## 推荐路线

把“项目模板 → 团队 → 助手 → Skills → Tools/MCP”接成一条受 Admin 治理的版本化能力链，而不是把更多提示词一次性塞给所有助手。

- 编写时复用：少量经过许可、安全和教学评审的 canonical Skill；模板声明目标、课时、角色和能力需求。
- 绑定时编译：现有 binding owner 把实际模板正文、排期、真实成员、助手定义、选定 Skill 制品、模型策略与知识授权编译成不可变清单。
- 确认时冻结：沿用正式确认事务冻结清单引用/hash；未确认意图仍只使用 exploration/draft。
- 运行时收紧：同一次解析决定展示导师、真实模型、技能和工具；冻结上限与当前授权求交，再减去撤权集合。新增能力不扩大旧项目。
- 学习事实不外包：AI 实时生成大纲、课时与对话候选；Projects、Learning Plan、Mastery、Works/Feedback 继续校验并写正式事实。

## 阅读顺序与单一责任

| 文档 | 唯一主责 |
| --- | --- |
| [总架构](./architecture.md) | 版本链、owner、编译/运行接口、两方案取舍 |
| [实施计划](./implementation-plan.md) | PR 依赖、迁移、验收、灰度与回滚 |
| [技能目录](./skills-catalog.md) | 首批 8 项与后续 6 项候选技能、角色矩阵、导入/评测 |
| [MCP 与工具治理](./mcp-tool-governance.md) | IMA 四工具、项目授权/provenance、外部适配器 |
| [Theme-Session-Team 合同](./theme-session-team-ima-design.md) | 模板真源、排期、显式路由和 16 课时示例 |
| [差距审计](./gap-audit-20261019.md) | 当前代码事实、风险、源码路径与闭环条件 |
| [光学领域方案](./optics-scattering-diffraction-analysis.md) | 模型域、安全、动作/观测/CER 协议 |
| [研究报告](./research-report.md) | 检索范围、固定来源、许可筛选、证据限制 |
| [来源锁](./source-lock.json) | 抓取 URL/hash、固定仓库 commit、Grok 零来源记录 |
| [本轮验证](./validation-20261019.md) | 本轮构建/测试、文档检查及未执行的生产验收 |
| [交付状态](./delivery-status.json) | 每个切片的状态、证据层和未完成边界 |
| [既有发布基线](./takeover-validation-20261019.md) | 历史发布 SHA 和原始记录入口，不冒充本轮部署 |

## 先修什么

当前 `.agents/skills` 有 `tutor-guided-learning@1.0.0`、首批 8 个教学候选和 6 个扩展候选源码包；默认助手 seeds 仍只绑定 `tutor-guided-learning`。新增目录不代表已评测、发布、绑定或冻结进项目快照；`.pi/agents` 的 31 个开发角色也不是生产教学团队。发布/绑定前仍须按状态关闭以下基线缺口：

1. 教学链已改读 Admin assistant 的当前配置，runtime-only Agent 路径保留；全局单一写端迁移和 Worker 统一尚未完成。
2. phase 导师身份已贯穿 Tutor/SDK 实际生成；本地全量离线回归通过，不等于历史配置冻结。
3. Theme/Session 已归入唯一模板合同并接新模板消费端；profile、Skill/助手/工具和项目 IMA grant 尚未完整冻结。
4. 项目级门禁、四个 IMA 工具参数/引用范围，以及 Worker 的真实工具执行边界。

已保留用户确认的三个知识库提交 `7463af8`、`43a8680`、`43a0307`：Admin 列库验证和 PDF 原文阅读是新增基础，但不等于学生项目级 IMA 权限已完成。验收区分源码存在、配置存在、发布启用、真实请求成功和学习效果。

## 清理结果

原有 9 份当前文档已按责任重建/更新，另保留 Skill、MCP、来源锁与交付状态。旧正文逐字节归档到 [更新前快照](../../archive/codex-before-capability-20261019/README.md)，保留原路径/替代路径与 SHA-256 [清单](../../archive/codex-before-capability-20261019/manifest.json)。历史失败、修复和发布记录保留，不再与当前方案混写。

运行 `node tooling/check-codex-plan.mjs` 检查当前链接、所有归档清单 hash、JSON 和状态证据；`--self-test` 验证拒绝路径。脚本只读，不改 archive，也不证明业务或生产成功。

`antigravity/combined` 继续仅作 [历史比较](../../archive/pre-20261018/README.md)。不新建平行课程、PBL、binding、pending 或 mastery 状态库；不改变 AI搭档 `/student/tutor` 与灵感空间 `/student/inspiration` 导航。


## Optics 16-Session Template

Implementation and rollout boundaries: [16-session template](../../admin/optics-16-session-template.md).

## Teaching arrangement and profile UI (2026-10-22)

- [Design and scope](./teaching-profile-ui-20261022.md).
- [Verification and integration limits](./teaching-profile-ui-verification-20261022.md).

## AI 搭档团队与逐课闭环重设计（2026-10-22）

[本轮核查与方案](./tutor-course-team-redesign-20261022/README.md) 区分接待助手、领域总导师、逐课主讲与协作，以及服务端完成 owner。专题范围为干涉与衍射，[当前 8 课时设计](./tutor-course-team-redesign-20261022/05-interference-diffraction-curriculum.md) 的核心已进入受治理试点，实际边界见 [实施记录](./tutor-course-team-redesign-20261022/06-implementation-and-acceptance.md)。原 16 课及散射方案保留为历史；新一轮零基础教学接线与课件资产机制以 [07 计划](./tutor-course-team-redesign-20261022/07-zero-base-teaching-and-courseware-assets.md) 为准，尚未实施。

## New implementation slices (2026-10-20)

- [光学全流程实施与验收（2026-10-21）](./optics-template-runtime/06-fullflow-implementation-20261021.md)：冻结课时完成规则、真实学习证据与归档路径。
- [Optics template runtime](./optics-template-runtime/README.md): Admin teaching bundle, student Tutor takeover, lesson/team projection and optics experiment protocol.
- [Profile and growth projection](./profile-growth-projection/README.md): evidence contract, domain-owner acceptance, student/parent read models and verification.

## 两项用户需求复核（2026-10-21）

后续实施：[管家项目配置](./optics-template-runtime/09-copilot-implementation-20261021.md) 已接入项目选择和真实管理编排；[协作架构报告](./optics-template-runtime/10-template-team-assistant-knowledge-architecture.md) 列出当前字段关系与剩余接线问题；最新结果见 [管家实施验证](./optics-template-runtime/11-copilot-verification-20261021.md)。以下列表保留实施前审计记录。

- [问题一完成情况报告](./optics-template-runtime/00-completion-audit.md)：管家选择项目、管理 Skill、光学配置与学生 PBL 闭环。尚未全部完成，拆分 15 项任务。
- [问题二完成情况报告](./profile-growth-projection/00-completion-audit.md)：个人画像与成长轨迹生成。尚未全部完成，拆分 12 项任务。
- [本轮验证](./optics-template-runtime/08-validation-20261021.md)：学生/Worker 定向测试通过；隔离依赖构建复现 API TS2542，API 行为测试未执行。生产配置、真实模型和端到端未核验。

以上为 `61d28fd` 加已有工作树的当前审计，不覆盖历史发布记录，也不将目录、类型或草稿存在视为完整功能。

## Agent 驱动教学与成长需求（2026-10-21）

[Skills、MCP、工具与 SDK 审计](./skills-mcp-tools-sdk-audit-20261021.md) 核对 Pi 接入范围、实际工具目录与执行器，记录 SDK 假成功、教学技能撤销和 Worker 范围隔离的复现，以及修复优先级。

[需求评审稿](./agent-driven-pbl-requirements-20261021.md) 统一梳理 Admin 可修改并持久绑定的教学配置、自由探索与确认接管、Agent 动态课件和知识库出题、团队与课时预览、个人画像与成长轨迹。包含新光学版本的 16 课时建议、版本生效范围和 24 个验收场景；这是需求方案，不代表功能已完成或已发布。

- [Skills、MCP 与工具加载优化及验证（2026-10-21）](./runtime-governance-optimization-20261021.md)
- [配置管家的模块参考与读取工具（2026-10-21）](./copilot-module-references-20261021.md)
- [配置管家生命周期测试与能力边界（2026-10-21）](./copilot-lifecycle-verification-20261021.md)

## Image 2 全站素材库计划（2026-10-21）

[全站素材库](./visual-assets/README.md) 已交付 55 个素材母版、110 个运行时派生图及选择/默认继承/批量设置源码，覆盖 10 款可复用助手头像、团队/模板、作品/成长、知识/技能、家校支持、空态与登录。实际验证与待发布事项见 [实施记录](./visual-assets/04-implementation.md)。


## Feishu assistant messages (2026-10-21)

[Assistant-scoped binding and bidirectional messages](../../admin/feishu-assistant-messages.md): implementation, migration 0044, identity checks, durable delivery and verification boundaries.


[双光学模板逐课自动化、课件清晰度与远端重启验收（2026-10-23）](../../issues/20261023-dual-optics-student-e2e.md)：16 + 8 课时主模板及额外 8 课时零基础版本完成；问题闭环、427 项回归、18 服务重启及结构化证据。


[两个可选项目模板与雷霆战机课程（2026-10-23）](../../admin/two-project-catalog-20261023.md)：保留零基础干涉衍射，新增雷霆战机，旧模板归档与远端回读记录。

- [移除独立团队版本资源与管家恢复验证](../../issues/20261023-remove-team-version-resource.md)：教学安排归绑定 owner，历史项目数据迁移后删除旧表。


## 2026-10-24 线上逐课验收

- [雷霆战机与零基础干涉衍射：生产16课记录、问题修复及重启验收](../../issues/20261024-live-two-projects-fullflow.md)。
