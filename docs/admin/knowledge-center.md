# 知识中心与项目知识库

本次交付实现开发文档 v1.1 的第一阶段基础链路。以下内容记录真实能力和边界，不代表整份开发文档已全量完成。

## 已实现

- 管理端知识库/知识引擎页签、真实列表、项目归属、资料数、文件正文预览与下载、资料许可撤销、删除、索引版本和准备记录。
- 统一服务端 JSON：`mcpServers`、`knowledgeEngines`、`platformTools.project-knowledge`。配置以修订号进行并发控制，保存与审计同事务，授权矩阵共享同一份配置。
- 已注册 MCP 的名称、启用与工具子集可编辑；连接及可执行程序必须由服务端注册，浏览器不能提交任意命令或密钥。
- 正式项目确认事务内同时写入同名项目库、唯一绑定及持久化任务。刷新、切换导师或设备均不重新选库。
- 后台任务具有数据库租约、栅栏、阶段事件、有限重试、取消、配置快照、实际索引校验及原子发布；失败不替换已有有效版本。
- 基于固定 DeepTutor `6cf793bd868ba5ecbe64722936d4be8fab5a01df` 原始 LlamaIndex pipeline 的独立索引与检索，不以关键词检索冒充向量引擎。
- 经管理员批准的平台、同校、本人资料可参与元数据规则选材。项目库不能成为其他项目的来源。
- ima 连接检查、显式白名单来源发现、有限预算原文读取及来源记录。检索片段、摘要、不完整或未能识别的扫描页不算原文导入成功。
- 项目对话清除旧的跨库事实注入，仅提供当前绑定版本的 `project_knowledge_search/read`。每次检索和引用读取检查当前权限、有效版本及来源许可，结果返回前再次检查撤权。
- 学生显示实际准备状态，引用预览经登录和项目归属校验；不提供学生选库控件。

## 配置与运行

先应用 `database/migrations/0028_knowledge_center.sql`。旧资料保留真实正文并计算 SHA-256，但默认不取得自动复制许可。ima 原有启用状态和助手授权可迁入，来源白名单初始为 `[]`，导入默认关闭。

在“工具与 MCP → JSON 配置编辑”配置 `llamaindex-main.config.embeddingModelRef`，格式为现有模型目录中的 `providerId:modelId`。必须是真正支持 embeddings 的模型；普通聊天模型无法代替。仅此引擎引用改变，不会切换聊天模型。

部署环境变量：

| 变量 | 含义 |
| --- | --- |
| `QITU_KNOWLEDGE_WORKER=true` | 启动持久化队列消费者 |
| `QITU_KNOWLEDGE_PYTHON` | 隔离 Python 环境解释器绝对路径 |
| `QITU_DEEPTUTOR_SOURCE` | 固定上游源代码目录，包含 `QITU_PIN` |
| `QITU_KNOWLEDGE_DATA` | 由 API 用户独占、可写的索引数据目录 |
| `QITU_KNOWLEDGE_BRIDGE` | 已发布的 `bridge.py` 绝对路径 |

密钥只通过已有模型注册表和服务端环境读取，子进程使用 stdin 接收；不进入 JSON 编辑器、Git、任务日志或浏览器。上游运行目录按库及索引版本隔离。

ima 需要已登记的 `connectionRef: "ima-legacy"`、明确的 `allowedKnowledgeBaseIds` 和 `allowMaterialize: true`。`[]` 不允许任何来源；`null` 也不会变成全平台授权。实际远端桥接服务仍同时执行自己的来源白名单。

## 验证

API 的配置与权限测试包含在 `pnpm --filter @qitu/api test`。真实数据库并发验收：先编译 API 测试，再设置 `QITU_KNOWLEDGE_VERIFY_DATABASE_URL` 指向以 `qitu_knowledge_verify_` 开头的隔离数据库，运行 `node tooling/verify-knowledge-center.cjs`。此脚本拒绝生产数据库名称。

`integrations/deeptutor-knowledge/test_bridge.py` 使用独立 HTTP 向量夹具验证实际上游构建、检索和成员过滤。夹具仅用于测试；它不能作为生产向量模型，也不能证明线上模型已通过预检。

生产部署应先备份数据库及 service 配置，发布至独立 release 目录，再切换 API、管理端和学生端。临时 worktree 不得作为删除后的服务依赖。回滚应用时保留新增知识表和历史来源，不直接执行数据破坏式 down migration。

## 尚未达到整份文档的内容

