# 知识中心：实现现状源码地图与剩余缺口（DeepTutor 参考方案）

> 状态：`implementation-map / 2026-10-18 对齐`
> 事实文档：[`../admin/knowledge-center.md`](../admin/knowledge-center.md)（已实现能力与运行配置的唯一事实源）
> 责任域：`services/api/src/modules/knowledge`、`integrations/deeptutor-knowledge`、`services/knowledge`、`apps/admin-console/app/(console)/settings/knowledge`
> 上级基线：[`../../AGENTS.md`](../../AGENTS.md)、[`../sdk/ima-knowledge.md`](../sdk/ima-knowledge.md)

本文件回答「知识中心的源码怎么写」：先给出**已经写好并合入的源码结构**（DeepTutor 参考方案在仓库中的真实落地形态），再列出对照用户需求（本地/云端知识库连接创建、知识库与助手绑定）尚需编写的缺口。不在任何位置声称未完成能力已交付。

## 1. 已落地的源码结构（按数据流）

```text
管理端 UI（/admin/settings/knowledge，双 Tab：知识库 / 知识引擎）
  apps/admin-console/app/(console)/settings/knowledge/page.tsx
        │  centerRequest() → /api/v1/admin/knowledge/*
        ▼
API 控制层（Nest，仅管理员，写接口带 Idempotency-Key，配置保存带 expectedRevision）
  services/api/src/modules/knowledge/knowledge-center.controller.ts
    GET/POST  knowledge/bases、bases/:id/files、rebuild、uploads、engines、engines/:id/check、jobs/:id
        ▼
中心服务与统一配置（platform_configuration_revisions 修订号并发控制，保存与审计同事务）
  knowledge-center.service.ts      # bases CRUD、files、rebuild、job/cancel、engines()（含健康检查+关联库）
  knowledge-center.config.ts       # ENGINE_CATALOG 引擎目录（DeepTutor 同款分组）+ 字段白名单校验
  knowledge-tool-catalog.service.ts# 工具目录（runtime/mcp/registry/legacy 四来源），绝不执行发现的工具
  knowledge-source.service.ts      # ima 来源发现（显式白名单、有限预算、许可撤销即生效）
  knowledge-source.policy.ts       # 来源选材策略：平台/同校/本人 + allowMaterialize；项目库不做其他项目的来源
        ▼
持久化队列（knowledge_jobs：数据库租约 + fencing_token + 阶段事件 + 有限重试 + 取消）
  knowledge-build.worker.ts        # QITU_KNOWLEDGE_WORKER=true 时每 3s tick；构建失败不替换已发布版本
        ▼
引擎执行层（私有进程适配器：无路径/凭证/上游诊断穿越 API）
  knowledge-engine.service.ts      # 只放行 llamaindex；embeddingModelRef → ModelRegistry 解析真 embedding 模型
        ▼
DeepTutor 固定版本桥（QITU_PIN=6cf793bd，每操作独立进程，stdin JSON，无网络监听）
  integrations/deeptutor-knowledge/bridge.py        # 复用上游 RAGService/LlamaIndex pipeline，按 kb/version 隔离工作区
  integrations/deeptutor-knowledge/extract_upload.py# 文件解析子进程（PDF/Office/EPUB/MD/CSV…，5MiB/500页上限，不静默截断）
  integrations/deeptutor-knowledge/local_embedding_server.py # 本地中文向量服务 bge-small-zh-v1.5 @127.0.0.1:4115
        ▼
存储（database/migrations/0028、0029）
  knowledge_bases / knowledge_base_members / knowledge_index_versions（version 化，原子发布）
  knowledge_jobs / knowledge_job_events / knowledge_engine_checks / project_knowledge_bindings
  knowledge_file_originals（原文件 bytea + SHA-256，与审计同事务）
        ▼
学生侧只读消费（对象级权限 + 撤权即失效）
  project-knowledge.controller.ts  # /student/projects/:id/knowledge、引用预览
  project-knowledge.service.ts     # project_knowledge_search / project_knowledge_read 工具
  knowledge.controller.ts          # /api/v1/knowledge/* 作用域检索（system/school/project/student 四作用域）
  knowledge.scope-authorizer.ts / knowledge.scope-policy.ts # 强对象级授权
```

### 1.1 引擎目录（ENGINE_CATALOG，与 DeepTutor 知识中心同构）

本地（LlamaIndex、PageIndex OSS、GraphRAG、LightRAG）、服务器（LightRAG Server）、云（PageIndex Cloud、Tencent ima、WeKnora）、外部（Obsidian、MarginNote 4、Kiwix/ZIM）。每个实例带健康检查（`knowledge_engine_checks`，真实向量请求才算通过）。

### 1.2 助手绑定（已实现的形态）

