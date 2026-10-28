# 2026-10-19 复核与验证记录

> 第 1 至 5 节为历史复核，源码基线 `f88bb7354ef1bbaef7339f2b6163487c855386d5`。后续轮次见第 6、7 节，不把不同时间的测试混为同一发布验证。
> 时间：Asia/Shanghai 2026-10-19；公网 readiness 返回的 UTC 时间为 `2026-10-18T18:53:10.559Z`。

## 1. 范围与事实层

核查链路覆盖模板治理/绑定、两个立项入口、学习计划生成/持久化/答题、Mastery、Tutor 角色解析/回复/SSE、Team Runtime、知识中心/IMA 桥、学生项目适配器/实验卡，以及 Admin 配置约束。使用源码搜索、关键实现/测试阅读、构建/类型检查、测试和匿名线上访问交叉核对；不是对整个 Monorepo 每一行代码的形式化审计。

- 源码存在：由文件和调用点证明；只有方法定义不能算接线完成。
- 配置存在：需要目标环境配置读回；本轮不读取凭据，也未读取线上 Admin 配置。
- 已部署：需要线上发布标识/资源对应关系；readiness 的 `0.1.0` 不能证明部署了本地 commit。
- 请求成功：必须说明身份、接口和响应；匿名 GET 成功不证明学生答题、实验和证据写入成功。

开始时已有 `.gitignore`、`docs/README.md`、`docs/plan/README.md` 及四端责任域文档的未提交修改。本轮保留这些文件，不回滚、不覆盖。写本轮目标文档前复核 HEAD 和目标文件 SHA256，均未发生变化。

初始未提交文件共 16 个：`.gitignore`、`docs/README.md`、`docs/aboutus/README.md`、`docs/admin/platform-governance.md`、`docs/parent/home.md`、`docs/plan/README.md`、`docs/sdk/overview.md`、`docs/student/growth.md`、`docs/student/inspiration.md`、`docs/student/learning-plan.md`、`docs/student/projects.md`、`docs/student/today.md`、`docs/student/tutor.md`、`docs/student/workbench.md`、`docs/student/works.md`、`docs/teacher/dashboard.md`。它们是用户原有变更，不列入本轮交付或宣称已逐项验收。

## 2. 本轮执行结果

| 命令/检查 | 结果 | 能证明/不能证明 |
| --- | --- | --- |
| `pnpm --filter @qitu/contracts build` | 通过 | 当前 contracts 可构建；不等于所有消费者已运行 |
| `pnpm --filter @qitu/ai-client test` | 通过 | 含 curriculum、mastery、questions、grading、optics quiz bank 等断言 |
| `pnpm --filter @qitu/database build` | 通过 | 数据库包可编译；未执行生产迁移 |
| `pnpm --filter @qitu/api typecheck` | 通过 | 在本次预构建顺序下未复现旧 missing-export 错误 |
| `pnpm --filter @qitu/admin-console typecheck` | 通过 | 不代表配置保存/回读/部分失败流程验收通过 |
| `pnpm --filter @qitu/student-center typecheck` | 失败 | `MermaidView.tsx:39` 报 `TS2307: Cannot find module 'mermaid'` |
| `pnpm --filter @qitu/api test` | 944 项：932 通过、12 失败 | 编译通过；失败包括光学注入 1、知识链接探测 1、Model Gateway 10，不是全绿 |
| API 完整依赖图预构建 | 通过，6 个依赖包 | `pnpm -r --workspace-concurrency=1 --filter '@qitu/api^...' build`，含 model-runtime |
| 预构建后定向测试 6 个文件 | 51 项：49 通过、2 失败 | optics-plan、plan-generator、binding、team-resolution、interactive-blocks、knowledge-link-probe |
| `pnpm check:basepath` | 通过 | 检查 4 个应用、323 个文件，无前缀重复 |
| 本轮文档检查 | 通过 | UTF-8、无替换字符/成片问号、代码围栏成对、相对文件链接存在、目标 diff 无空白错误 |

