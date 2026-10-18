# 项目式学习迁移计划（Planned）

> Codex 深度调研与架构提案：[docs/plan/codex/README.md](./codex/README.md)

> 状态：`planned`。本目录描述中小学生项目式学习 MVP 的可并行实施任务，不代表已经完成的功能合同。
>
> 目标场景：学生每周约 2 小时，连续 4–8 周完成一个课外项目，总投入约 8–16 小时；首个验证项目建议为 4 周、每周 2 小时的“桌面互动机器人”。

## 目标闭环

```text
项目模板 -> 学生确认意图 -> 4/8 周学习计划 -> 每周课程与阶段产出
-> 理论掌握门禁 -> 分步实践 -> 作品版本与证据提交
-> AI 评审候选 -> 教师确认 -> 成长记录与项目归档
```

启途智学自主研发学习闭环、掌握路径、练习和可恢复运行；融合 PBL 四阶段、课堂活动、AI 角色协作和互动工作区规范。目标是能力和交互模式的高效协同，统一遵循启途教学规范与工程架构。

## 活跃实施方案与权威基线（Canonical）

| 规范 / 计划 | 责任域 | 状态 | 入口 |
| --- | --- | --- | --- |
| **Codex 总体架构与实施计划** | 全平台 / 架构 / 运行时 | Canonical 当前提案 | [`codex/README.md`](./codex/README.md) |
| **物理光学 PBL 深度探究与 CER 证据** | 课程 / 评测 / 仿真 | Canonical 当前提案 | [`codex/optics-scattering-diffraction-analysis.md`](./codex/optics-scattering-diffraction-analysis.md) |
| **主题-课时-团队-知识库架构设计** | contracts / templates / ai-tutor | Canonical 当前提案 | [`codex/theme-session-team-ima-design.md`](./codex/theme-session-team-ima-design.md) |
| **技能/工具治理与助手绑定记录** | admin / platform-registry / workers | 2026-10-18 实施记录，部分合同已由当前 Codex 基线替代 | [`20261018-skill-tool-governance-and-assignment.md`](./20261018-skill-tool-governance-and-assignment.md) |
| **问题总结助手（飞书助理）** | feedback / mentor / parent / feishu | 主链路已有实施记录，真实测试租户验收仍待完成 | [`20261018-issue-digest-feishu-assistant.md`](./20261018-issue-digest-feishu-assistant.md) |

## 历史规划与对比草案归档

2026-10-18 之前的早期里程碑任务与探索对比草案已归档至 [`../archive/pre-20261018/plan/`](../archive/pre-20261018/plan/)，包括：
- 早期基础任务：`p0-domain-contracts.md`、`p0-learning-loop.md`、`p0-evidence-review.md`
- 早期并行推进：`p1-template-curriculum.md`、`p1-agent-team.md`、`p1-learning-experience.md`
- 早期试点与验证：`p2-pilot-verification.md`、`p2-release-readiness.md`、`p2-runtime-migration.md`、`teaching-routing-redis-verification-20261015.md`
- 历史对比方案：`antigravity/`、`combined/`（禁止引入平行的 PBL 状态机或数据源）

## 共同验收底线

- 浏览器不直接写入阶段、掌握度、作品通过、成长或审计事实。
- `TheoryMastered` 之前不能进入实践阶段；学生未确认意图不能创建正式项目。
- AI 评审只能生成候选结果；正式验收由领域 owner 校验，必要时由教师确认。
- 所有写操作有对象级权限、幂等键、错误码、审计和失败重试说明。
- 学生、教师和家长页面覆盖 loading、empty、error、offline、permission-denied。
- 每个任务完成时必须补充对应责任域文档和测试/验证说明。