- `platformTools.project-knowledge.boundAssistants`：平台级「项目知识库检索」工具绑定到哪些助手（`knowledge-center.config.ts:28`，校验唯一性 ≤300）；每轮由 `KnowledgeCenterService.canRetrieve(assistantId)` 重新解析（工具启用 + 助手绑定 + 助手启用）。
- `project_knowledge_bindings`：正式项目确认事务内写入唯一的项目↔知识库绑定。
- ima 引擎的 `allowedKnowledgeBaseIds` + `allowMaterialize`：外源导入的库级白名单。
- 学生端没有选库控件；检索工具按当前项目绑定版本执行，结果返回前再次检查撤权。

## 2. 对照需求的剩余缺口（下一步要写的源码）

| 缺口 | 现状 | 需要写的代码 |
| --- | --- | --- |
| 云端知识库连接 | 目录已含 PageIndex Cloud / WeKnora / ima，但只有 ima 有适配；`knowledge-engine.service.ts` 对非 llamaindex 返回 `ENGINE_ADAPTER_NOT_READY`/`REASONING_RETRIEVAL_REQUIRED` | 在 `KnowledgeEngineService` 增加 cloud adapter（按引擎 provider 分派），凭证走 ModelRegistry/服务端 env，不得进 JSON 编辑器 |
| 本地引擎扩展（GraphRAG/LightRAG/PageIndex OSS） | 只有配置清单与未就绪说明 | bridge.py 增加 provider 分派（上游已含这些 pipeline），引擎字段白名单已在 config 中定义 |
| Link existing（Kiwix/Obsidian/MarginNote 面板） | 引擎在目录中，字段清单为空 | `KnowledgeSourceService` 增加连接器（kiwix-serve URL、vault 路径），就地读取不落库重建 |
| 文件夹挂载、GitHub/Web 来源与定时同步 | 未实现 | `knowledge-source.service.ts` + jobs 队列新 operation（sync），幂等同步 + 审计 |
| 知识库↔助手的逐库绑定 UI | 绑定存在（工具级 + 项目级 + ima 白名单），无通用「助手选库」界面 | 管理端知识库详情增加绑定面板，写 `platformTools`/引擎 config，复用 `canRetrieve` 校验链 |
| 默认库、移动、OCR、图像覆盖 | 未实现 | 后续任务，见 `../admin/knowledge-center.md`「尚未达到」清单 |

验收口径不变：只有真实向量模型绑定、引擎预检、原文索引和一次实际检索都通过，才可宣称引擎「可用」；未配置时明确失败，教学对话不得编造引用。

## 3. 运行与验证入口

- 环境变量与启动：`QITU_KNOWLEDGE_WORKER/PYTHON/DEEPTUTOR_SOURCE/KNOWLEDGE_DATA/KNOWLEDGE_BRIDGE`（见 `../admin/knowledge-center.md`）。
- 测试：`pnpm --filter @qitu/api test`；真实并发验收 `node tooling/verify-knowledge-center.cjs`（拒绝生产库名）；本地向量闭环 `tooling/verify-knowledge-local.cjs`；上传闭环 `QITU_KNOWLEDGE_VERIFY_UPLOAD_PATH` 指向 DOCX。
- 桥与解析器：`integrations/deeptutor-knowledge/test_bridge.py`、`test_extract_upload.py`。

## 4. 参考方案（DeepTutor 上游核实补充）

本节只记录可由上游固定版本或官方文档直接核实的事实；它不是本仓库已交付能力清单。上游代码证据固定在 DeepTutor commit `6cf793bd868ba5ecbe64722936d4be8fab5a01df`，本仓库当前适配器也声明了同一 pin（[`integrations/deeptutor-knowledge/UPSTREAM.md`](../../integrations/deeptutor-knowledge/UPSTREAM.md:3-9)）。

### 4.1 检索结果与来源状态

| 来源 | 结果 | 用途 |
| --- | --- | --- |
| `xAI / Grok` | 未成功：当前环境没有 SuperGrok/X Premium 会话，也没有 `XAI_API_KEY`；`web_search(provider: "xai")` 返回 `xAI search unavailable` | 按需求尝试的 provider，不能作为事实来源 |
| `exa` | 未返回 DeepTutor GitHub 结果 | 失败后的 provider fallback，不能作为事实来源 |
| DeepTutor Knowledge Center 官方文档 | 成功，https://docs.deeptutor.info/explore/knowledge/ | UI、引擎状态、创建/连接、面板、解析器、版本与 CLI |
| DeepTutor RAG 官方文档 | 成功，https://docs.deeptutor.info/ecosystem/rag-integration/ | 引擎分组、检索契约与依赖 |
| DeepTutor Partners 官方文档 | 成功，https://docs.deeptutor.info/explore/partners/ | Partner workspace、KB 分配粒度与 connected 指针语义 |
| 上游 `kb_types.py` | 成功，https://raw.githubusercontent.com/HKUDS/DeepTutor/6cf793bd868ba5ecbe64722936d4be8fab5a01df/deeptutor/knowledge/kb_types.py | connected flavour 完整清单与可检索性 |
| 上游 `linked_kb.py` | 成功，https://raw.githubusercontent.com/HKUDS/DeepTutor/6cf793bd868ba5ecbe64722936d4be8fab5a01df/deeptutor/services/rag/linked_kb.py | Link existing 可链接引擎、路径越界与 embedding 兼容性 |