学生端 `package.json` 和 `pnpm-lock.yaml` 已声明 `mermaid@12.2.0`。本轮不贸然在 UNC 上重装依赖、不新增假类型声明来掩盖安装问题；应在干净的本地磁盘 checkout 使用冻结锁文件复验。

`fs.realpathSync` 检查显示根 `node_modules/@qitu/{contracts,ai-client,database}` 均不是对应 `packages/` 的同一实际路径，安装快照风险仍存在。**与旧审计不同，本轮 API typecheck 确实通过**；不能继续把旧的“API 一定无法检查”写成当前事实，也不能反向宣称整个 workspace 已恢复为真实链接。

定向字节比对显示 contracts 的 `src/curriculum.ts`、`src/tutor.ts`，ai-client 的 `dist/quiz-bank/optics/content.js` 和 model-runtime 的 `dist/index.js` 与根安装副本相同；这只证明这几个文件一致，不证明所有传递依赖。不能把本轮所有测试失败笼统归因为 UNC 快照。

### 测试失败与限制

- 光学注入测试期望显示卡片，但 fixture 仍只提供标题，源码却改为版本 ID 前缀判断；真实模板 ID 又是 `tplv-*`。需按冻结模板/实验 scope 修复实现与 fixture，不是再加一种标题猜测。
- 知识库链接探测测试 `linked probe requires allowlisted realpath, ready version-N and matching server model signature` 返回值与预期不符；完整依赖预构建后仍失败。本轮未进一步归因，不能直接认定是光学业务或平台权限缺陷。
- Model Gateway 的 10 项失败包含协议路径/错误语义及旧的“stream 未实现应拒绝”断言。源码当前已代理到统一 Runtime；存在实现与旧测试预期的差异。本轮只记录失败，不武断地把它们全部归为测试过时或生产回归。
- 定向 51 项中只有光学注入、知识链接探测失败；其余 49 项通过，含光学 16 课时生成的测试。但内存 fixture 下成功不证明线上数据库事务、IMA 范围或完整课时交互成功。

复现定向测试（先执行 API 测试脚本中的 TypeScript 编译；产物不是长期真源）：

```powershell
Set-Location services/api
node --test --test-reporter=tap .tmp/test-dist/modules/learning-plan/optics-plan.e2e.test.js .tmp/test-dist/modules/learning-plan/plan-generator.test.js .tmp/test-dist/modules/templates/templates-binding.service.test.js .tmp/test-dist/modules/ai-tutor/tutor.team-resolution.test.js .tmp/test-dist/modules/ai-tutor/tutor-interactive-blocks.test.js .tmp/test-dist/modules/knowledge/knowledge-link-probe.test.js
```

## 3. 定向行为复现

构建后执行只读纯函数检查：

```powershell
node --input-type=module -e "import {getPhaseAndRoleForSession} from './packages/contracts/dist/curriculum.js'; for (const x of [0,-1,1.5,17,NaN]) console.log(String(x),JSON.stringify(getPhaseAndRoleForSession(x)));"
```

实际结果：`0/-1/17/NaN` 均返回 `deliverable_review`；`1.5` 返回 `exploration`，没有拒绝非法索引。因此该辅助函数不能直接成为授权或课时路由入口。应在解析冻结模板时检查正整数、索引覆盖和实际 session；不应仅为固定的 1–16 数字范围补默认分支。

其他源码复核：

- `resolveDeepTeamBinding`、`resolveSessionAgent`、`canAccessImaKnowledge` 的仓库检索只有定义，没有生产调用点；不能以它们的名字证明新方案已运行。
- `newTemplateVersionId()` 返回 `tplv-${randomUUID()}`；实验投影却检查 `startsWith('optics-physical-inquiry')`。真实治理生成的光学版本不会满足此前缀。
- 当前 `optics_experiment` 契约已包含 `specVersion/objectiveId/sessionIndex/allowedActions`；旧审计将它们全部写为“缺失”已不准确。尚缺的是服务端签发动作实例、参数验证、观测持久化和 CER 关联。

