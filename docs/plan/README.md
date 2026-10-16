# 项目式学习迁移计划（Planned）

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

## 紧迫性与并行分组

| 优先级 | 任务 | 负责人域 | 可否并行 | 依赖 | 对应现有 Issue |
| --- | --- | --- | --- | --- | --- |
| P0 | [领域合同与时间模型](./p0-domain-contracts.md) | contracts / learning-plan / projects | 基础任务 | 无 | #54 |
| P0 | [后端教学闭环与门禁](./p0-learning-loop.md) | learning-plan / projects / mastery | 与 P0 合同并行设计 | P0 合同 | #54 |
| P0 | [作品证据与验收合同](./p0-evidence-review.md) | works / feedback / teacher | 与后端闭环并行设计 | P0 合同 | #54 |
| P1 | [项目模板与课程生成](./p1-template-curriculum.md) | admin / learning-plan | 可并行 | P0 合同 | #54、#57 |
| P1 | [项目 Agent Team 编排](./p1-agent-team.md) | ai-tutor / team-runtime / workers | 可并行 | P0 合同；依赖模板字段 | #53、#54、#57 |
| P1 | [学生与教师交互体验](./p1-learning-experience.md) | student / teacher UI | 可并行 | P0 闭环 API 草案 | #48、#56 |
| P2 | [参考项目能力迁移与运行时收敛](./p2-runtime-migration.md) | ai-client / model-runtime | 可并行 | P0/P1 合同稳定 | #49、#50、#51、#53 |
| P2 | [试点验证、观测与发布门槛](./p2-pilot-verification.md) | QA / workers / admin | 可并行 | 至少一条端到端闭环 | #52、#54 |
| P0/P1 | [飞书/Lark 管理汇报助手](./20261017-feishu-reporting-assistant.md) | admin / ai-tutor / workers / compliance | P0 基线与授权先行，P1 发送链路随后 | 管理员助手目录、密钥存储、真实 Feishu/Lark 测试租户 | 待立项 |

## 推荐执行顺序

1. P0 三项先完成合同评审；其中领域合同是其他任务的共同输入。
2. P1 四项并行实现。模板与 Team Runtime 使用同一份模板版本和阶段标识。
3. 用一个固定的 4 周机器人模板跑通端到端试点，再扩展到 8 周和编程模板。
4. P2 专注于已被试点证明有价值的进阶能力，避免先建设通用平台。

## 共同验收底线

- 浏览器不直接写入阶段、掌握度、作品通过、成长或审计事实。
- `TheoryMastered` 之前不能进入实践阶段；学生未确认意图不能创建正式项目。
- AI 评审只能生成候选结果；正式验收由领域 owner 校验，必要时由教师确认。
- 所有写操作有对象级权限、幂等键、错误码、审计和失败重试说明。
- 学生、教师和家长页面覆盖 loading、empty、error、offline、permission-denied。
- 每个任务完成时必须补充对应责任域文档和测试/验证说明。

