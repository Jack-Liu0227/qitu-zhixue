# 部署、端口与开发 Agent

> 单入口部署拓扑、启动 / 同步流程，以及 Pi/Herdr 开发 Agent 约定。
> 相关：[`initialization.md`](./initialization.md)、[`authentication.md`](./authentication.md)。

## 1. 单一公共入口

当前公网入口是 `http://122.51.130.204/`（Nginx `80`），同时保留历史 `3000` 入口；本轮不配置 TLS。Nginx 按路径转发到回环地址上的内部服务：

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
- 当前五个前端均由 systemd 托管并运行**生产构建 `next start`**：`qitu-auth`（`:3100`）、
  `qitu-student`（`:3101`）、`qitu-parent`（`:3102`）、`qitu-teacher`（`:3103`）、`qitu-admin`（`:3104`）。
  2026-10-17 的隔离发布使用服务 drop-in 指向独立目录，详见 §3.4；不能仅从仓库中的单元模板推断实际运行目录。
  API / workers 的最新归属及 2026-10-19 发布见 §3.5；API 当前运行编译产物，不是 watch，独立 workers 维持停用。
- 生产模式的单元同样**必须先有构建**：`bash tooling/start-qitu-services.sh build`。
  缺 `.next/BUILD_ID` 时单元会 crash-loop（`/` 与 `/login` 直接 502），`status` 会打印该提示。
  不要改用在 `:3100` 跑 `next dev` 来「救活」它（见 [`tooling/auth-production.md`](../../tooling/auth-production.md)）。

Graphiti 相关操作见 `tooling/qitu-graphiti.sh`（默认 `QITU_GRAPHITI_ENABLED` 关闭，
`services/graphiti` 是可重建投影桥，不是聊天记忆）。

## 3. 与 study-remote 同步

同步脚本只操作远程主工作树 `/root/qitu-zhixue`，不会触碰角色工作树：

```text
/root/qitu-zhixue-student
/root/qitu-zhixue-parent
/root/qitu-zhixue-teacher
/root/qitu-zhixue-admin
```

默认要求远程主工作树干净，并在覆盖前创建远程备份：

```bash
bash tooling/sync-study-remote.sh
# 仅当确认远程未提交内容可被覆盖时：
ALLOW_REMOTE_DIRTY=1 bash tooling/sync-study-remote.sh
```

以下为历史开发启动流程。**当前正式发布采用 §3.5 的隔离构建与逐服务切换，不使用全局 `stop/clean/restart`**；全局清理可能影响其他工作树的 worker。不要在正在服务的 `.next` 上原地构建。

历史同步完成后，在服务器主工作树执行：

```bash
# 先预编译再 restart：restart 内部的构建失败会把服务停在半路上
bash tooling/start-qitu-services.sh build api
bash tooling/start-qitu-services.sh restart
bash tooling/start-qitu-services.sh status
sudo nginx -t
sudo systemctl reload nginx
```

部署脚本与 Nginx 配置**不会**自动删除 Git 分支、worktree、依赖或环境文件。
远程备份保存于 `/root/qitu-backups/`。

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
- 上述 watch 归属是早期开发状态。2026-10-19 实际 API 已由专属 launcher 运行 `node services/api/dist/main.js`，当前正式归属以 §3.5 和 systemd 回读为准。

### 3.3 页面 200 但 CSS/JS 丢失

2026-10-15 家长端进程仍持有 10 月 13 日的资源清单，而 `.next` 已被重新构建，
HTML 引用的旧 CSS 返回 400，导致导航和卡片退化成无样式文字。只检查 `/parent` 返回 200
无法发现此类故障。仅重启家长端加载当前构建后恢复，未修改 UI、认证、API 或数据。

部署时必须先停止对应应用再原地构建，或在独立发布目录构建并切换运行目录；
不要覆盖运行中进程的 `.next`。重建后必须启动新进程，并检查页面实际引用的静态资源：