## 4. 网站匿名复核

以部署文档明确的公网入口 `http://122.51.130.204` 直连（不经开发机代理）进行 GET：

| 访问 | 结果 |
| --- | --- |
| `/` | HTTP 200 |
| `/student/tutor` | HTTP 200 HTML；浏览器执行客户端认证后跳转 `/`，没有展示受保护 Tutor |
| `/login` | 浏览器可见学生/家长/班主任/Admin 身份、真实接口登录表单和测试账号入口 |
| `/api/v1/health/ready` | HTTP 200，`status=ready`、`dataMode=live`、database/redis 均 `ok` |
| `/api/v1/projects` | 匿名 HTTP 401 |
| 本机 `127.0.0.1:3101` | 连接被拒绝；本轮未启动本地应用 |

没有在共享环境登录后读取学生原始对话、提交 Tutor 回合、确认项目、写作品或人为植入 `TheoryMastered`。因此本轮**未验证**：授权后 16 课时全流程、真实模型调用、按冻结团队接管、项目级 IMA 授权、实验事件写入、断网重放、手机端完整操作，以及公网版本是否等于本地基线。

公网本次验证使用 HTTP；未执行 TLS/证书审计。不得把这种检查记录当作正式学校环境处理敏感数据的安全批准。

## 5. Grok 与上游证据

- 本轮检索规划会话：`59f3928dbbc2`。
- 实际 `web_search` 会话：`5e06e6a1df28`；`sources_count=0`，随后 `get_sources` 返回空数组。
- 查询限定 THU-MAIC/OpenMAIC 和 HKUDS/DeepTutor 的 planner/instructor/evaluator、mastery loop 与 question card。返回文本自述无法访问源码，连示例 DeepTutor 路径也有偏差，故不采用其功能断言，不保存其推理文本，不引入任何效果数字。
- 本地 OpenMAIC HEAD：`ecb940c136cc5b4ea56dc81b2505e64eff1dea29`。
- 本地 DeepTutor HEAD：`a053fecf6eeca51ded680de8b8fc41ef63857b11`。
- 独立直连验证两个固定 commit 的 `planner.ts` 和 `deeptutor/learning/question_card.py` 官方 raw URL 均 HTTP 200；功能判断来自读取源码，不来自 Grok 摘要。
- OpenStax 单缝衍射官方章节 URL HTTP 200；仅作为物理模型参考，不当作高中 PBL 学习效果研究。

证据链接与可迁移模式见 [调研报告](./research-report.md)，当前风险见 [差距审计](./gap-audit-20261019.md)。本轮未新增同行评审文献效果主张，也不声称完成系统综述。

## 6. 后续提交与最新文档轮次

### 6.1 8e8f9b4 的定向验证记录

此前针对新提交执行 API 依赖构建、TypeScript 编译和四个文件的定向测试，28 项通过、0 失败。文件为 projects.service.test、tutor-team-members.test、tutor.team-resolution.test、team-runtime.student-status.test。覆盖绑定缺失拒绝、修复后重试、冻结成员、真实身份、禁用/错误和 idle/ready。

```powershell
pnpm -r --workspace-concurrency=1 --filter '@qitu/api^...' build
pnpm --filter @qitu/api exec tsc -p tsconfig.json --outDir .tmp/test-dist
pnpm --filter @qitu/api exec node --test .tmp/test-dist/modules/projects/projects.service.test.js .tmp/test-dist/modules/ai-tutor/tutor-team-members.test.js .tmp/test-dist/modules/ai-tutor/tutor.team-resolution.test.js .tmp/test-dist/modules/team-runtime/team-runtime.student-status.test.js
```

这不是完整数据库/真实模型验收，不能证明之后并行修改的 Runtime、知识链接、Model Gateway 或 renderer 已通过。原 f88bb73 全量测试数字也不再直接代表当前工作区。

