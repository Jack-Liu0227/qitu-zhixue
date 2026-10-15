# 部署、端口与开发 Agent

> 单入口部署拓扑、启动 / 同步流程，以及 Pi/Herdr 开发 Agent 约定。
> 相关：[`initialization.md`](./initialization.md)、[`authentication.md`](./authentication.md)。

## 1. 单一公共入口

公网只暴露 Nginx 的 `3000`（生产可由 TLS 终止层映射到 `443`）。Nginx 按路径转发到回环地址上的内部服务：

| 公共路径 | 内部服务 | 角色 |
|---|---:|---|
| `/` | `127.0.0.1:3100` | 官网首页 |
| `/login` | `127.0.0.1:3100` | 统一登录 |
| `/student/` | `127.0.0.1:3101` | 学生 |
| `/parent/` | `127.0.0.1:3102` | 家长 |
| `/teacher/` | `127.0.0.1:3103` | 班主任 |
| `/admin/` | `127.0.0.1:3104` | 管理员 |
| `/api/` | `127.0.0.1:4100` | API |

用户访问同一个域名和公共端口：

```text
http://qtzx.jaycue.tech:3000/
http://qtzx.jaycue.tech:3000/login
http://qtzx.jaycue.tech:3000/student/
http://qtzx.jaycue.tech:3000/parent/
http://qtzx.jaycue.tech:3000/teacher/
http://qtzx.jaycue.tech:3000/admin/
http://qtzx.jaycue.tech:3000/api/v1/health
```

前端调用相对路径 `/api/v1/*`，因此**必须**经统一入口访问，不能直连应用端口。
域名与 IP 回退见 [`authentication.md`](./authentication.md) §4。
官网首页与公开接口见 [`public-site.md`](./public-site.md)。
用 IP 直连做线上验证时注意开发机代理：`curl --noproxy '*' http://122.51.130.204:3000/login`；
经本地 HTTP 代理访问 `qtzx.jaycue.tech:3000` 也可能自行返回 502，不要误判成线上故障。
`tooling/qitu-ports.env.example` 是端口约定；**禁止把真实 `.env` 或密码提交到仓库**。

## 2. 本地开发启动

```bash
# demo 库（见 initialization.md §3）；本地开发默认前端跑 next dev
bash tooling/start-qitu-services.sh start
bash tooling/start-qitu-services.sh status
bash tooling/start-qitu-services.sh clean     # 只回收泄漏进程
bash tooling/start-qitu-services.sh build     # 强制重建 runtime 包 + 前端产物
```

`status` 会实际请求每个服务的端口，而不是只看 pid：

- 进程存活 ≠ 服务可用。`services/api` 跑在 `nest start --watch` 下时，编译失败后进程仍在但端口没有监听。
- 输出 `NOT SERVING (pid ... 存活但 :4100 -> 000)` 就是这种情况，去对应日志找编译错误。
- 全部可用时退出码为 0，否则为 1，可直接在脚本里用。
- `status` 还会报告**无人认领的 `nest start --watch` 进程**（PPID=1，且不属于当前服务 :4100 的进程组）。
  这是旧版 `start_one` 把 `setsid` 的 `$!` 写进 pid 文件造成的泄漏，每组 300–500 MB，堆积后会触发 OOM。
  用 `bash tooling/start-qitu-services.sh clean` 回收；`stop` / `restart` 已自动执行同一清理。

服务归属规则（决定谁来拉起进程，避免同一端口起两份）：

- 只要 `qitu-<name>.service` 存在且 **enabled**，脚本就只调 `systemctl restart`，不自己 `setsid` 起进程。
  判定用 `is-enabled` 而非 `is-active`：单元 `failed`/crash-loop 时 `is-active` 为假，旧版据此在 `:3100`
  又起了一个 `next dev` 与 systemd 抢端口，是 2026-10-13 502 的成因之一。
