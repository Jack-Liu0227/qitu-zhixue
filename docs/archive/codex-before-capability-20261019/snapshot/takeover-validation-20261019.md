# 2026-10-19 三线接管修复与验证

> 修复基线为 `8e8f9b4e2824c62e879ab032d2a40ec8c3454691` 加本轮工作区修改；发布产物为 `8413ef811e19cf0e1c029fc05150325b39076111`，实际部署见第 5 节。后续文档提交不改变产物 SHA。
> 架构与待实施范围以 [最新实施计划](./implementation-plan.md) 和 [实时生成总架构](./architecture.md) 为准。本记录不把安全回退、模型协议测试或实验预览当作完整动态 PBL 验收。

## 1. 接管来源与边界

从本机 Antigravity 会话索引及记录读取本项目最近三个对话，按以下责任域分配三个子 agent。

| 对话 ID | 原主题 | 接管责任域 |
| --- | --- | --- |
| `edf0f1cb-261e-4daa-a1ed-d2444d71bfc6` | AGENT.md File Splitting Rules | 文档归档、失效链接、同步核查 |
| `a0c1539b-e90d-4083-8533-9abe1f8f0319` | Grok Search MCP Project-Based Learning Research and Architecture Design | 光学 PBL、冻结绑定、Tutor 展示 |
| `7533ecfc-1063-4448-bc0c-3acf7eb064e2` | PBL System Analysis And Testing | 模型配置入口与统一 Runtime |

开始时 HEAD 为 `f88bb73`。其他会话推进到 `8e8f9b4` 后曾暂停，用户确认后继续。后续 Admin、家长、教师、认证入口和共享 UI 等并行变更也经用户确认，均予保留，不列作本轮接管成果。用户并行更新的 `docs/plan/codex` 架构与实施计划同样保留。

首轮修复与本地验证阶段没有 commit、push、部署、服务重启或生产数据写入，没有删除线上模板或团队。后续用户授权的发布单独记录于第 5 节。没有导出或记录凭据、原始学生对话，也没有注入 mastery 或 `TheoryMastered` 制造成功路径。

## 2. 已完成的修复

### 文档与归档

- 修复当前文档与归档索引中的失效相对链接、行号目标和漏索引项，移除没有可复核来源的效果数字。
- 更正实验预览、证据保存、课时检查点和掌握门禁的完成状态，避免把原型写成已接通的正式协议。
- 新增 `tooling/validate-docs.py` 和回归测试。检查当前 Markdown、归档索引及本地文件链接，不校验历史正文、远程 URL 或锚点。
- SSH 只读检查时，远端为 `main@8e8f9b4`，工作树干净；35 个历史归档文件已同步，旧截图数量为 0。nginx、PostgreSQL、Redis 与应用监听状态正常。这不证明本轮未提交源码已经上线。

### 光学 PBL 与 Tutor

- 正式 Tutor 路径只读取有效冻结快照，核对项目、模板版本与 hash。缺失快照或团队不可用时明确拒绝，不在读取时静默采用当前 active 团队。
- 首轮引导使用实际项目、团队和阶段，去除标题、UUID 前缀与固定 16 节推断。当前开场仍是短静态安全回退，尚非真实模型生成。
- 移除按模板 ID 前缀自动注入正式实验卡及虚构课时授权。旧实验卡不再提供伪装成正式证据保存的操作。
- 修复 Markdown、KaTeX、Mermaid 和 Board 渲染。浏览器复现的 CRLF hydration 不一致已通过统一换行修复，并增加回归测试。
- 使用实际 Mermaid 依赖和严格安全模式，限制图规模并串行渲染。数学渲染关闭 KaTeX trust，限制展开与尺寸，失败时保留安全文本。
- 散射与衍射预览明确标注为模型计算，不标为实测或已保存证据。Rayleigh 比例只在支持域计算，域外不套用，单色散射不自动变成白光。
- 学生测试使用锁文件已有的 `tsx` 执行 workspace TypeScript 依赖，未添加环境专用业务分支。

### 模型入口与 Runtime

- Gateway 统一进入 Model Runtime，清理未使用的并行 `ModelConfigService` 和旧配置写入口，保留受认证的运行时投影。
- 保留安全 HTTP 状态及重试语义，区分主动取消与超时。修复 Anthropic base URL 含 `/v1` 时重复拼接路径的问题。
- Admin 选择始终保留 `(modelProviderId, modelId)` 联合身份。目录失败时清除陈旧候选、阻止保存，不回退到浏览器缓存模型目录。
- 用途路由按服务端真实回读反馈结果。对话配置不再使用浏览器密钥、直连供应商或虚假生成回退；本地脚本预览明确不是服务端推理验证。
- 模型核查脚本只读配置、要求显式环境凭据，不输出登录正文，也不把配置可读当作真实模型请求成功。
- 集成尾修将助手卡片内部模型 pair 改为可读标签，修正 Admin 链接 basePath、单模型目录的空绑定选择和失败后残留旧成功提示；用途目录随供应商更新，并继续执行请求身份与回读校验。