```bash
# 仅重启已有构建：加载磁盘上当前的资源清单。
bash tooling/start-qitu-services.sh restart parent
python3 tooling/check-frontend-assets.py --base-url http://127.0.0.1
# 再检查统一公网入口；默认检查家长首页、登录、进展和消息四页。
python3 tooling/check-frontend-assets.py --base-url http://122.51.130.204
# 其他前端可显式传入路由（支持重复参数）。
python3 tooling/check-frontend-assets.py --route /login --route /student/today
```

检查器要求页面返回 200 HTML，所有引用的 CSS/JS 返回 200、内容非空、MIME 类型正确，
且不发生登录重定向；失败时以非零退出。无需账号，不输出 cookie 或个人数据。
此检查覆盖资源交付，不能替代授权后浏览器验收和 API 测试。

回归检查：`python3 tooling/check-frontend-assets.test.py`，覆盖正常资源、CSS 返回 400/404，
以及 HTTP 200 却返回 HTML 的错误资源。

### 3.4 五端品牌发布与隔离构建（2026-10-17，#56）

> 本节是 10 月 17 日历史记录，不是当前回滚指令。最新服务归属与不可变旧产物回滚见 §3.5；服务器 main 已推进，不能直接把运行目录指回 main 充当旧版本。

- 前端代码提交 `04be640`；服务器 Git 主工作树仍为 `/root/qitu-zhixue`。
- 使用 `git archive` 将该提交导出到 `/root/qitu-releases/04be640`，以冻结锁文件离线安装依赖，
  串行执行 `pnpm build --concurrency=1`。没有覆盖任何正在使用的 `.next`。
- 五个 `qitu-<name>.service` 的 `zz-brand-story-release.conf` drop-in 设置该发布目录、
  `NODE_ENV=production`、`QITU_API_ORIGIN=http://127.0.0.1:4100` 和各自回环端口。
  修正家长端单元指向旧 worktree 的问题，补齐教师端 systemd 单元，并逐端切换。
- 原构建仍保留在主工作树，切换前服务配置在 `/root/qitu-releases/before-04be640/units/`，
  Git 备份分支为 `backup/brand-story-before-20261017`。API 进程与数据库保持不变。

**后续发布：**先以 `systemctl show qitu-<name> -p WorkingDirectory -p ExecStart` 查看真实归属。
在新独立目录构建完整产物，检查五个 `.next/BUILD_ID` 后更新对应 drop-in、`daemon-reload`、
逐端重启并检查静态资源。单独在主工作树执行 `build` 不会更新当前 release；单独 `restart` 也不会部署新代码。

**回滚：**先确认主工作树旧 `.next/BUILD_ID` 与资源完整，再为需要回滚的服务修改品牌 drop-in，
将 WorkingDirectory 指回主工作树，保留显式 `next start --hostname 127.0.0.1 --port <端口>`。
执行 `systemctl daemon-reload` 后逐端重启和验证。不要简单恢复旧家长单元或删除教师单元：
旧配置存在错误目录/手工进程归属问题。不要回滚 API、数据库或其他 worktree。

验收：本机与 Linux 生产构建通过；lint、typecheck、测试通过（API 724 项）；Playwright 使用网站自带演示账号，
首页和四端在 1440、320、375、414、768px 下加载，无页面异常和非 API 静态资源失败、无页面横向溢出。
此前六幕版本的六张 WebP 和 MP4 已通过线上 SHA256/Range 验收；本次中学生案例扩展改为九张 WebP，发布前需按同一规则重新核对九张图片与新 MP4。
视频暂停、章节选择、离屏暂停、离线、节流模式主动播放、系统/产品减弱动态、故障重试通过。
真实后台标签页切换未在此次可见窗口环境中稳定复现，不将该项列为通过证据。

### 3.5 三线接管集成发布（2026-10-19）