- 当前 systemd 托管（均为**生产构建 `next start`**）：`qitu-auth`（`:3100`）、`qitu-student`（`:3101`）、
  `qitu-admin`（`:3104`）；单元文件同步保存在 `tooling/qitu-<name>.service`。
  api / workers / parent / teacher 由脚本以独立会话启动（parent / teacher 也按 `QITU_FRONTEND_MODE`
  跑 `next start`），停止时按 `QITU_SVC=<name>` 环境标记回收整棵进程树。
- 生产模式的单元同样**必须先有构建**：`bash tooling/start-qitu-services.sh build`。
  缺 `.next/BUILD_ID` 时单元会 crash-loop（`/` 与 `/login` 直接 502），`status` 会打印该提示。
  不要改用在 `:3100` 跑 `next dev` 来「救活」它（见 [`tooling/auth-production.md`](../../tooling/auth-production.md)）。

Graphiti 相关操作见 `tooling/qitu-graphiti.sh`（默认 `QITU_GRAPHITI_ENABLED` 关闭，
`services/graphiti` 是可重建投影桥，不是聊天记忆）。

## 3. 与 study-remote 同步

同步脚本只操作远程主工作树 `/root/team-workspaces/qitu-zhixue`，不会触碰角色工作树：

```text
/root/team-workspaces/qitu-zhixue-student
/root/team-workspaces/qitu-zhixue-parent
/root/team-workspaces/qitu-zhixue-teacher
/root/team-workspaces/qitu-zhixue-admin
```

默认要求远程主工作树干净，并在覆盖前创建远程备份：

```bash
bash tooling/sync-study-remote.sh
# 仅当确认远程未提交内容可被覆盖时：
ALLOW_REMOTE_DIRTY=1 bash tooling/sync-study-remote.sh
```

同步完成后，在服务器主工作树执行：

```bash
# 先预编译再 restart：restart 内部的构建失败会把服务停在半路上
bash tooling/start-qitu-services.sh build api
bash tooling/start-qitu-services.sh restart
bash tooling/start-qitu-services.sh status
sudo nginx -t
sudo systemctl reload nginx
```

部署脚本与 Nginx 配置**不会**自动删除 Git 分支、worktree、依赖或环境文件。
远程备份保存于 `/root/team-workspaces/qitu-backups/`。

### 3.0 Runtime dependency and bootstrap checks

- `build api` / `build workers` select both transitive workspace graphs with
  `pnpm -r --workspace-concurrency=1 --filter '@qitu/api...' --filter '@qitu/workers...' build`.
  pnpm builds dependencies topologically, including `contracts`, `ai-client` and `infra`;
  a manually maintained package list is not sufficient for runtime exports.
- Root deployments build as `postgres`, the same user that runs API/workers. Existing
  root-owned build outputs must be repaired before rebuilding; do not change source,
  secrets or database ownership to work around a failed build.
- Runtime build failures return nonzero and prevent startup. `restart` builds before
  stopping API/workers so a compilation failure leaves the old runtime running.
- `status api` probes `/api/v1/health/ready`, not just liveness. Deployment acceptance
  also requires `dataMode=live` and a successful database probe; demo/test startup is
  only a local regression check, never evidence of a production deployment.
- `bash tooling/start-qitu-services.test.sh` checks dependency-graph selection and
  failure-before-stop behavior without touching real services. `pnpm --filter @qitu/api test`
  includes a real Nest application bootstrap and HTTP health check, catching erased
  constructor injection tokens that hand-constructed service tests miss.

For IP fallback access, persist `IP-CIDR,122.51.130.204/32,DIRECT,no-resolve` in the
local Clash profile rules/script layer and use rule mode. Do not put a top-level
`rules:` override in a merge layer: that replaces the subscription rules. Reload
the core and verify the active rules and a real DIRECT connection. Personal proxy
configuration and backups stay outside this repository.

### 3.0.1 API recovery verification (2026-10-15, #52)

Recovery code: `590e97d`. The API was compiling successfully under `postgres` but
Nest could not resolve `ProjectAssessmentService` constructor argument 2.
`ArtifactBytesReader` had been imported with `import type`, erasing the runtime
injection token. A value import fixes the real provider graph; no gate, permission
or data-mode checks were bypassed.

