# Contributing to 启途智学

## 分支策略

采用轻量 trunk-based workflow：

- `main`：稳定分支，禁止直接 push
- `feature/<issue>-<short-name>`：新功能
- `fix/<issue>-<short-name>`：缺陷修复
- `refactor/<issue>-<short-name>`：重构
- `docs/<issue>-<short-name>`：文档

示例：

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/12-student-project-list
```

## 提交规范

使用 Conventional Commits：

```text
feat: add student project list
fix: prevent duplicate artifact submission
docs: update API contract
refactor: extract project state machine
test: cover guardian authorization
chore: update tooling
```

## Pull Request 规则

PR 必须包含：

- 关联 Issue
- 变更摘要
- 影响的应用/服务/数据库模块
- 验证命令和结果
- 权限、隐私、未成年人数据影响
- 数据库迁移或回滚说明（如适用）
- UI 变更截图或录屏（如适用）

合并要求：

- 至少 1 名团队成员审核
- CI 通过
- 无未解决的 review comment
- 使用 Squash merge

## 任务拆分

一个 Issue 尽量控制在 0.5–2 个开发日内完成，并且有明确验收标准。跨前后端任务应拆成可以独立评审的合同、后端、前端和测试子任务。

## 代码安全

不要在提交、日志、截图或 Issue 中放置密码、Token、API Key、SSH 私钥或未脱敏的学生数据。
