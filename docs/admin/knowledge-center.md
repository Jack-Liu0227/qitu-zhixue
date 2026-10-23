# 知识中心

## 配置与矩阵工作区（2026-10-22）

管理员已确认采用[配置与助手矩阵方案](../plan/codex/knowledge-center-config-matrix-20261022.md)。保留知识库和知识引擎页签；知识库页上方配置资源，下方以助手为行、知识库为列维护逐库检索授权。按 2026-10-23 用户追加要求，知识库卡片将查看和配置合并为一个「查看与编辑」按钮，进入同一路径内的详情工作区。面板对齐 DeepTutor：顶部库信息和页签，文件页左侧目录、右侧预览；本地库提供文件、添加文档、关联文件夹、GitHub、网络、索引版本、设置，关联库提供文件和设置。助手授权仍通过返回列表后的统一矩阵编辑。

详情工作区内切换页签保留文档选择、配置草稿及上传队列；配置保存中、配置结果待核验及上传运行中阻止页签切换和返回列表。未确认的配置请求使用相同幂等键恢复；已收到写入回执但回读失败时，仅重试读取。配置只有服务端回读完成才显示保存成功。远端文件仍由原服务维护，本地文件操作仍调用既有 Admin owner。原分离式文件弹窗和配置抽屉退出此入口。

矩阵复用原绑定表，增量 PATCH 只改明确提交的单元格。保存按库事务执行，支持修订冲突、幂等重试和部分成功；回读后才确认已保存。未知目录不是空目录，读取失败不得删除隐藏或历史绑定。停用助手或库仍可撤权。绑定已保存与连接、索引、工具当前可用分别展示。

统一检索和 IMA 四个只读工具均受当前逐库绑定约束，项目还受冻结 grant、对象权限与引用来源校验约束。重新关联保留本地库及助手绑定，管理员从官方目录明确选资源，不按名称换绑，也不重写历史项目授权。

以下日期早于本节的创建、文件预览和库内绑定说明作为原有实现记录；当前界面以配置与矩阵方案为准。

知识库由管理员手动创建或连接已有知识库。学生创建、确认项目不会建库、复制资料、自动选材或提交知识准备任务；对话没有选库和项目建库等待状态。

### 账号与连接直接编辑（2026-10-23 追加）

知识库「设置」页现可直接编辑账号与连接：共享引擎卡片显示服务地址、Client ID、API Key 和受影响的知识库；复用 `RemoteConnectionFields`，对应 DeepTutor `EngineDetail` / `ImaConnectionFields`，与知识引擎页写入同一份 `platform-config`，不另建凭证存储。服务地址变化时清空旧 API Key；IMA 和 PageIndex 的官方地址固定，可恢复错误的历史地址。共享凭证草稿未保存时，不用旧凭证执行单库连接操作。

单库「连接与资源」直接编辑 IMA 库 ID、WeKnora 地址/库 ID、LightRAG Server 地址/Workspace、Kiwix 地址/ZIM 名称；IMA 也可通过账号目录选库。既有 `PATCH /admin/knowledge/bases/:id/connection` 新增 `connection` 字段，保留旧 `remoteKnowledgeBaseId` 请求兼容。服务端按 provider 校验字段、地址和资源，禁止单库连接携带密钥；真实适配器验证成功后才写入，失败保留旧连接。Admin 权限、版本与幂等检查、资源证据失效和脱敏审计沿用原 owner；只在 IMA 重新关联时更新对应白名单，其他服务不写 IMA 授权。原有助手绑定和冻结项目合同不变。

共享引擎保存前回读并比较实例快照，保留其他引擎、MCP 和工具配置；未确认提交固定 payload/revision/幂等键，已收到回执后只重试读取。最终按回读的实例值确认成功，其他页面再次覆盖时明确提示冲突。凭证仅在管理员页面会话与既有配置存储中处理，不写入新增日志、Git 或浏览器持久化缓存。

