# P1：项目 Agent Team 编排（Planned）

## 目的

让每个项目模板绑定一支职责稳定的 Agent Team，同时保持项目状态和学生数据的服务端控制。

## 工作项

- 固化默认角色：项目导师（Leader）、概念教练、制作/调试教练、作品评审员；硬件模板增加安全检查器。
- 在模板中声明每个角色允许读取的数据范围、技能、工具、阶段和输出类型。
- 将 `pbl.plan`、`pbl.advance`、`project.review` 与课程、证据和 rubric 关联；所有 route 使用 allow-list。
- 让 Leader 维护“下一步建议”，子 Agent 返回结构化任务结果，不直接向学生暴露内部协同细节。
- 支持 supervised 模式：阶段推进、作品通过和安全相关动作必须等待领域 owner 或教师确认。
- 为超时、租约丢失、重复任务、模型不可用和部分失败提供可恢复状态。

## 验收标准

- 项目模板创建后能解析出唯一 Leader 和阶段角色。
- Agent 输出包含 run/task/correlation/source refs，且版本不匹配会被拒绝。
- Agent 不能绕过 `TheoryMastered`、对象级权限或作品验收。
- Team Run 的动态图只是读投影，浏览器不能通过它写领域状态。
- 至少有一次真实 mailbox/worker 链路测试，不能用 mock 结果冒充协同成功。

## 依赖与交付物

- 依赖：`p0-domain-contracts`、`p1-template-curriculum` 的模板字段；可先并行设计接口。
- 交付物：Team 绑定合同、route/capability 配置、任务处理器、失败恢复测试、管理员配置说明。
- 参考迁移：借鉴 OpenMAIC 的多角色互动，但采用 Qitu 现有的 server-owned scope、候选投影和审计边界。

