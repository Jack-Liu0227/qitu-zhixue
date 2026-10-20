# 问题二完成情况报告

> 状态：2026-10-21 / 已完成本轮代码审计；业务尚未全部完成，未作生产验收。

日期：2026-10-21。基线：`61d28fd` 加已有工作树。**结论：未全部完成，不能保证学生输出、项目和对话持续生成并展示个人画像及成长轨迹。**

本轮检查源码和隔离测试，未读取真实学生对话、调用生产助手或手工接受候选。发布/配置/真实运行未核验。

## 逐项结果

| 要求 | 判定 | 代码现状 |
| --- | --- | --- |
| 两类专用助手 | 部分实现 | Admin assistants 和 Worker agent_configs 身份不同 |
| 后台选助手后实际参与分析 | 未贯通 | 页面只保存所选assistant模型；Worker仍固定目标ID |
| 对话自动触发 | 部分实现 | Tutor有teamRunId时发完成事件，不等于所有对话已覆盖 |
| 项目/作品/反思/掌握度触发 | 未贯通 | 消费topic已声明，领域生产事件与team event桥接不完整 |
| 根据真实输出内容分析 | 未满足 | 任务只有refs/元数据，未装配学习证据；执行器不能自行取内容 |
| 闭合字段生成合同 | 已实现 | growth.ts校验字段/长度/引用/版本，真实模型稳定输出未验证 |
| 审核/接受/替换/审计 | 源码已实现，接入不足 | 有owner和Admin POST；无候选列表UI或自动审核链 |
| 个人画像展示 | 已有读链 | profile只读accepted；不代表候选会自动被接受 |
| 成长轨迹页展示AI结果 | 未接入 | growth页读growth_records；AI trajectory仅在profile聚合读取 |
| 历史对话/跨项目持续更新 | 未完整接入 | 无覆盖水位、历史回放、accepted base version输入 |
| 权限和最小可见 | 部分实现 | schema/owner/只读投影已有；原始证据对象核验和家长投影待补 |
| 全链路验证 | 未完成 | API编译失败；单测不覆盖真实事件到模型到双页面闭环 |

## 关键断点

### B1：Admin 与 Worker 身份不一致

- `apps/admin-console/app/(console)/settings/profile-growth/page.tsx:127–128` 默认 `profile-analyst-assistant/growth-trajectory-assistant`。
- 同文件 `151–174` 仅保存 assistant 模型二元组；维度/刷新开关尚未持久化，界面已说明。
- `services/workers/src/team-runtime-projection-source.ts:35–40` 固定 `learner-profile/growth-analyst`。
- `team-runtime-executor.ts:161–163` 读 agentConfigs；`growth.service.ts:208–209` 按固定agent ID取结果。

后台切换不能证明Worker已切换。需服务端统一“画像/成长用途→runtime身份与模型策略”；旧ID显式迁移，不猜名字。

### B2：event 入队，delegate 执行

projection-source:85–95 按 `trigger='event'` 投递；executor:164–174 却统一查 `delegate`。`database/migrations/0017_agent_team_runtime.sql:178–179` 默认配置为 event route。

只有默认event route时，任务可入队却在执行得到 `TEAM_AGENT_ROUTE_NOT_FOUND`。线上若额外有delegate route表现可能不同，本轮未查线上，不声称已复现生产故障。应贯通服务端route身份及trigger，不增加宽泛授权掩盖不一致。

### B3：引用不是可供模型分析的内容

`tutor.service.ts:2142–2162` 发会话/阶段/help_request引用；projection-source:209–236只保留refs和少数元数据；executor:97–120,177–207直接提交这些输入，禁止工具调用，也无按引用读取证据。

不传原始聊天的隐私方向正确，但opaque ID不足以判断兴趣/优势/基础。需授权服务端装配有界摘要、学生确认意图、作答/作品/反思事实及来源；原文不复制进候选、日志、画像或家长投影。

### B4：领域事件与投影入口未接通

Worker只claim `outbox.topic='agent.team.event'`（projection-source:52–63）。`mastery-domain.service.ts:200`、`learning-plan.service.ts:1225–1226` 发直接 `mastery.assessed`，payload是eventId；mastery-projection-source消费它做掌握度投影，未发现转为所需team event的接线。

本轮非测试搜索未找到 project.stage.completed/artifact.published/reflection.created 完整team event生产链。仅消费映射存在不能算已触发。应由owner事务/outbox可靠生产，不用手工造事件验收。

### B5：有审核服务，不等于候选自动显示

- `growth-projection-admin.controller.ts:23–55` 只有validate/accept/reject三个POST。
- `growth-projection-owner.service.ts:75–154` 有锁、版本、接受/替换和审计。
- `team-runtime-mailbox-source.ts:148` 写result，仍是候选。
- 非测试调用中owner.accept只由Admin controller调用，未发现自动策略或候选列表UI。

管理员仍需知道candidate ID才能审核；“自动生成完成展示”缺可运行的自动审核/待人工入口。

### B6：持续版本与真实证据对象核验不足

owner:110–118要求version等于当前accepted+1，但Worker未输入当前版本及上一画像；不能让模型猜版本，应由owner确定base/next revision并处理并发。

owner:184–225核对事件/run/学生/项目/refs集合，未逐项读真实answer/artifact/reflection对象核验存在、归属及撤回。事件声称有引用不足以证明对象证据有效。

`growth-projection-owner.service.test.ts`仅覆盖inspect和迁移字段，未覆盖真实PostgreSQL接受/拒绝、并发锁和回滚。因此owner列为部分完成。

### B7：两个页面没有共同消费accepted结果

`growth.service.ts:189–257`聚合accepted两类候选；`ProfilePage.tsx:116–122`显示trajectory。独立growth页API（`features/growth/api.ts:97–130`）读取growth/summary/project summaries；后端`:287–293`取既有growth records。接受候选的事务没有接入该时间线。

画像页里的成长摘要不能代替独立成长轨迹页。应增加accepted trajectory读投影，区分客观事件与AI总结；若生成正式成长记录仍由Growth owner幂等写入。

### B8：“所有对话”没有覆盖证明

只有teamRuntime存在且teamRunId非空才发完成事件；目标禁用、route缺失、refs为空时投影Worker跳过。未找到历史扫描、水位、回放及“分析至何时”的合同。

需覆盖授权且保留期内的已完成相关对话，按窗口有界装配，显示最新证据时间/待处理。不能把资料不足写成零分或负面画像。

## 完成条件

隔离学生完成探索、项目、作答、作品和反思后，真实事件调用指定助手；候选经过owner接受，两个页面自动更新。第二版、重复/乱序事件、拒绝、撤权和Worker重启均可恢复。当前未达到。