Verified against the deployed server at `http://122.51.130.204/`:

- API tests: **702 passed, 0 failed** on both Windows and the Linux server,
  including a real Nest application bootstrap. API typecheck/build, ai-client
  assertions, API lint, basePath checks and nine deployment-script cases pass.
- Production runtime graph builds serially as `postgres`; API listens on `4100`.
  All five frontend probes return `200`, and `nginx -t` succeeds.
- Playwright visible-browser checks use the site's own test-account buttons and
  real authentication APIs: student, parent, teacher and admin logins succeed;
  `/student/today`, `/student/tutor`, `/parent`, `/teacher/dashboard`, `/admin`
  and `/admin/settings/teams` load without browser exceptions or HTTP 5xx.
- Anonymous API access returns `401`; a student reading admin overview receives
  `403`. The existing shared AuthGuard redirects an unauthenticated tutor visit to
  the public homepage `/` (not `/login`) without showing the protected composer.
- Student tutor is checked at 390px width without horizontal overflow, and offline
  mode disables submission while retaining the draft.
- The database contains 24 applied migration records and all three PBL tables:
  `pbl_gate_evidence`, `work_assessment_candidates`, `work_validation_checks`.
  No schema/data migration is performed by this recovery patch.
- Local Clash core runs in rule mode with 9,142 de-duplicated rules restored from
  the 9,263-entry subscription; a live connection to the server matches the
  `122.51.130.204/32` IPCIDR rule with chain `DIRECT`. Its persistent script and
  configuration backups are outside Git.

Limits: readiness remains **degraded** because `REDIS_URL` is absent and no local
Redis listener is present. The live database probe passes; this does not establish
Redis-backed queue/lock/cache availability. These checks do not certify a full AI
conversation, automatic PBL acceptance, object-storage reads, isolated student-code
execution or video-content analysis. Do not label this as complete four-phase PBL
automation or a fully healthy infrastructure rollout.

## 3.1 线上 502 排查顺序

公网只有 Nginx `:3000`，502 一律是**上游没监听**，按这个顺序判：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 入口
tail -n 20 /var/log/nginx/error.log     # connect() failed (111) 指向哪个 upstream
bash tooling/start-qitu-services.sh status
free -m; swapon --show                  # 内存 / swap 是否打满
dmesg -T | grep -iE 'oom-kill|Out of memory' | tail
ps -eo pid,ppid,rss,args --sort=-rss | grep -E 'nest.js start|next-server' | head
```

2026-10-13 事故的因果链，留作对照：

1. 每次 `start` 泄漏一组 `nest --watch`（堆积 13 个，≈3.9 GB），7.6 GB 内存 + 2 GB swap 全部耗尽；
2. OOM killer 逐个杀 `next-server`，并打掉 `systemd --user`，`qitu-auth` / `qitu-student` 进入 `failed`；
3. `:3100` 无监听 → Nginx 对 `/`、`/login` 返回 502；`qitu-auth` 单元本身还缺生产构建，处于 crash-loop。

恢复顺序：`systemctl reset-failed` → 回收泄漏进程腾出内存 → 补 auth 生产构建 → `systemctl restart` 相关单元 →
`start-qitu-services.sh status` 全绿。判定只看**端口返回码**，不看 pid。

**内存预算**（实测，单个监听进程常驻内存）：`next dev` ≈450 MB，生产 `next start` ≈190 MB。
该机器只有 7.6 GB，四个 dev server 光监听就占 ≈1.8 GB，加 `nest --watch`（≈500 MB）、workers、
PostgreSQL 很容易贴上限。服务器上一律用生产构建（见 §3.2），`status` 会打印当前模式；
报泄漏或 `available` 低于 1 GB 时先 `clean`，不要叠服务。

### 3.2 前端跑生产构建（降内存）

服务器上的 `tooling/qitu-ports.env`（不入库）里设：

```ini
QITU_FRONTEND_MODE=production
QITU_NODE_MAX_OLD_SPACE_MB=1024
```

切换顺序——**先停再建**，绝不能往正在跑的进程正在用的 `.next` 里写：

```bash
bash tooling/start-qitu-services.sh stop
bash tooling/start-qitu-services.sh build      # 串行构建，峰值内存不叠加
bash tooling/start-qitu-services.sh start
bash tooling/start-qitu-services.sh status
```

按应用切（`stop` / `start` / `restart` / `status` / `build` 都接受服务名）：只有
该栏目短暂不可用，其余四个不受影响——服务器上建生产产物时推荐走这个方式：

```bash
for name in admin teacher parent student; do
  bash tooling/start-qitu-services.sh stop  "$name" || true
  bash tooling/start-qitu-services.sh build "$name"
  bash tooling/start-qitu-services.sh start "$name"