账号/连接编辑增量验证：12 项浏览器交互检查、原有 27 项文件工作区回归、6 项新增后端行为测试通过；Admin typecheck、Admin/API lint 通过。新增测试位于 `knowledge-connection-edit.test.ts`，覆盖字段与地址、凭证拒绝、失败保留、证据失效、IMA 目录验证、幂等回放、并发冲突和 Admin 权限。UNC 验证显式构建 contracts/database/ai-client 并解析工作区产物；连接模块独立编译通过。本地全量 API 检查当时发现并行 `tutor-courseware-activity.ts` 的两处类型错误，未修改或纳入本次提交；正式发布源码的全量编译与回归结果如下。

#### 账号与连接编辑发布回执

2026-10-23 16:57（Asia/Shanghai），`970ef40567cd218873cad0a38352d384210795b1` 已合入 `study-remote/main` 并在正式目录发布，Admin build ID 为 `0xaG8eb2Wclpn6Lqm0b83`。远端按 API/Admin 依赖图构建，API 全量类型编译、知识模块 106 项测试、Admin typecheck、双方 lint 与生产构建全部通过。

- 已发布页面使用隔离合成 API 通过 12 项账号/连接检查及 27 项文件工作区回归，浏览器异常为 0。全部配置写入均由浏览器拦截，不修改真实账号或知识库；此结果不代表真实外部账号的连接验收。
- 静态资源检查通过，匿名连接编辑 API 返回 401，API readiness 为 live/ready，database、redis 为 ok。Admin PID `2269676 → 2277765`，API PID `2259330 → 2277389`，其余八个受检服务 PID 未变化；没有数据库迁移。
- 合并前后已有远端修改与脚本 SHA-256 一致，构建过程中相关源码哈希无变化。备份 `/root/qitu-backups/knowledge-connections-20261023T085417Z/` 保存旧 Admin `.next`、API `dist`、构建/测试日志、服务与源码快照、浏览器脚本和验收结果。
- 本地并行课件、课时绑定、Tutor、知识检索及其合同/数据库修改均未纳入本次提交；`knowledge.module.ts`、`knowledge-retrieval.service.ts`、知识中心 `page.tsx` 等并行文件未覆盖。本次发布保留远端已有 Admin/学生页面修改；这些工作独立于本次知识连接验收。

### 统一查看与编辑面板（2026-10-23）

根据用户对 DeepTutor 面板一致性的反馈，现改为页内 `LibraryWorkspace`，移除独立 `LibraryFilesDialog` 和 `LibraryConfiguration`。文件区左侧使用可折叠的本地目录树，右侧保留 PDF/文本预览，并提供创建文件夹、移动及移除本地文件；其他维护操作分别放入来源、索引版本和设置页签。云端只展示文件和设置，不出现不支持的本地写入入口。知识库列表及助手矩阵保持挂载，返回后保留原列表状态；全局导航不变。

验证：Admin 类型检查及 lint 通过，隔离浏览器运行真实组件通过 27 项检查，包含原有本地/云端浏览能力、PDF 页码和设置草稿跨页签保留、来源草稿独立、嵌套目录与移动、上传刷新、移除成员后留在详情、删除库后返回列表、键盘切换、390px 布局，以及写入期间导航锁定、响应丢失时同键重试、写成功后回读 403 仅重试 GET。浏览器异常为 0；11 次写入全部由隔离合成 API 拦截，没有修改真实知识库。API 与数据库合同未改动，继续沿用此前已通过的知识模块 100 项测试。

#### 统一面板发布回执

2026-10-23 16:31（Asia/Shanghai），`eb67b1db8449c549dd844db0b35b3ea250b171af` 已合入 `study-remote/main`，正式目录 `/root/qitu-zhixue` 的 Admin build ID 为 `96EhqhJO3TqL4PcLvqO28`。Linux 依赖图构建、Admin typecheck、lint 和生产 build 全部通过，构建期间源码哈希无变化。