- 除 LlamaIndex 和 ima 来源适配外，其他引擎只有真实配置清单及未就绪说明；GraphRAG、LightRAG、PageIndex 专用推理路径及其他外部源尚未接通，不能标为可用。
- 已支持 PDF/Office/EPUB 等文件批量上传。文件夹管理、挂载同步、GitHub/网页来源及定时同步尚未实现。
- 当前选材采用有记录的元数据规则降级，不调用新的规划 Agent；尚未实现完整的网关规划、预算配置及逐文档 UI。
- ima 当前只在有限预算内发现和读取相关资料；未实现上游文档全量变更/撤回订阅或文档级外部权限实时同步。平台侧停用、白名单及导入许可的撤销在下一次受控读取立即生效。
- 默认库、影响预览、移动、扫描页 OCR 与图像覆盖管理，以及 MarginNote/Kiwix 特殊面板待后续实现。
- 只有真实向量模型绑定、引擎预检、原文索引和一次实际检索都通过后，才可验收生产项目知识库“可用”。未配置时应显示明确失败，普通教学对话继续运行且不得编造引用。

## 接口与权限

`/api/v1/admin/platform-config` 及 `/api/v1/admin/knowledge/*` 仅管理员可访问。新增写接口要求 `Idempotency-Key`；配置保存额外要求 `expectedRevision`。`/api/v1/student/projects/:id/knowledge` 和引用接口只允许项目所属学生读取。

配置保存成功表示服务端配置已持久化；引擎连接健康由独立预检返回。不可把配置开关、依赖已安装或旧索引存在当作真实检索已经可用。

## 本地中文向量服务

已部署 `BAAI/bge-small-zh-v1.5`（FastEmbed ONNX CPU，512 维），仅监听 `127.0.0.1:4115`。服务源码为 `integrations/deeptutor-knowledge/local_embedding_server.py`，使用独立 Python venv、只读模型缓存及 systemd 内存/CPU 限额；模型下载完成后按离线模式启动，不依赖外部向量接口。

供应商 `qitu-local` 的 baseURL 为 `http://127.0.0.1:4115/v1`，模型 `bge-small-zh-v1.5` 输入 `text`、输出 `embedding`。向量模型不会被声明成聊天模型。服务 bearer 密钥只保存在 root 可读环境文件和已有加密模型注册表，不能提交 Git 或 JSON 配置。配置 `llamaindex-main.config.embeddingModelRef` 为 `qitu-local:bge-small-zh-v1.5` 后须执行引擎检查。

`tooling/verify-knowledge-local.cjs` 在隔离数据库运行真实本地向量预检、项目确认事务、原始 DeepTutor 索引、中文语义检索、原文引用、跨项目拒绝及撤权验证。运行时将服务密钥通过环境传入，不写入脚本或日志。本地模型就绪不会自动批准旧资料或扩大 ima 白名单。

## 多格式文件上传

教学资料库详情中的“上传文件”支持每批最多 20 个文件、单文件最多 10 MiB。支持 PDF、DOCX、XLSX、PPTX、EPUB、TXT、MD/Markdown、CSV/TSV、JSON、XML、YAML/YML、HTML/HTM、RST、TeX；按文件显示解析结果，可重试未完成项。旧 DOC/XLS/PPT 须先转换；扫描件、纯图片和文档内插图当前不执行 OCR。

复用固定 DeepTutor `document_extractor` 的文本路径，排除图片占位符。保留 PDF 页码、Office 可提取的表格/工作表/幻灯片文本。HTML 不执行脚本或获取外部资源。提取不静默截断：正文超过 5 MiB、PDF 超过 500 页、压缩包展开量超限、加密、损坏或无正文均失败，不创建资料或索引任务。

`POST /api/v1/admin/knowledge/bases/:id/uploads` 使用 `{fileName,base64,allowMaterialize}` 和 `Idempotency-Key`。仅管理员可访问，项目库拒绝直接上传。最多两个独立 Python 解析子进程，超时 60 秒；子进程不接收模型凭据，日志和响应不包含原始解析器异常。

应用 `0029_knowledge_file_uploads.sql`，将原文件以 bytea 保存至 `knowledge_file_originals`，与正文、真实原文件 SHA-256 和审计同事务提交。正文进入既有索引与受控项目导入；“下载原文件”需管理员登录且资料仍有效。数据库备份包含原文件，回滚应用保留新增表；down migration 在有文件时拒绝执行。

运行 `integrations/deeptutor-knowledge/test_extract_upload.py` 验证真实解析器。真实项目闭环在既有隔离数据库脚本中设置 `QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH` 指向 DOCX，验证上传幂等、原文件一致性、失败不入库及本地 BGE 索引、项目检索、原文引用与撤权。
