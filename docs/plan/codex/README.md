# 自适应 PBL 调研与实施包

> 状态：`proposal`。这组文档是基于现有仓库和上游项目核查形成的架构建议，不替代已评审的产品合同，也不表示功能已经实现。

## 文档

- [调研报告](./research-report.md)：Grok Search 检索记录、上游项目核查、可迁移模式和证据边界。
- [架构方案](./architecture.md)：项目—模板—团队绑定、计划生成、回答驱动调整及权限/持久化边界。
- [实施计划](./implementation-plan.md)：分阶段工作项、依赖、验收标准、试点与回滚门槛。

## 适用范围

本方案优先复用 `projects`、`learning-plan`、`mastery`、`ai-tutor` 和 `team-runtime` 的既有 owner、契约与持久化能力；不新增学生端一级导航，不替换现有 PBL 状态机，也不把上游开源项目的产品声明当作学习效果证据。