- 已发布页面配合隔离合成 API 通过 27 项交互检查，浏览器异常为 0；PDF 翻页额外确认画布像素变化。认证、教材和 11 次写入均为测试拦截响应，不代表真实管理员账号及真实云端原文验收。
- `/admin/settings/knowledge` 的 14 个 CSS/JS 引用和 `/admin/login` 的 11 个引用通过检查；匿名知识库 API 为 401，API readiness 为 live/ready，database、redis 均为 ok。
- 只重建并启动 `qitu-admin`，PID `2259259 → 2269676`；API、官网/认证、学生、家长、教师、IMA MCP、embedding、workers、profile-growth 的 PID 未变化。未执行数据库迁移或生产知识库写操作。
- 远端已有未提交改动，因此先推送临时分支，再快进合入 main；未使用 reset、stash 或覆盖同步。独立校验合并前后既有修改及未跟踪脚本的 SHA-256，一致。原运行产物、构建日志、源码快照、服务快照和浏览器脚本/结果保存在 `/root/qitu-backups/knowledge-workspace-20261023T083009Z/`。

并行修改未纳入本次提交：Admin 的 `settings/assistants/page.tsx`、`settings/teams/page.tsx`、`settings/templates/page.tsx`、`TemplateTeamBindingPanel.tsx`、`teaching-binding/TeachingRoleInspector.tsx`；学生端的 `TutorPage.tsx`、`LessonAssessmentCard.tsx`、`LessonLearningDock.tsx`；`docs/plan/codex/README.md`、课程团队方案的 `05`、`06`、`07` 和 `README.md`，以及 `docs/student/template-session-openings-plan.md`、`docs/student/tutor.md`、`doc/e2e-dual-template-testing-v1.1.md`。本次只验证其内容被保留及 Admin 构建兼容，不将知识中心交互测试作为这些功能的验收。

### 已有文件查看（2026-10-23 首版，布局已被上节替代）

配置与矩阵改版后，原 `LibraryDetail` 文件浏览组件未再被页面引用，导致已配置的本地、云端知识库均没有文件查看入口。本次在卡片及配置抽屉补回「查看文件」，参考仓库内固定版本 DeepTutor 的 `KbFilesTab`，采用左侧目录、右侧预览的只读弹窗，复用 `PdfDocumentPreview` 和既有 Admin 文件接口。

- 本地库读取当前成员列表；关联库通过 `remote-files` 读取来源目录，支持文件夹、分页及返回上一位置。关联库依据服务端 connection 判断，不按引擎名称猜测。
- PDF 默认在线阅读，其他文件默认提取文本；云端目录缺少扩展名时，也可根据正文接口返回的 MIME 类型识别 PDF。原文失败时仍能切换文本。
- 文档读取携带对应目录和分页游标；换文档、换目录、刷新、断网或关闭时忽略旧响应。目录失败清空旧列表，明确显示 loading、empty、error、离线、权限失败和重试状态。
- 目录、正文和原文件仍由服务端校验 Admin 登录、库/成员归属、连接及引擎状态。弹窗不创建索引、不保存文档、不更改授权；上游未提供目录/正文时显示真实失败，不能据此声称所有引擎都支持文件浏览。

验证边界：实际页面组件在隔离浏览器宿主中通过 16 项交互检查，覆盖本地/云端 PDF、文本、目录/分页、无扩展名 PDF、请求竞态、权限重试、断网恢复、空列表、配置入口及 390px 布局；知识模块现有 100 项测试全部通过。管理员端 lint，以及 API/管理员端基于工作区源码解析的 typecheck 均通过。

UNC `node_modules` 为旧安装快照，先构建 contracts、database、ai-client、infra、agent-memory、model-runtime；验证时将 `@qitu/*` 指向本次构建或实际源码，并在本机临时目录安装已声明的 PDF/飞书 SDK 依赖，没有替换共享安装快照。浏览器脚本与结果在执行机 `%TEMP%/qitu-knowledge-file-review/`；知识模块可通过 `node --import ./tooling/verify-workspace-source.mjs --test "services/api/.tmp/test-dist/modules/knowledge/*.test.js"` 复核。隔离验证不代表已读取真实云端文件；实际发布回执如下。