- 发布产物：`8413ef811e19cf0e1c029fc05150325b39076111`，目录 `/root/qitu-releases/8413ef811e19cf0e1c029fc05150325b39076111`。2026-10-19 06:22:27（Asia/Shanghai）完成切换。
- 经用户授权，代码已推送 GitHub main；服务器先接收非当前 release ref，在隔离构建与验收通过后才快进 main。后续文档回填提交不改变生产产物 SHA。
- Node 22.22.1、pnpm 10.10.0；以 postgres 安装冻结锁文件，按依赖图构建 API/workers，运行 Linux API 测试 947/947，然后串行构建五个前端。没有覆盖旧进程的 `.next`，构建后 1,490 个 Git blob 与提交匹配。
- 六个正式单元 `qitu-api/auth/student/parent/teacher/admin.service` 均 active，通过各自 `zzzzzz-release.conf` 指向该 release，保持原端口和 Nginx。API 以 postgres 执行编译产物，专属 launcher 仅变更 `NODE_PATH`，保留既存受限配置、知识 Python/vendor/data 路径。实际 Node cwd 和依赖解析均在此 release。
- readiness 为 live、database/redis 均 ok；本机 Nginx 和公网各 12 条路由及 CSS/JS 通过，五端助手图标与源图 SHA256 一致。匿名保护接口 401；首页/登录三个尺寸和四端匿名重定向的可见浏览器检查通过，没有 pageerror、HTTP 5xx 或写请求。
- 未执行数据库迁移、教学造数或门禁注入。独立 worker 未运行，只编译、不新增消费者；另 7 个 eyeprotect/IMA/embedding 相关单元 MainPID/状态未变化。未使用全局启动脚本的 stop/clean/restart。

**回滚**：旧版本 `8e8f9b4` 的源码、依赖、五端 `.next` 和 API/worker dist 已保存为独立产物；原单元配置在 `.release-unit-backup/`。旧依赖已验证在 rollback 目录内解析。服务器 main 已同步，不可仅删除新 drop-in 回主树；使用专属脚本切回旧产物：

```bash
bash /root/qitu-releases/rollback-before-8413ef811e19cf0e1c029fc05150325b39076111/activate-rollback.sh
```

脚本已通过 Bash 语法检查，未在成功发布后执行人为回滚演练。它只操作上述六个单元，不改 Git 历史、数据库或其他工作树。

API Linux 测试日志、运行复核和受限审计脚本分别位于 release 的 `.release-api-test.log`、`.release-live-verification.json`、`.release-audit/`。完整结果和验证限制见 [接管修复与发布记录](../plan/codex/takeover-validation-20261019.md)。本轮没有真实模型/IMA 请求或登录后完整 16 课时验收，不能据此宣布全动态 PBL 完成；HTTP 冒烟也不是 TLS/生产隐私安全认证。

### 3.6 主站 main 统一发布与管家目录修复（2026-10-19 晚间）

生产代码为 `63e3be882f1b1d7ccfbc0122bc14bf0b354785e3`，21:39:47 +08:00 完成六个正式单元的统一切换。0036 迁移已应用，服务器两处 preferences 独立修改保留。完整构建、备份、健康、管家删除回归、未发布技能配置风险和回滚入口见 [本次发布记录](./release-20261019-main.md)。本节取代 §3.5 作为当前运行版本记录，不表示完整 PBL 能力验收。

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

### Redis（study-remote，2026-10-15）

- 使用系统 `redis-server.service`，开机启用，仅监听 `127.0.0.1` / `::1`，不开放公网 6379。
- 启用 `protected-mode` 和随机服务密码；凭据仅留在服务器受限配置，绝不提交。应用从权限为 600 的 `tooling/qitu-ports.env` 读取 `REDIS_URL`，API / worker 必须重启才能读取新环境。
- AOF 开启，`appendfsync everysec`；上限 256 MiB，`maxmemory-policy noeviction`，避免驱逐队列或锁制造假互斥。内存满会显式失败，应告警扩容，不能把这个上限当作永久容量承诺。
- 验收同时检查 `/api/v1/health/ready` 中 database / redis 均为 `ok`，以及真实 `@qitu/infra` 缓存 TTL、锁排他与 token-safe release、队列 reserve / ack；只收到 PONG 不代表业务接线完成。
- AOF 约每秒刷盘，异常断电仍存在约一秒丢失窗口；单机 Redis 不是高可用，需独立监控和备份策略。保留 PostgreSQL outbox 作为事件事实源。

- [`initialization.md`](./initialization.md)
- [`authentication.md`](./authentication.md)
- [`public-site.md`](./public-site.md)
- [`control-plane.md`](./control-plane.md)
