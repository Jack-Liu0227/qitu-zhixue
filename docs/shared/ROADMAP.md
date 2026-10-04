# 启途智学工程路线图

## M0 工程基础

- Monorepo 目录和包边界
- 四个前端应用壳层
- 共享 design tokens 和 UI 基础
- API contracts 初稿
- CI 与本地开发说明
- ER 初稿

## M1 认证和关系

- 登录、邀请和会话
- 家庭档案
- 家长—孩子绑定
- 学生账户
- 班主任分配
- RBAC 和审计

## M2 项目模板和灵感空间

- 项目模板版本
- 推荐项目
- 灵感空间自由探索（统一进入 AI搭档）
- 意图确认
- 统一项目实例

## M3 项目引擎和学生端

- 项目列表和详情
- 理论学习与检查
- 实践任务
- 作品上传和展厅

## M4 AI搭档文本版

- context_packet
- 苏格拉底式提问
- 提示等级
- 知识检索
- 卡顿检测与班主任升级

## M5 Live 语音

- ASR、TTS
- SSE/WebSocket
- 重连和文字降级
- 幂等命令

## M6 家长陪伴中心

- 首页指标
- 学习进展
- 成长记录
- 作品成果
- 消息与反馈

## M7 班主任工作台

- 工作台统计
- 学生全周期档案
- 问题处理
- Inject Prompt
- 知识库

## M8 管理后台和发布

- 用户与关系管理
- 模板发布和回滚
- AI 策略与模型路由
- 审计、监控和备份

## 掌握度时间线专项路线（ADR 0009）

掌握度时间线是 M3 项目引擎和 M6 成长轨迹之间的共享领域能力。它不改变既有导航，
先建设服务端事件和授权投影，再接学生、家长、教师的成长轨迹展示。

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| M0 | 掌握度事件合同、KnowledgePoint、算法版本、幂等和事务修复 | 答题/证据/门槛事件与 audit/outbox 同事务 |
| M1 | PostgreSQL `mastery_events`、当前投影、快照和时间线 API | 当前值、90 天曲线、`asOf` 快照、退步和跨项目聚合可重放 |
| M2 | 统一 quiz / qualitative / practice / correction 评估流水线 | 乱序、并发、重试、补录、撤销测试通过 |
| M3 | 成长轨迹主路径和 `project.checkThreshold()` 收敛 | `TheoryMastered` 前实践不可达，权限投影完整 |
| M4 | Graphiti bridge、Worker、receipt、租约/重试、影子投影、对账和全量重建 | scaffold 已完成；外部 Graphiti round-trip、成本和恢复达标后才可灰度 |
| M5 | 仅对非阻塞时间线查询做灰度 | Graphiti 故障可回退，绝不影响项目门槛 |

Graphiti 不直接决定 `TheoryMastered`、项目状态、权限或审计结论。详细数据模型和验收
指标见 [`decisions/0009-mastery-timeline-and-graphiti.md`](../decisions/0009-mastery-timeline-and-graphiti.md)。

## 首个迭代建议

先完成 M0 中的仓库、CI、Monorepo 边界和 API 合同，再进入 M1。不要四个平台同时铺开页面；优先打通一条最小闭环：

```text
家长邀请学生 → 学生登录 → 选择项目 → 创建项目实例 → 完成一个理论任务 → 家长看到成长快照
```