#### 发布回执

2026-10-23 按用户要求同步至 `study-remote` 的 `main`，正式目录 `/root/qitu-zhixue`。Admin 运行构建包含 `06ad5df7f139da47bf5ad9c24f66e63980707dce`，Next build ID 为 `iBYLpIVv7O8smkABNac1x`。

- Linux 按依赖图构建 Admin 依赖，Admin typecheck、lint、生产 build 通过；先停止 `qitu-admin` 再构建，启动后为 active。
- 线上 `/admin/settings/knowledge` 的 14 个 CSS/JS 引用、`/admin/login` 的 11 个引用通过检查。匿名知识库 API 返回 401；API readiness 为 live/ready，database 和 redis 均为 ok。
- 已发布页面配合隔离合成 API，再次通过上述 16 项浏览器检查，页面异常为 0。生产 HTML、JavaScript、CSS 和 PDF worker/font 资源均实际加载；认证与教材内容是测试拦截响应，不代表真实管理员登录或云端原文验收。
- 只重建并启动 Admin。API、官网/认证、学生、家长、教师、IMA MCP、embedding、workers、profile-growth 的服务 PID 未变化；没有数据库迁移或知识库/助手授权写操作。
- 旧 Admin `.next`、发布日志、服务前后 PID 和浏览器回执保存在 `/root/qitu-backups/knowledge-files-20261023T074118Z/`。远程未跟踪的测试脚本及本地并行编辑的助手/团队/教学文档未纳入本次提交；并行修改的 `test_bindings.mjs` 保持其当前版本，没有用备份覆盖。

## 管理与授权

- 知识中心保留知识库、知识引擎两个页签。知识库列表与详情按 DeepTutor 6cf793bd 重构，采用启途智学蓝色视觉；新建/关联、内联引擎默认配置、文件预览、来源同步、版本和助手绑定在库内管理。
- JSON 工作台的知识库根行配置统一检索能力；子行配置各知识引擎。`platformTools.project-knowledge` 仅保留为旧配置的兼容键，其名称和工具定义统一为“知识库检索”、`knowledge_search`、`knowledge_read`。启用状态及助手授权原样保留，不因功能调整自动扩权。
- 管理员在知识库详情的「AI 助手」页签选择一个或多个助手；保存时为所选助手补齐全局工具绑定，同时保存逐库 `retrieve` 权限。工具总开关不会自动开启；助手停用、全局撤权、逐库解绑仍立即生效。全局「检索助手绑定」已移至知识库列表底部，知识引擎页不再承载该面板。学生只可访问平台资料、同校资料、本人资料，历史 `kind=project` 库不进入检索范围。一个手动知识库可供多个已授权助手共用。
- 旧自动生成的库、资料、版本和项目绑定保留作历史记录，在管理端标记只读；不再上传、重建或用于对话。尚未完成的历史准备任务由 worker 标记 `cancelled / PROJECT_KNOWLEDGE_RETIRED`，不会自动复制原文。
- 移除项目导入许可和自动选材入口。旧 `allowMaterialize` 字段仅为请求兼容保留，新上传资料不会获得自动复制许可；不再注册 ima 自动发现/导入服务。ima 的现有受控只读 MCP 调用仍执行原授权检查。

## 对话与引用

每轮按实际阶段助手解析授权，读取管理员维护的知识库有效索引。学生无需选择库，项目无需绑定专属库。最多检索 20 个已授权手动库，工具结果最多 8 条；版本、成员、引擎配置或权限变化会阻止旧结果返回。知识不可用时保留普通对话能力，明确不能查证，不编造引用。

`knowledge_search` 只接受 `query`、可选 `topK`；`knowledge_read` 只接受 `citationId`。模型不能提交库 ID、路径、凭证或越权扩大范围。引用预览要求学生登录，传入项目上下文时检查项目归属，再重新解析助手权限。`GET /student/projects/:id/knowledge` 已移除。

