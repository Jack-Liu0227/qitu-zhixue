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

本文件不重复实现细节；能力边界、部署与回滚以 `../admin/knowledge-center.md` 为准。
