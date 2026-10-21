# 问题一：管家配置与光学 PBL 学习闭环

> 状态：2026-10-21 / 管家配置入口已实施并完成定向行为验证；学生 PBL 全链路尚未全部完成，未作生产验收。

## 最新实施

- [光学 16 课时全流程实施](./06-fullflow-implementation-20261021.md)：确认与计划同事务、真实理论判分、逐课证据、实验、报告审核和反思归档；区分隔离验证与线上验收。
- [光学全流程验证结果](./07-fullflow-verification-20261021.json)：本轮构建、owner 行为、PostgreSQL 与浏览器检查的实际范围。
- [管家项目配置实施说明](./09-copilot-implementation-20261021.md)：真实模型、已有项目选择、19 类管理操作、Skill 草稿/发布、逐项回读与重试。
- [模板—团队—助手—知识库—AI 搭档架构报告](./10-template-team-assistant-knowledge-architecture.md)：当前数据流、字段映射及优化顺序。
- [实施验证记录](./11-copilot-verification-20261021.md)：定向结果、全仓失败及并行修改边界。

下方“复核”正文保留实施前的审计事实；当前管家和教学包接线结论以上述新报告为准。

> 2026-10-21 复核；基线 `61d28fd` 加已有工作树。结论：**尚未全部完成**。

本目录包含实施前审计、本轮源码修复和后续任务；未发布或配置生产真实资源。

先读 [完成情况报告](./00-completion-audit.md)、[管家管理 Skill 设计](./06-copilot-skill-design.md)、[剩余任务](./07-remaining-tasks.md) 和 [本轮验证](./08-validation-20261021.md)。01–05 保留为既有设计与先前记录。

## 实施前代码分析

- 管理端已经有独立的模板、团队、助手、Skills、Knowledge/IMA、MCP 和模型页面：
  `apps/admin-console/app/(console)/settings/**`。
- Tutor 已经具备探索会话、推荐卡片、`confirmExploration`、SSE、题库判分、Mermaid/KaTeX、
  `optics_experiment` 和右侧 `team-graph` 投影：
  `services/api/src/modules/ai-tutor/**`、`apps/student-center/features/tutor/**`。
- `TeachingBundleSource` 和 `compileTeachingBundle` 已经能校验 canonical skill ID、模型二元组、
  MCP 工具和 IMA 知识库范围：
  `services/api/src/modules/templates/teaching-bundle.*`。
- 绑定/快照已有 bundleDigest 持久化，但真实目录编译器及 attach hook 没有生产调用；
  运行时尚未完整消费冻结能力。旧 `resolveDeepTeamBinding` 仍有角色/知识库硬编码，未发现生产调用，不得直接接成授权。
- 管家目前只有助手/团队真实创建，其余多为草稿；项目选择、管理 Skill 和统一创建/修改编排未接入。

## 目标边界

1. 不新建第二套项目阶段机、学习计划或 mastery 库；继续由 `projects`、`learning-plan`、`mastery`、
   `works/feedback` 写入正式事实。
2. Admin 保存的是可审核的 bundle 草稿；只有 validate/activate 后才允许 `confirmIntent` 冻结。
3. 学生端只发送意图、答案、实验动作和证据引用；阶段、门禁、题目判分、观察和作品状态全部由服务端 owner 决定。
4. 学生可见的团队状态、工具调用和历史只能来自项目范围内的 Team Runtime 脱敏投影。

## 文件任务

- `01-admin-teaching-bundle.md`：Admin 端原子配置和绑定快照。
- `02-student-pbl-runtime.md`：探索、推荐、确认、课时、题库和右侧预览的接线。
- `03-optics-experiment-protocol.md`：单缝衍射/细雾室散射动作协议与全屏交互。
- `04-verification.md`：按依赖顺序执行的 API、Worker、UI 和安全验收。
- `05-student-tutor-flow-qa.md`：学生端 AI 搭档全流程测试、问题复现、根因和解决方案。
- `TODO.csv`：可直接导入任务系统的拆分清单。

## 实施前复核状态

- 已有草稿 API、绑定快照、对话课件、阶段栏和团队安全投影。
- 管家完整管理、真实教学包编译发布、冻结课时/权限消费、KB 出题与团队解析、观察证据和完整历史仍有缺口。
- 最新依赖隔离构建复现 API `TS2542`，位置 `templates-binding.controller.ts:246`；不能沿用“仅旧依赖快照”解释。
- 学生端 23 项特性测试和 6 项边界测试通过，Worker 15 项定向测试通过；不等于真实模型/数据库/浏览器闭环。

实施顺序以 [剩余任务](./07-remaining-tasks.md) 为准：编译基线 → 管家合同 → 配置发布 → 冻结运行 → 学习交互 → 隔离端到端验收。没有有效绑定时正式项目必须 fail closed。