根 agent 另行修复 Windows 知识链接探测：使用平台路径分隔符，按 realpath 校验根目录和 manifest 包含关系，拒绝 junction/symlink 逃逸与非法 manifest，并补充测试。

## 3. 可复核验证结果

UNC 根目录的 `node_modules/@qitu/*` 存在复制快照，不能据此证明正在测试当前源码。本轮创建无秘密的本地磁盘验证副本，按冻结锁文件安装，并按真实依赖顺序构建。解析结果确认六个 API workspace 依赖均来自副本的 `packages/*/dist`，最终 API 测试不使用 Runtime 重定向 loader。

本机验证目录为 `C:\Users\HK\AppData\Local\Temp\qitu-frontend-verify-5dc619ca`。目录包含实际 `AGENTS.md` 和教学 skill，不复制 `.env` 或认证文件。

| 检查 | 最终结果 | 证据边界 |
| --- | --- | --- |
| API 六个依赖包构建与 TypeScript 编译 | 通过 | 当前源码依赖图，不是 UNC 快照 |
| API 全部编译测试 | 947/947 通过，75 suites，0 失败/取消 | 在 `services/api` 工作目录运行；不等于真实数据库或线上模型验收 |
| Student typecheck | 通过 | 类型约束 |
| Student tests | 23 单元测试与 5 live-boundary 测试全部通过 | 不等于登录后完整 PBL 流程 |
| Student optimized build | 通过 | Next 页面构建 |
| Admin typecheck 与 optimized build | 通过 | 包含当时保留的并行 UI 修改，不证明所有业务交互 |
| 并行教师端修改的补充验证 | typecheck 与 basePath guard 通过 | guard 检查 4 个文件，不是完整页面交互验收 |
| 并行共享助手图标测试 | 5/5 通过 | 最新脚本按消费应用解析依赖，直接执行，不需要 `NODE_PATH` |
| Model Runtime 与 Admin 联合身份测试 | 34/34 通过 | 31 个 Runtime 测试、3 个模型选择/标签测试；供应商为受控协议 fixture |
| 真实浏览器 renderer 检查 | 通过 | 实际组件的独立测试页，不是受保护 Tutor 网站验收 |
| 文档 validator 回归测试 | 11/11 通过 | 链接解析、归档覆盖等测试 |
| 当前文档与归档索引链接检查 | 65 份文档、283 个本地链接，0 问题 | 不包含历史正文、远程 URL 或锚点 |
| `git diff --check` | 通过 | LF/CRLF 提示不计作空白错误 |

核心复现命令在本地验证副本根目录执行，API 测试单独切换工作目录。

```powershell
pnpm --filter '@qitu/api...' --filter '@qitu/student-center...' --filter '@qitu/admin-console...' install --frozen-lockfile --ignore-scripts
pnpm -r --workspace-concurrency=1 --filter '@qitu/api^...' build
pnpm --filter @qitu/api exec tsc -p tsconfig.json --outDir .tmp/test-dist
Push-Location services/api
node --test --test-concurrency=4 --test-reporter=tap '.tmp/test-dist/**/*.test.js'
Pop-Location
pnpm --filter @qitu/student-center typecheck
pnpm --filter @qitu/student-center test
pnpm --filter @qitu/student-center build
pnpm --filter @qitu/admin-console typecheck
pnpm --filter @qitu/admin-console build
node --test 'packages/model-runtime/dist/**/*.test.js' tooling/admin-model-selection.test.mjs
python tooling/validate-docs.test.py
python tooling/validate-docs.py
git diff --check
```

API 最终日志保留在本机临时目录的 `qitu-takeover-api-clean-test.log`。浏览器测试验证三个 KaTeX 表达式、两个 Mermaid SVG、非法图回退及恢复、HTML 转义和 375px 窄屏无页面溢出，最终没有浏览器运行时错误。截图为同目录下 `qitu-renderers-desktop.png` 与 `qitu-renderers-mobile.png`，不是学生数据截图。

此前失败记录不删除，但不作为最终状态：UNC 根工作目录运行曾出现源码路径检查失败、开场 fixture 走演示分支和超时；第一次本地副本遗漏 `AGENTS.md` 与教学 skill，导致三个注册检查失败。修正工作目录、持久化 fixture 和副本内容后，最终 947 项全部通过。开场持久化测试仍使用内存 store fixture，不是真实数据库重启测试。

