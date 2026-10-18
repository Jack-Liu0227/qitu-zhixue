# 知识引擎管理与 DeepTutor 适配

管理员入口：模型与设置 → 知识中心 → 知识引擎。导航不变，采用启途蓝色、分组卡片和详情表单。图标来自 DeepTutor 原始资源，许可证及品牌来源位于 `apps/admin-console/public/knowledge-engine-icons/`。

## 来源与代码归属

本次参照 HKUDS/DeepTutor v1.6.14，固定提交 `6cf793bd868ba5ecbe64722936d4be8fab5a01df`。引擎目录、参数及 UI 交互参照其 `web/features/knowledge/components/engines/`，实际调用其 `deeptutor/services/rag/` 原始管线与客户端；原始 source 保留许可证。

- API：`services/api/src/modules/knowledge/knowledge-engine.catalog.ts` 定义无凭证目录、字段、分组及模式；同目录 service/adapters 负责模型解析、配置版本、预检和调度。
- Python：`integrations/deeptutor-knowledge/engine_runtime.py` 是私有单次进程桥接，不启动 DeepTutor HTTP 服务。
- 页面：`apps/admin-console/lib/components/knowledge-engines/`；沿用知识中心 API 与工具中心 JSON 配置写入接口。
- 引擎数据：运行环境 `QITU_KNOWLEDGE_DATA` 下按知识库和索引版本隔离。运行依赖、上游源码与数据留在 `services/knowledge/`，不提交密钥或运行产物。

## 引擎及行为

| 引擎 | 关键配置 | 实际后端行为 |
| --- | --- | --- |
| LlamaIndex | 嵌入模型、向量/BM25、重排、FAISS/HNSW、分块及图像并发 | 保留已验证的原始 RAGService 管线，真实嵌入请求预检 |
| PageIndex OSS | 索引与推理模型 | 官方本地 SDK，保留原始 PDF，索引后通过只读 SDK 工具推理读取 |
| GraphRAG | 聊天/嵌入模型、local/global/drift/basic、社区层级与选择 | 原始 GraphRAG 管线，文本单元与文件成员映射；无可验证出处的生成摘要不作为材料 |
| LightRAG | 基础/抽取/关键词/查询/视觉模型、模式及并发 | 原生 SDK、角色配置与模型快照；视觉模型未绑定时关闭视觉 |
| LightRAG Server | 服务地址、模式 | 原始 HTTP 客户端，认证状态与密钥检查，检索仅返回上下文 |
| PageIndex Cloud | 服务端凭证、推理读取模型 | 官方 Cloud SDK 发现读取工具验证认证；上传文档、构建索引，使用推理工具读取 |
| ima | MCP 连接引用、远端库白名单、原文收集授权 | 沿用现有 MCP 凭证；列库验证账户，关联时验证库 ID，检索受白名单限制 |
| WeKnora | 地址及远端库 ID | 原始 REST 客户端列库验证身份及资源，调用检索接口 |
| Obsidian | Vault 路径 | 仅检查服务器允许目录；同步使用现有知识来源流程，不把目录检查当成检索能力 |
| MarginNote | 已同步资料数据库、设备 ID | 原始 MarginNoteStore 检查设备活动状态、搜索同步笔记；设备采集及配对由插件完成 |
| Kiwix | 服务地址及 ZIM 名称 | 原始客户端列归档、检查目标、读取全文检索结果 |

PageIndex 在上游明确禁止普通 RAG search；适配器使用官方只读工具、最多 8 轮推理，从真实页面读取中形成命中，最终生成的回答不当作证据。OSS 仅接受有原始 PDF 的材料，缺少时返回 `PAGEINDEX_PDF_ORIGINAL_REQUIRED`。单次材料请求受 7 MiB 预算限制。

## 配置与管理

实例表单支持创建、命名、启用/关闭、参数编辑、模型绑定、预检和查看关联知识库。已有知识库详情继续承担上传、索引重建、同步及来源管理。远端资料以连接为主，未提供远端创建接口的服务明确拒绝创建。

表单与工具/MCP JSON 配置共用 `knowledgeEngines` 和同一带版本、幂等键、审计的保存 API；不新增独立配置源。保存前比较实例快照，拒绝覆盖其他页面的并发编辑。旧参数名兼容，修改单个字段后使用上游字段名。来源白名单 `null` 或空数组均不授权任何库。

模型下拉来自启途真实模型目录，仅返回名称、能力和可用状态；凭证由后端解析并经 stdin 传给子进程，不进入配置 JSON、浏览器或命令行。

## 安装与状态

迁入适配代码不代表所有引擎已安装或登录。每种依赖、模型、凭证和服务必须分别检查。未安装可选包显示「未安装」；缺凭证或模型显示待配置；未检查或配置版本变化后不沿用旧成功状态。

部署沿用 `QITU_KNOWLEDGE_PYTHON`、`QITU_DEEPTUTOR_SOURCE`、`QITU_KNOWLEDGE_DATA`、`QITU_KNOWLEDGE_BRIDGE`。额外服务凭证通过服务器环境提供：`QITU_LIGHTRAG_SERVER_API_KEY`、`QITU_WEKNORA_API_KEY`、`QITU_PAGEINDEX_CLOUD_TOKEN`（兼容 `QITU_PAGEINDEX_API_KEY`）。ima 保留当前 MCP 环境配置。

私有服务地址须登记到 `QITU_KNOWLEDGE_REMOTE_ORIGINS`，值为逗号分隔的协议、主机和端口；默认拒绝私网、回环和保留地址。目录须登记到 `QITU_KNOWLEDGE_FOLDER_ROOTS`。URL 不接受内嵌凭证、查询参数或 fragment。不要在 JSON 中填写 API key。

## 权限与验证

所有引擎配置、模型选项及检查接口仅限管理员。学生端依然按已有项目知识库权限检索，不因添加引擎扩大访问范围。新实例默认关闭，不自动绑定新模型或更改现有库。

验证包括 API 回归测试、配置非法字段/密钥/范围拒绝、ima MCP 元数据与库授权、真实 LightRAG HTTP 客户端协议、PageIndex 页面证据隔离、MarginNote 撤销设备、Python 模块边界、生产构建、管理员页面与未授权接口。外部引擎的端到端索引仍需真实服务、可选依赖和对应凭证，不能用依赖探测代替真实业务验收。