## 文件与索引

管理员在知识库详情上传 PDF、DOCX、XLSX、PPTX、EPUB、TXT、Markdown、CSV/TSV、JSON/XML/YAML、HTML、RST、TeX；单文件不超过 100 MiB，每批最多 20 个。旧 DOC/XLS/PPT 须先转换，扫描件须先 OCR。正文超过 5 MiB、PDF 超过 500 页、加密、损坏、无正文或展开超限会失败，不创建成员或索引任务。

`POST /admin/knowledge/bases/:id/uploads` 使用 `{fileName,base64}` 和 `Idempotency-Key`；直接正文使用 `{title,content}`。原文件、真实校验和与正文保留；保存后异步构建索引。队列保留租约、栅栏、重试、取消、版本快照、实际校验和原子发布。失败不会替换已有有效索引。

LlamaIndex 使用固定 DeepTutor `6cf793bd868ba5ecbe64722936d4be8fab5a01df` 原始 pipeline。`embeddingModelRef` 必须引用模型目录中实际输出 `embedding` 的模型；普通聊天模型不能代替。其他引擎和连接器见 [知识引擎](./knowledge-engines.md)，配置成功不等于引擎就绪。

## 部署与验证

保留现有知识表及历史数据，无破坏式迁移。模型密钥仍从模型注册表或环境解析；远端知识引擎密钥按管理员要求可在网页和统一 JSON 中直接修改，访问限管理员，不进入 Git、日志或检索结果。环境变量仍为 `QITU_KNOWLEDGE_WORKER`、`QITU_KNOWLEDGE_PYTHON`、`QITU_DEEPTUTOR_SOURCE`、`QITU_KNOWLEDGE_DATA`、`QITU_KNOWLEDGE_BRIDGE`。

管理员配置、目录和写操作仍需真实登录与角色校验；写操作需幂等键，配置需修订号。API 测试覆盖全局撤权、成员撤回、索引替换和历史任务取消。`tooling/verify-knowledge-local.cjs` 仅接受 `qitu_knowledge_verify_*` 隔离数据库，验证项目确认零知识写入、手动上传/索引、真实中文检索、原文引用、共享与授权撤销。不得使用生产库做测试夹具。

## 创建与详情（2026-10-18）

创建弹窗提供「新建」与「关联已有」。已有引擎实例直接复用默认配置；「编辑默认配置」保存到同一 platform JSON，无第二份凭证配置。新建本地索引可固定嵌入模型、选初始文档并绑定多个助手。账户资源库是当前支持的存储工作区。远端库的创建是本地登记已有远端资源，并不调用远端创建接口。

关联本地 LlamaIndex / GraphRAG / LightRAG 时，服务端 realpath、允许目录、原生索引就绪和 embedding signature 均通过后才保存；不复制或重建原索引。ima / WeKnora / LightRAG Server 等使用原有 DeepTutor 客户端验证。ima 经管理员核验的库 ID 写入现有实例白名单。

详情包含文件、添加文档、关联文件夹、GitHub、网络、索引版本、AI 助手、设置；关联库隐藏本地上传/重建入口。文件支持列表搜索、正文/PDF 预览、原文件下载与删除，本地逻辑文件夹可持久保存并移动文件。ima 支持远端目录、文件夹与原文浏览；原生关联索引有 raw 文件时可浏览。未提供目录 API 的来源明确提示去原服务管理，不伪造文件列表。

设置提供改名、默认库、删除；普通本地库可选择已配置引擎，变更后清除有效索引指针、等待重建。删除为软删除，取消任务并撤销来源/连接，不删除远端原文件。有效的默认库在授权范围内优先查询。来源可手动或按 1–720 小时计划同步；worker 按分钟领取到期来源，仍经过原有预算、允许列表、审计和发布栅栏。