Next 提示本机多个锁文件导致 tracing root 推断警告。未修改用户其他目录的锁文件，构建仍通过。

最后核对发现副本尚未包含六处已获确认的并行 UI 修改，分别位于学生端 `app/layout.tsx`、`TutorPage.tsx`、`Composer.tsx`、`styles/compact-layout.css`，以及教师端 `students/page.tsx`、`globals.css`。仅刷新验证副本后，重新通过学生端 typecheck、28 项测试与 build；另按冻结锁文件补齐教师端依赖，通过教师端 typecheck 与 test。未覆盖家长端、认证入口的完整业务交互。

共享图标测试首次从根目录运行因无法解析 `react` 失败，曾仅在验证进程中设置 `NODE_PATH`。之后用户并行修改脚本，显式按学生应用解析其声明的依赖；本轮已直接从根目录执行，5 项通过，不再依赖该环境变量。

### 3.1 用户确认并行修改后的最终集成验证

再次按文件内容冻结验证副本，补齐五个前端及 API/worker 依赖，并按依赖图构建。API 在正确工作目录重新运行，仍为 947/947，0 失败/取消；最终日志为本机临时目录的 `qitu-takeover-api-final-test.log`。学生端 28 项测试通过，五个前端 typecheck、production build 和共享 UI typecheck 均通过。独立 worker 仅编译，不启动消费者。

- 共享 UI 的品牌测试 4 项、减弱动效检查 11 项、图标测试 5 项通过；教师端 4 文件 basePath guard 通过。
- 可见 Chromium 在本地学生端生产构建和合成 fixture 上检查 375×667、768×844、1440×960：输入区保持可见，消息区可独立滚动，长公式有实际可操作的内部横向滚动，侧栏互斥，Board 的 Mermaid 错误回退及下一步恢复通过。没有 API 写入或 pageerror。
- 本地家长端生产构建通过 7 种 fixture 场景：旧成功、旧失败响应不覆盖当前孩子，以及 loading、empty、403、500、断网；375/768/1440 无页面横向溢出，联系窗口在短视口内可用并可按 Escape 关闭。没有 API 写入或 pageerror。
- Admin 真实组件的独立浏览器 fixture 通过 6 组：单模型绑定、不可用绑定替换、长标签布局、Next Link basePath、失败后清除旧成功、供应商更新目录。未使用真实供应商或生产 API。

学生端首次 fixture 检查失败是因为一个 Board step 同时包含 `mermaid` 与 `tex`，被既有运行时 guard 正确拒绝。仅修正本地 fixture，没有放宽 guard。公式检查也改为验证实际承担横向滚动的父容器，而非错误要求每个 KaTeX 内层节点自带滚动。修正后全部检查通过。浏览器脚本及合成报告位于本机临时目录，不含真实学生数据。

## 4. 完整动态 PBL 尚未满足的条件

- 按冻结团队与真实角色，在大纲、课时按需展开和每轮问答三个层次调用真实模型，完成受治理 SSE、校验、恢复与持久化。当前静态开场不能替代 G3A/G3B。
- 完成服务端实验 action 实例、参数域验证、幂等事件、observations 持久化与 CER/rubric 引用。预览、滑块和摘要不得写成掌握、作品通过或成长事实。
- 完成 frozen session/task 路由、项目级 IMA 授权交集、撤权与 provenance 验收，以及当前题恢复和学生答题闭环。
- `TutorService.loadSatisfiedGatesForStudent` 当前按学生而非项目/绑定读取，仍有跨项目 gate 投影风险；其他 owner 的历史懒回填解析也需单独收口。此次未修复，不能宣称冻结治理已覆盖所有路径。
- 完成受认证的完整 16 课时流程、真实数据库事务/并发/断网恢复和真实供应商冒烟。必须区分模型配置存在、协议 fixture 通过、真实推理成功与线上发布。

本轮结果更新了 [历史分轮验证记录](./validation-20261019.md)，没有把历史失败伪装成当前失败，也没有把当前本地测试通过写成生产验收。

## 5. 用户授权的发布

用户在确认并行修改后追加要求，完成后部署至 `study-remote`，并将全部变更推送到服务器主分支及 GitHub。此次交付范围为已验证的安全修复、模型治理和前端集成，不是第 4 节完整动态 PBL 功能发布。

发布前只读核查发现，服务器 `main@8e8f9b4` 干净，配置为 `receive.denyCurrentBranch=updateInstead`；直接推送 main 会立即改动当前运行目录。五个前端和 API 实际均由 systemd 在 `/root/qitu-zhixue` 运行。API 使用 postgres 用户、专属 launcher 和固定 `NODE_PATH`，不是 watch。独立 worker 当前未运行，发布不顺手新增消费者，也不改动另一工作树的 eyeprotect、IMA 或 embedding 服务。

