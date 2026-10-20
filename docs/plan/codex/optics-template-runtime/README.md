# 光学模板 Runtime Bundle 与 AI 搭档

本目录把“管理员配置 → 学生探索 → 模板/团队接管 → 16 课时学习”收敛为一个可实施的任务包。

## 现有代码分析

- 管理端已经有独立的模板、团队、助手、Skills、Knowledge/IMA、MCP 和模型页面：
  `apps/admin-console/app/(console)/settings/**`。
- Tutor 已经具备探索会话、推荐卡片、`confirmExploration`、SSE、题库判分、Mermaid/KaTeX、
  `optics_experiment` 和右侧 `team-graph` 投影：
  `services/api/src/modules/ai-tutor/**`、`apps/student-center/features/tutor/**`。
- `TeachingBundleSource` 和 `compileTeachingBundle` 已经能校验 canonical skill ID、模型二元组、
  MCP 工具和 IMA 知识库范围：
  `services/api/src/modules/templates/teaching-bundle.*`。
- 模板/团队绑定目前只把 `teamVersionId` 和 `pblSpec` 作为绑定哈希输入；编译后的 teaching bundle
  尚未成为绑定快照的一部分。`resolveDeepTeamBinding` 还保留了硬编码角色和知识库兜底，不能作为正式运行时授权。

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

## Implementation status (2026-10-21)

- Teaching Bundle drafts, digest-bearing binding/snapshot persistence, and formal Tutor frozen-snapshot enforcement are implemented.
- Admin draft writes remain canonical-reference-only; validation fails closed until a server-owned live catalog compiler attaches the payload and digest.
- The team rail and experiment fullscreen are wired, while persistent observation receipts, complete lesson/stage preview, and the full security matrix remain in `TODO.csv`.
- The deterministic student Tutor boundary flow is covered by `tooling/test-tutor-live-boundary.mjs`; the QA report records the remaining live-environment gaps.

实现顺序必须是 `01 → 02 → 03 → 04`。没有 active binding 时，所有正式项目创建和运行时授权都必须 fail closed。