### 4.2 KB 类型与 connected flavour 完整清单

DeepTutor 默认 KB 是 indexed：chunk → embed → retrieve，`type` 可以不存在。connected KB 是指针，数据在 `data/knowledge_bases` 之外，不复制、不重建。上游 `CONNECTED_KB_TYPES` 的完整集合是：

| `type` / flavour | 指针字段或外部对象 | 是否普通 `rag` 检索 | 上游语义 |
| --- | --- | --- | --- |
| `obsidian` | `vault_path` | 否 | Obsidian capability 导航实时 Markdown vault；无索引 |
| `linked` | `external_path` | 是（须绑定可兼容 provider） | 就地读取用户已构建的 LlamaIndex / GraphRAG / LightRAG 索引；跳过 indexing |
| `subagent` | `agent_kind`，可带 `cwd` 或 `partner_id` | 否 | 通过 `consult_subagent` 实时驱动本地 CLI 或用户自己的 Partner；不是文档检索库 |
| `lightrag_server` | `server_url`，可带 `api_key` | 是 | 对外部 LightRAG 的 `/query` 查询；不落本地索引 |
| `ima` | `client_id`、`api_key`、`knowledge_base_id` | 是 | 对 Tencent IMA `search_knowledge` OpenAPI 查询；一库对应一个 IMA library |
| `weknora` | `server_url`、`api_key`、`knowledge_base_id` | 是 | 查询自托管 WeKnora；文档不复制、不在本地建索引 |
| `marginnote4` | `device_id`，可带 `server_url` | 否 | 通过官方 Add-on API 同步到专用 SQLite/能力层工具；不是普通 RAG |
| `kiwix` | `server_url`、`zim_name` | 是 | 查询 `kiwix-serve` 的一个 ZIM；归档与索引留在服务端 |

上游还明确：所有 connected flavour 不在 `base_dir` 下创建本地 KB 目录，不参与 embedding reconcile，删除 DeepTutor 条目不得触碰外部资源；`external_root_of()` 只对 `linked`/`obsidian` 返回本地路径。`NON_RETRIEVABLE_KB_TYPES` 仅含 `obsidian`、`subagent`、`marginnote4`，所以「connected」不能等同于「不可检索」。以上均来自上游 `kb_types.py` 的 `CONNECTED_KB_TYPES`、`NON_RETRIEVABLE_KB_TYPES`、`supports_rag_retrieval()` 与 `external_root_of()`。

本仓库当前 `ENGINE_CATALOG` 已列出这些 provider（[`services/api/src/modules/knowledge/knowledge-center.config.ts`](../../services/api/src/modules/knowledge/knowledge-center.config.ts:3-15)），但 `knowledge-engine.service.ts` 当前只对 `llamaindex` 执行桥接，其余 provider 仍返回未就绪错误（[`services/api/src/modules/knowledge/knowledge-engine.service.ts`](../../services/api/src/modules/knowledge/knowledge-engine.service.ts:24-35)）。因此本节不把上游清单写成已实现。

### 4.3 引擎目录、四态和创建流程

官方 Knowledge Center 将引擎按 **Local / Server / Cloud / External knowledge sources** 分组。上游卡片在创建 KB 前展示四种状态：

| 状态 | 上游可核实含义 | 启途智学规格映射 |
| --- | --- | --- |
| `Ready` | 当前部署依赖、凭证与连接/安装条件满足，可以进入创建或连接流程 | 仅表示可开始预检，不等于某个 KB 已有有效索引 |
| `Needs key` | 需要的供应商密钥未配置 | 前端只显示缺少凭证状态，不显示密钥内容 |
| `Needs setup` | 依赖或远端目标尚未完成配置 | 显示下一步配置入口和稳定错误码 |
| `Not installed` | 可选本地包/能力未安装 | 不能创建为可用 KB |

上游新建流程的第一选择是 **Create new** 或 **Link existing**，随后选择名称、index engine、retrieval mode、storage workspace（account library 或 ready workspace）和文档。`PageIndex Cloud` 由托管服务接收上传；`LlamaIndex` 只有验证通过后才发布新索引。上述状态与流程来自官方 Knowledge Center 文档；本仓库现有创建接口目前只收 `name` 与 `engineInstanceId`（[`services/api/src/modules/knowledge/knowledge-center.service.ts`](../../services/api/src/modules/knowledge/knowledge-center.service.ts:313-344)），需按新规格扩展。

