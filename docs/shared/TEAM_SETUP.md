# 启途智学三人协作设置

## 推荐角色分工

### 成员 A：平台与后端

- identity-auth、households、guardian-links
- mentor-assignments、projects、tasks
- PostgreSQL、迁移、审计和 API 合同
- CI、部署和运行环境

### 成员 B：学生端与 AI 学习链路

- student-center
- inspiration、explorations、ai-tutor
- voice-live、项目阶段交互
- 学生端与 AI 服务的联调

### 成员 C：家长、班主任和管理端

- parent-companion
- teacher-workspace
- admin-console
- 家长授权视图、问题处理、统计和后台治理

共享 UI、design tokens 和 contracts 必须通过 PR 协同，不能由多个分支同时随意重写。

## GitHub 权限

- 仓库使用 Private。
- 三人加入同一个开发团队。
- 成员使用自己的 GitHub 账号和 SSH Key。
- `main` 禁止直接 push。
- PR 至少需要 1 名其他成员批准。
- 高风险模块（权限、数据库、审计、未成年人数据）需要额外 review。

## 远程目录

如果三人都在同一台服务器开发，不要共享同一个工作树。每个人使用独立目录或独立 Linux 账号；至少保证不同 clone/worktree 不互相切换分支。

```text
/root/team-workspaces/qitu-zhixue/<member>/
```

## 当前未决事项

- [ ] 三个 GitHub 用户名
- [ ] 后端选择 NestJS 或 FastAPI
- [ ] 前端包管理器和 Monorepo 工具
- [ ] CI 必须通过的检查命令
- [ ] 开发、测试和生产环境边界
