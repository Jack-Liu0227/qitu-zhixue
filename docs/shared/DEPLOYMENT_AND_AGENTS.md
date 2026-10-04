# 角色 Agent 与单入口部署

## Pi 子 Agent 角色

项目角色定义位于 `.pi/agents/`（当前 30 个 `.md`），通过 `pi-herdr-agents` 在 Herdr 中加载。
按用途分组：

- **平台/边界角色**：`architect`、`frontend`、`backend-database`、`sdk-manager`、
  `knowledge-base`、`docs-manager`、`code-cleaner`、`contract-owner`、`platform-backend`、
  `release-reviewer`。
- **四端角色**：`student`、`parent`、`teacher`、`admin`。
- **学生端切片**：`student-planner`、`student-feature`、`student-api`、`student-integrator`、
  `student-qa`、`student-reviewer`。
- **Tutor/curriculum 切片**：`tutor-pedagogy`、`tutor-context`、`tutor-escalation`、`tutor-api`、
  `pedagogy-reviewer`、`curriculum-planner`、`mastery-engine`、`question-bank`、
  `grading-remediation`、`plan-api`。

开发期工作流由 `.pi/skills/`（`student-module`、`tutor-engine`）和
`.pi/extensions/student-workflow.ts`（`/student-module`、`/tutor-engine`、`/learning-plan`
斜杠命令）提供。它们是 Pi/Herdr **开发期**制品；Admin 控制面只读取安全摘要用于治理预览，
不把它们当作应用运行时的可执行配置注册表。与 `tutor_partners` / 模型注册表的区别见
`docs/admin/PLATFORM_CONTROL_PLANE.md` §4.1。

`.pi/settings.json` 固定开发期模型与思考档位（**不含任何密钥**）：

- 父会话：`jaycue-gpt/gpt-6.1-sol`；`projectRootResolution = git-root`。
- 子代理默认：`deepseek/deepseek-flash` + `thinking: off`；`modelScope` 严格限于
  `jaycue-gpt/gpt-6.1-sol` 与 `deepseek/deepseek-flash`。
- `agentOverrides`：`frontend`、`backend-database`、`knowledge-base`、`sdk-manager`、
  `architect`、`code-cleaner`、`reviewer`、`oracle` 用 `gpt-6.1-sol` + `thinking: high`；
  `docs-manager`、`worker`、`scout`、`delegate`、`researcher` 用 `deepseek-flash` + `off`。

在项目根目录启动 Pi 后运行：

```text
/reload
/subagent list
/subagent student 实现学生端项目列表，补齐 loading、empty、error、断网和权限失败状态
```

并行修改相同文件时必须使用独立 worktree；只读侦察和审查可使用普通 Agent 窗格。

## 单一公共入口

公网只暴露 Nginx 的 `3000`（生产环境可由 TLS 终止层映射到 `443`）。Nginx 按路径转发到回环地址上的内部服务：

| 公共路径 | 内部服务 | 角色 |
|---|---:|---|
| `/` | `127.0.0.1:3100` | 统一登录 |
| `/student/` | `127.0.0.1:3101` | 学生 |
| `/parent/` | `127.0.0.1:3102` | 家长 |
| `/teacher/` | `127.0.0.1:3103` | 班主任 |
| `/admin/` | `127.0.0.1:3104` | 管理员 |
| `/api/` | `127.0.0.1:4100` | API |

因此用户访问的是同一个域名和同一个公共端口，例如：

```text
http://qtzx.jaycue.tech:3000/
http://qtzx.jaycue.tech:3000/student/
http://qtzx.jaycue.tech:3000/parent/
http://qtzx.jaycue.tech:3000/teacher/
http://qtzx.jaycue.tech:3000/admin/
http://qtzx.jaycue.tech:3000/api/v1/health
```

`tooling/qitu-ports.env.example` 是端口约定，禁止把真实 `.env` 或密码提交到仓库。

## 本地与 study-remote 同步

同步脚本只操作远程主工作树 `/root/team-workspaces/qitu-zhixue`，不会触碰以下角色工作树：

```text
/root/team-workspaces/qitu-zhixue-student
/root/team-workspaces/qitu-zhixue-parent
/root/team-workspaces/qitu-zhixue-teacher
/root/team-workspaces/qitu-zhixue-admin
```

默认要求远程主工作树干净，并会在覆盖前创建远程备份：

```bash
bash tooling/sync-study-remote.sh
```

只有确认远程未提交内容可以被覆盖时才允许：

```bash
ALLOW_REMOTE_DIRTY=1 bash tooling/sync-study-remote.sh
```

同步完成后，在服务器主工作树执行：

```bash
bash tooling/start-qitu-services.sh restart
bash tooling/start-qitu-services.sh status
sudo nginx -t
sudo systemctl reload nginx
```

`status` 会实际请求每个服务的端口，而不是只看 pid：进程存活不等于服务可用，
`services/api` 跑在 `nest start --watch` 下时，编译失败后进程仍在但端口没有监听。
输出 `NOT SERVING (pid ... 存活但 :4100 -> 000)` 就是这种情况，去对应日志找编译错误。
全部可用时退出码为 0，否则为 1，可以直接用在脚本里。

部署脚本和 Nginx 配置都不会自动删除 Git 分支、worktree、依赖或环境文件。远程备份保存于 `/root/team-workspaces/qitu-backups/`。