### 4.4 KB 面板与特殊面板矩阵

| 引擎/KB | 面板 Tab | 已核实功能 |
| --- | --- | --- |
| 普通 indexed KB | `Files` / `Add documents` / `Linked folders` / `GitHub` / `Web` / `Index versions` / `Settings` | 文件、解析状态、预览、Source visual coverage；来源同步；版本；embedding/chunking/检索参数、默认库和经审阅的 workspace 迁移 |
| `kiwix` | `Articles` / `Settings` | 通过 `kiwix-serve URL` 和一个 `zim_name` 连接；文章留在服务器 |
| `marginnote4` | `Devices` / `Settings` | 通过配对插件推送资料，不走普通文件上传 |
| `obsidian` | 外部能力导航 | live vault 指针；无本地索引 |
| `linked` | 普通检索面板 | 读取外部既有索引；不上传、不重建 |

版本目录是扁平 `version-N`，按 embedding signature 关联构建所用 embedding 与 LightRAG 模型；重建保留旧版。中断恢复会复用已验证的解析并重跑 embedding，取消等待安全边界。官方文档还明确：更换 embedding 模型必须重建，原生 LightRAG 发现模型不匹配时拒绝查询。当前仓库已有 `knowledge_index_versions`、发布栅栏和失败不替换旧版的实现（[`database/migrations/0028_knowledge_center.sql`](../../database/migrations/0028_knowledge_center.sql:25-40)、[`services/api/src/modules/knowledge/knowledge-build.worker.ts`](../../services/api/src/modules/knowledge/knowledge-build.worker.ts:219-252)），但来源面板和 connected 语义尚未交付。

### 4.5 文档解析引擎与安全默认

官方 Settings → Knowledge Base → Document Parsing 的清单为：

| 解析器 | 上游事实 |
| --- | --- |
| Text-only | 内建；纯文本抽取；无额外包和模型 |
| MinerU | 多模态布局/表格/公式；本地 CLI 可下载模型，也可用云 API |
| Docling | 结构化布局/表格；本地模型或远端 Docling Serve |
| Tika | 仅远端 Apache Tika server；无本地安装和模型 |
| markitdown | 轻量、无下载、广格式转 Markdown |
| PyMuPDF4LLM | 轻量、无 CUDA；PDF、电子书、XPS、图片、文本和 Markdown |
| LiteParse | 轻量结构化解析；无本地模型下载 |

**本地模型下载默认关闭，必须得到显式许可。** 这条是安全默认，不因解析器显示为 `Ready` 而自动下载。仓库当前上传链路实际复用固定 DeepTutor 文本抽取，并明确不做 OCR（[`docs/admin/knowledge-center.md`](../admin/knowledge-center.md:69-77)），所以解析器清单只是参考事实，不是已实现清单。

### 4.6 KB ↔ Partner/agent 的真实粒度

官方 Partners 文档描述的粒度是 **Partner workspace**，不是一个全局 assistant-to-KB 布尔开关：

1. Partner 有独立的 `data/partners/<partner_id>/workspace/`，存放其 soul、复制的 KB、skills、notebooks 和 memory；channel runtime 在旁边的 `channels/<channel>/`。
2. Library 步骤可以给 Partner 分配多个 KB；普通 KB 在 assignment 时复制进 Partner workspace，connected KB 没有可复制目录，因此注册其 pointer 并保持外部实时来源。
3. 官方明确 Obsidian、MarginNote、subagent bases 在 Partner Library 分配时被拒绝；普通 KB 是 copy，connected KB 是 pointer。
4. Home 的 KB selector 是会话级 sticky context，可以一次附加一个或多个 KB；这与 Partner 的 workspace 级 Library 分配不同。

上游官方说明了 workspace/assignment 的行为，但本次可访问材料没有给出公开的 SQL/ORM 表名。**DeepTutor Partner 与 KB 的内部持久化表结构：未证实。** 启途智学不能据此伪造上游表结构；本仓库应以自身 `admin_assistants`、`tutor_partners`、`agent_configs` 和知识中心表为事实源（[`packages/database/src/schema/admin-ai-config.ts`](../../packages/database/src/schema/admin-ai-config.ts:18-56)、[`packages/database/src/schema/tutor-workspace.ts`](../../packages/database/src/schema/tutor-workspace.ts:6-19)、[`database/migrations/0015_agent_runtime_bindings.sql`](../../database/migrations/0015_agent_runtime_bindings.sql:1-37)）。

实现上的对应关系和数据迁移方案见新文档 [`20261018-knowledge-center-gap-spec.md`](./20261018-knowledge-center-gap-spec.md)。

本文件不重复实现细节；能力边界、部署与回滚以 `../admin/knowledge-center.md` 为准。
