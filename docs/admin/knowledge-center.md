# 知识中心

知识库由管理员手动创建或连接已有知识库。学生创建、确认项目不会建库、复制资料、自动选材或提交知识准备任务；对话没有选库和项目建库等待状态。

## 管理与授权

- 知识中心保留知识库、知识引擎两个页签。手动命名、选择引擎、上传文件、添加正文、来源同步、预览下载、删除、重建索引、查看任务和引擎状态继续使用原管理流程。
- JSON 工作台的知识库根行配置统一检索能力；子行配置各知识引擎。`platformTools.project-knowledge` 仅保留为旧配置的兼容键，其名称和工具定义统一为“知识库检索”、`knowledge_search`、`knowledge_read`。启用状态及助手授权原样保留，不因功能调整自动扩权。
- 管理员同时授予助手全局知识检索能力及逐库 `retrieve` 权限后，助手才能检索该库。学生只可访问平台资料、同校资料、本人资料，历史 `kind=project` 库不进入检索范围。一个手动知识库可供多个已授权助手共用。
- 旧自动生成的库、资料、版本和项目绑定保留作历史记录，在管理端标记只读；不再上传、重建或用于对话。尚未完成的历史准备任务由 worker 标记 `cancelled / PROJECT_KNOWLEDGE_RETIRED`，不会自动复制原文。
- 移除项目导入许可和自动选材入口。旧 `allowMaterialize` 字段仅为请求兼容保留，新上传资料不会获得自动复制许可；不再注册 ima 自动发现/导入服务。ima 的现有受控只读 MCP 调用仍执行原授权检查。

## 对话与引用

每轮按实际阶段助手解析授权，读取管理员维护的知识库有效索引。学生无需选择库，项目无需绑定专属库。最多检索 20 个已授权手动库，工具结果最多 8 条；版本、成员、引擎配置或权限变化会阻止旧结果返回。知识不可用时保留普通对话能力，明确不能查证，不编造引用。

`knowledge_search` 只接受 `query`、可选 `topK`；`knowledge_read` 只接受 `citationId`。模型不能提交库 ID、路径、凭证或越权扩大范围。引用预览要求学生登录，传入项目上下文时检查项目归属，再重新解析助手权限。`GET /student/projects/:id/knowledge` 已移除。

## 文件与索引

管理员在知识库详情上传 PDF、DOCX、XLSX、PPTX、EPUB、TXT、Markdown、CSV/TSV、JSON/XML/YAML、HTML、RST、TeX；单文件不超过 10 MiB，每批最多 20 个。旧 DOC/XLS/PPT 须先转换，扫描件须先 OCR。正文超过 5 MiB、PDF 超过 500 页、加密、损坏、无正文或展开超限会失败，不创建成员或索引任务。

`POST /admin/knowledge/bases/:id/uploads` 使用 `{fileName,base64}` 和 `Idempotency-Key`；直接正文使用 `{title,content}`。原文件、真实校验和与正文保留；保存后异步构建索引。队列保留租约、栅栏、重试、取消、版本快照、实际校验和原子发布。失败不会替换已有有效索引。

LlamaIndex 使用固定 DeepTutor `6cf793bd868ba5ecbe64722936d4be8fab5a01df` 原始 pipeline。`embeddingModelRef` 必须引用模型目录中实际输出 `embedding` 的模型；普通聊天模型不能代替。其他引擎和连接器见 [知识引擎](./knowledge-engines.md)，配置成功不等于引擎就绪。

## 部署与验证

保留现有知识表及历史数据，无破坏式迁移。密钥仅从原模型注册表、服务端环境解析，不进入 JSON、Git 或日志。环境变量仍为 `QITU_KNOWLEDGE_WORKER`、`QITU_KNOWLEDGE_PYTHON`、`QITU_DEEPTUTOR_SOURCE`、`QITU_KNOWLEDGE_DATA`、`QITU_KNOWLEDGE_BRIDGE`。

管理员配置、目录和写操作仍需真实登录与角色校验；写操作需幂等键，配置需修订号。API 测试覆盖全局撤权、成员撤回、索引替换和历史任务取消。`tooling/verify-knowledge-local.cjs` 仅接受 `qitu_knowledge_verify_*` 隔离数据库，验证项目确认零知识写入、手动上传/索引、真实中文检索、原文引用、共享与授权撤销。不得使用生产库做测试夹具。