`0034_knowledge_library.sql` 增加 `library_settings` 与 24 小时远端证据缓存。缓存按助手、知识库、连接及引擎指纹隔离，读取时再次检查权限；过期记录由 worker 清理。`tooling/verify-knowledge-library.cjs` 仅允许隔离数据库，验证真实 BGE、原生 DeepTutor 建索引/关联、多助手检索、原文、修订冲突、幂等、文件夹和撤权。

### 100 MiB 文件上传部署要求

部署前执行 `0035_knowledge_upload_100mb` 迁移，扩大原文件存储约束；降级迁移遇到超过 10 MiB 的现有文件会拒绝执行，不删除资料。

单文件上限为 100 MiB（104,857,600 字节），包含创建知识库时选择文件与详情页添加文件。上传仍逐个发送，每批最多 20 个；正文、页数和解压限制沿用原规则。API 仅对 `/api/v1/admin/knowledge/bases/:id/uploads` 放宽 JSON 请求体至 140 MiB，容纳 Base64 的体积增长，其他 JSON 接口仍为 20 MiB。

Nginx 须在通用 `/api/` 代理之外增加下列专用 location（保留现有转发头），并执行 `nginx -t` 后 reload。此路由关闭请求缓冲，避免大文件写入代理临时目录，并给上传保留足够时间；其他路由的 50 MiB 限额不变。

```nginx
location ~ ^/api/v1/admin/knowledge/bases/[^/]+/uploads/?$ {
    client_max_body_size 140m;
    client_body_timeout 300s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_http_version 1.1;
    proxy_pass http://127.0.0.1:4100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Tencent ima：验证凭证并选择已有知识库

在「知识库 → 创建知识库 → 关联已有 → Tencent ima」中复用已保存的引擎实例，或在同一弹窗填写 Client ID、API Key 后验证。点击「验证凭证并读取知识库」，选择官方 OpenAPI 返回的库，可自动填写名称，再关联。编辑过的引擎配置须先保存，后续关联直接复用。

实现参照 HKUDS/DeepTutor `6cf793bd` 的 `useImaConnection`、`ImaConnectionFields`、`ImaClient.search_knowledge_bases` 和 `probe_knowledge_base`；同时核对 GitHub main 的官方列表与详情请求。复用已安装并固定版本的 DeepTutor 客户端，不引入第二套 ima HTTP 签名逻辑。

- 管理员接口：`POST /api/v1/admin/knowledge/engines/:id/ima-bases`；请求可传 `cursor`、`limit`（1–20，按当前接口约束）以及完整的草稿 `engine`。未传草稿则复用该实例的已存配置。
- 只读列库不会保存凭证、建立知识库或增加助手权限。列表 ID 直接用于连接预检和关联；创建时服务端重新调用官方详情接口确认访问权限。仅关联成功后沿用现有授权/绑定流程。
- Client ID 是账户身份；客户端地址里的 `knowledgeBaseId` 可能是内部 ID，均不可替代 OpenAPI 返回的知识库 ID。手动填写模式须先检查连接。
- 列表支持分页、去重和明确的空状态；修改凭证、切换实例或来源时作废旧列表、选择和预检，忽略过期请求。读取失败可重试，未保存的凭证不能提交关联。
- Python ima 适配集中于 `integrations/deeptutor-knowledge/ima_runtime.py`。所选库 ID 优先于引擎默认库，桥接入口允许目录/文档只读操作。
- 稳定错误码区分 `IMA_CREDENTIALS_REJECTED`、`IMA_RATE_LIMITED`、`IMA_TIMEOUT`、`IMA_UNREACHABLE`、`IMA_UPSTREAM_INVALID_RESPONSE`、`IMA_KB_ID_IS_CLIENT_ID` 和 `REMOTE_RESOURCE_NOT_FOUND`。不向网页返回原始上游异常或凭证。

验收：知识模块 89 项测试、适配运行时 14 项测试通过，API 与管理员端 lint/typecheck/build 通过；真实 ima 四库列举、连接预检、隔离数据库关联及目录读取通过，桌面/390px 移动端和请求状态竞态检查通过。正式环境仅进行只读列库与预检，不创建验收库或改动现有助手绑定。