发布采用冻结提交的独立目录构建、保留旧运行产物和单元配置、逐服务切换及检查，全部成功后再同步服务器 main。复用既存受限配置，不输出凭据，不执行数据库迁移、教学造数、门禁注入或模板/团队删除。

### 5.1 实际执行结果

| 项目 | 结果 |
| --- | --- |
| 代码提交 | `8413ef811e19cf0e1c029fc05150325b39076111`，128 个文件，包含用户确认保留的 UI 与文档修改 |
| GitHub | 已按用户要求直接推送 `origin/main`，没有强推 |
| 服务器 Git | 先推独立 release ref；切换和线上检查成功后，再将 `/root/qitu-zhixue` 的 `main` 快进至该代码提交，工作树干净 |
| 隔离目录 | `/root/qitu-releases/8413ef811e19cf0e1c029fc05150325b39076111` |
| 切换完成 | Asia/Shanghai `2026-10-19T06:22:27+08:00` |
| 产物对应 | 构建后逐字节匹配冻结提交的 1,490 个 Git blob；六个 API workspace 依赖均解析到此 release 的 `packages/*/dist` |
| Linux 验证 | 冻结锁文件安装、API/worker 依赖图构建及 API 编译通过；API 947/947、75 suites、0 失败/取消；五个前端 production build 通过 |
| 实际服务 | `qitu-api/auth/student/parent/teacher/admin.service` 全部 active，WorkingDirectory 均为该 release；API 的真实 Node 子进程 cwd 与 `NODE_PATH` 也指向此 release |
| 健康状态 | 本机与公网 `/api/v1/health/ready` 均为 HTTP 200、`status=ready`、`dataMode=live`、database/redis 均 `ok` |
| 静态资源 | 本机 Nginx 与公网各检查 12 条路由，页面及其 CSS/JS 均通过；五端新助手 PNG 均 HTTP 200，SHA256 与源图一致 |
| 权限边界 | 匿名 projects/admin overview 均 HTTP 401；受保护页面按既有角色入口跳转，不展示 Tutor 输入区 |
| 未触碰的服务 | 独立 worker 仍未运行；7 个既存 eyeprotect/IMA/embedding 相关 systemd 单元的 MainPID 与状态和切换前一致 |

API 仍使用原 launcher 的受限配置来源，仅替换专属副本中的 `NODE_PATH`。没有批量替换知识 Python、vendor 或数据路径。运行时政策和技能源码从 release 读取，目录/政策为 ready、发现 1 个技能；这不是 Admin 已启用或真实模型调用成功的证明。Admin 构建出现非致命 webpack 缓存快照告警，构建与静态资源验证仍通过。

公网可见 Chromium 冒烟检查首页、登录页在 375/768/1440px 下无页面横向溢出、已加载图片无损坏，以及四端匿名跳转。最终无 pageerror、HTTP 5xx 或写请求。未登录生产账号，未读取学生会话或提交教学操作；媒体请求被测试脚本主动阻止，因此没有把视频播放列作本次线上通过项。本机报告为 `qitu-release-anonymous-report.json`。

两处验证假设曾纠正，未修改线上业务来迎合测试：父级 `runuser` 的 cwd 为 `/`，实际 API Node 子进程才应检查 release cwd；家长/Admin 的既有匿名目标分别是 `/parent/login`、`/admin/login`，并非全部跳转 `/`。按真实进程与既有路由重验后通过。

### 5.2 回滚与后续同步

- 旧源码、完整运行依赖、五端 `.next`、API/worker dist 保存在 `/root/qitu-releases/rollback-before-8413ef811e19cf0e1c029fc05150325b39076111`。不包含环境或认证文件，六个 workspace 依赖已确认在旧目录内解析。
- 原单元配置位于该目录的 `.release-unit-backup/`；专属旧 API launcher 已创建。现用覆盖文件为六个单元各自的 `zzzzzz-release.conf`，保留更早的 drop-in。
- 服务器 main 已同步，不能简单删除覆盖文件回到主树；应运行下列专属脚本切回保存的旧产物。脚本已做 Bash 语法检查，未在成功发布后人为执行回滚演练。

```bash
bash /root/qitu-releases/rollback-before-8413ef811e19cf0e1c029fc05150325b39076111/activate-rollback.sh
```

构建/切换/复核脚本和匿名浏览器报告保存在 release 的受限 `.release-audit/`；API Linux 日志为 `.release-api-test.log`，运行复核为 `.release-live-verification.json`。本节及部署文档的回填使用独立文档提交同步两端 main，生产仍运行上述代码 SHA，不把后续文档 HEAD 冒充构建产物。完整动态 PBL 的未完成项仍以第 4 节为准。