### 6.2 实时生成架构与计划更新

本次只修改 docs/plan/codex 的八份 Markdown，没有修改业务源码、安装依赖、部署、操作学习数据库、调用真实教学模型或重新检索 Grok。

开始时记录 HEAD 和八份目标文档 SHA256。用户的 Runtime、知识探测、Model Gateway、Mermaid/Board/Markdown renderer 及其他文档变更保留，不回滚、不列为本次实现成果。文档更新时按目标文件 hash 检查并发覆盖风险。

本次已检查八份文档的 UTF-8、替换字符/异常问号、代码围栏及 35 个相对文件链接，均通过。目标 `git diff --check` 通过；LF/CRLF 提示是当前 Git 配置提示，不是本次检查错误。

四张 Mermaid 图使用独立浏览器页面加载 Mermaid 11.12.0 并执行 parse，全部通过，随后关闭临时页面。该检查只证明图语法，不认证网站安装版本或 renderer；没有安装依赖或启动网站。本地根目录无法直接 resolve mermaid/playwright，不据此推断所有应用依赖均缺失。

这些检查不证明 AI 实时生成已经实现。最新方案以总架构和实施计划为准，业务验收仍需执行 B0 及各项 PR 测试。本次未重跑业务构建、全量测试或实际模型/IMA 请求。

## 7. 三线接管后的独立验证

在 `8e8f9b4` 加本轮工作区修改上，使用无秘密的本地磁盘副本、冻结锁文件和真实 workspace 依赖重新验证。API 947 项、学生端 23 项单元与 5 项边界测试、Runtime 与 Admin 模型选择 33 项均通过；学生端和 Admin 的 typecheck、optimized build 通过。实际 renderer 的独立浏览器检查通过，不是授权 Tutor 全流程验收。

修复内容、命令、此前失败的归因与剩余发布条件见 [三线接管修复与验证](./takeover-validation-20261019.md)。本节取代历史轮次作为这些测试项的最新本地状态，不取代真实模型、数据库、IMA、实验事件和完整 16 课时验收。未部署或写入生产数据。

用户确认并行修改后，最终 API 仍为 947 项全部通过，学生端 28 项通过，五个前端 typecheck 与 production build 通过。Admin 尾修增加标签测试后，Runtime 与模型选择共 34 项通过。学生端、家长端和 Admin 的新增本地浏览器 fixture 检查见接管记录第 3.1 节。用户随后授权部署与推送，执行结果单列于接管记录第 5 节；本节之前的“未部署”描述保留其历史轮次范围。

## 8. 用户授权的实际发布

代码提交 `8413ef811e19cf0e1c029fc05150325b39076111` 已推送 GitHub 和 `study-remote` 的 main。服务器在独立 release 安装冻结依赖并串行构建，Linux API 947 项全部通过，五个前端 production build 通过。2026-10-19 06:22:27（Asia/Shanghai）完成 API 与五个前端的逐服务切换；构建后 1,490 个 Git blob 与提交匹配，实际 Node 运行目录和依赖路径已核对。

本机 Nginx 与公网各 12 条路由及其 CSS/JS 通过；五端新助手图标与源图 SHA256 一致。公网 readiness 为 live、database/redis 均 ok，受保护 API 匿名 401。可见浏览器检查首页和登录页的三个尺寸及四端匿名重定向，无 pageerror、HTTP 5xx 或写请求。不把该匿名检查当作登录后业务或真实推理验收，也未验证视频播放。

未执行迁移、教学造数、门禁注入或模板/团队删除。独立 worker 仍停用，其他工作树 eyeprotect、IMA、embedding 相关单元未重启。旧产物、配置备份、脚本与验证假设修正见 [接管发布记录](./takeover-validation-20261019.md) 第 5 节；动态生成、IMA/实验证据和完整 16 课时仍未完成验收。后续文档提交只更新两端 main，不改变此次生产产物 SHA。