done
bash tooling/start-qitu-services.sh status
```

要点：

- 构建串行执行（并行 `next build` 峰值会超过本机余量）；`start` / `restart` 只在产物缺失或
  源码比 `.next/BUILD_ID` 新时才重建，改代码后请显式跑 `build`。
- `next start` 没有 HMR；开发调试用 `QITU_FRONTEND_MODE=dev`（仓库默认）。
- 端口、basePath、nginx 配置均不变；应用内 `/api/:path*` rewrites 仍指向 `QITU_API_ORIGIN`
  （默认 `127.0.0.1:4100`）。
- services/api 故意保留 `nest start --watch`（远程主工作树在活跃开发）——它仍是最大的单一占用；
  要再降可把 ExecStart 换成 `node dist/main`，代价是失去热重载。

## 4. Pi/Herdr 开发 Agent（非运行时）

开发期角色定义位于 `.pi/agents/`（约 30 个 `.md`），通过 `pi-herdr-agents` 加载。
按用途分组：

- **平台 / 边界角色**：`architect`、`frontend`、`backend-database`、`sdk-manager`、`knowledge-base`、`docs-manager`、`code-cleaner`、`contract-owner`、`platform-backend`、`release-reviewer`。
- **四端角色**：`student`、`parent`、`teacher`、`admin`。
- **学生端切片**：`student-planner`、`student-feature`、`student-api`、`student-integrator`、`student-qa`、`student-reviewer`。
- **Tutor/curriculum 切片**：`tutor-pedagogy`、`tutor-context`、`tutor-escalation`、`tutor-api`、`pedagogy-reviewer`、`curriculum-planner`、`mastery-engine`、`question-bank`、`grading-remediation`、`plan-api`。

开发期工作流由 `.pi/skills/`（`student-module`、`tutor-engine`）与
`.pi/extensions/student-workflow.ts`（`/student-module`、`/tutor-engine`、`/learning-plan`）提供。
它们是 Pi/Herdr **开发期**制品；Admin 控制面只读取安全摘要用于治理预览，
**不把它们当作应用运行时的可执行配置注册表**（见 [`control-plane.md`](./control-plane.md) §5.1）。

`.pi/settings.json` 固定开发期模型与思考档位（**不含任何密钥**）：

- 父会话：`jaycue-gpt/gpt-6.1-sol`；`projectRootResolution = git-root`。
- 子代理默认：`deepseek/deepseek-flash` + `thinking: off`；`modelScope` 限于 `jaycue-gpt/gpt-6.1-sol` 与 `deepseek/deepseek-flash`。
- `agentOverrides`：`frontend`、`backend-database`、`knowledge-base`、`sdk-manager`、`architect`、`code-cleaner`、`reviewer`、`oracle` 用 `gpt-6.1-sol` + `high`；`docs-manager`、`worker`、`scout`、`delegate`、`researcher` 用 `deepseek-flash` + `off`。

在项目根目录启动 Pi 后：

```text
/reload
/subagent list
/subagent student 实现学生端项目列表，补齐 loading、empty、error、断网和权限失败状态
```

**并行修改相同文件时必须使用独立 worktree**；只读侦察和审查可使用普通 Agent 窗格。

## 5. 相关文档

- [`initialization.md`](./initialization.md)
- [`authentication.md`](./authentication.md)
- [`public-site.md`](./public-site.md)
- [`control-plane.md`](./control-plane.md)
