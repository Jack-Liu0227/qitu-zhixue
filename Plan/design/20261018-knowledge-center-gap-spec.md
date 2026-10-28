# 知识中心缺口：本地/云端连接创建与助手绑定实施规格

> 状态：`implementation-spec / 2026-10-18`
> 责任域：后端 `services/api/src/modules/knowledge`、`integrations/deeptutor-knowledge`、数据库迁移；管理端 `apps/admin-console/app/(console)/settings/knowledge`。
> 上级基线：[`../../AGENTS.md`](../../AGENTS.md)、[`../README.md`](../../docs/README.md)、[`../admin/knowledge-center.md`](../../docs/admin/knowledge-center.md)、[`20261018-knowledge-center-deeptutor-reference.md`](./20261018-knowledge-center-deeptutor-reference.md)。

本规格只定义需求 2 的可实施边界：支持本地与云端知识库的连接和创建、来源同步、知识库与助手/Partner 绑定。它是待实现规格，不把建议字段、接口或 UI 当作已实现事实。当前唯一事实源仍是 [`docs/admin/knowledge-center.md`](../../docs/admin/knowledge-center.md)；本文件不替代它，也不要求本任务修改它。

> 2026-10-19 对齐说明：本文件的现状表、行号和后续方案是 2026-10-18 需求拟定时的对照记录，部分已由管理员手动知识库与多引擎实现替代，不是当前功能缺口清单。项目自动建库/导入路径已退役；当前 API、授权与实现状态以 [`../admin/knowledge-center.md`](../../docs/admin/knowledge-center.md) 和 [`../admin/knowledge-engines.md`](../../docs/admin/knowledge-engines.md) 为准。冻结项目 IMA grant 等新增治理要求以 [`../plan/codex/theme-session-team-ima-design.md`](../codex/theme-session-team-ima-design.md) 为准，不把旧项目绑定或桥接白名单当成项目授权。

## 1. 事实与取舍

### 1.1 检索报告

用户要求使用 `grok / xAI`。本次已调用 `web_search(provider: "xai")`，但环境没有 SuperGrok/X Premium 登录或 `XAI_API_KEY`，provider 返回 `xAI search unavailable`，因此 **未成功使用 xAI/Grok**。随后调用 `exa`，没有返回 DeepTutor GitHub 结果。最终采用可直接核验的 DeepTutor 官方文档和固定 commit 的 raw/API URL；不把 xAI 或 exa 的失败结果当作证据。

关键上游来源：

| 来源 | 证据范围 |
| --- | --- |
| [Knowledge Center](https://docs.deeptutor.info/explore/knowledge/) | 双 Tab、四态、Create new/Link existing、面板 Tab、来源、版本、解析器、安全默认、CLI |
| [RAG Integration](https://docs.deeptutor.info/ecosystem/rag-integration/) | Local/Server/Cloud/External 分组、各引擎检索契约和依赖 |
| [Partners](https://docs.deeptutor.info/explore/partners/) | `data/partners/<id>/workspace`、Library assignment 的 copy/pointer 粒度、连接器排除项 |
| [`kb_types.py`](https://raw.githubusercontent.com/HKUDS/DeepTutor/6cf793bd868ba5ecbe64722936d4be8fab5a01df/deeptutor/knowledge/kb_types.py) | `obsidian`、`linked`、`subagent`、`lightrag_server`、`ima`、`weknora`、`marginnote4`、`kiwix` 完整 connected 集合及 `supports_rag_retrieval` |
| [`linked_kb.py`](https://raw.githubusercontent.com/HKUDS/DeepTutor/6cf793bd868ba5ecbe64722936d4be8fab5a01df/deeptutor/services/rag/linked_kb.py) | 可链接 provider、PageIndex Cloud 不可从本地文件夹链接、路径 root allowlist、ready index 和 embedding 兼容性 |

### 1.2 当前仓库基线

以下是仓库内可定位的现状，不是推测：

| 现状 | 证据 | 对规格的影响 |
| --- | --- | --- |
| 引擎目录已有 LlamaIndex、PageIndex OSS、GraphRAG、LightRAG、LightRAG Server、PageIndex Cloud、ima、WeKnora、Obsidian、MarginNote、Kiwix | [`knowledge-center.config.ts`](../../services/api/src/modules/knowledge/knowledge-center.config.ts#L3-L15) | 扩展已有 provider，不另造第二个目录 |
| 配置字段已做白名单；当前云/外部 provider 的字段为空 | [`knowledge-center.config.ts`](../../services/api/src/modules/knowledge/knowledge-center.config.ts#L40-L86) | 云连接字段放受控连接记录，不能借 JSON 编辑器绕过白名单 |
| `KnowledgeEngineService.execute` 目前只执行 `llamaindex`，其他 provider 返回未就绪错误 | [`knowledge-engine.service.ts`](../../services/api/src/modules/knowledge/knowledge-engine.service.ts#L24-L35) | 先扩展 adapter dispatch，再开放创建/连接按钮 |
| bridge 当前固定导入 `RAGService`，固定 `provider="llamaindex"` | [`bridge.py`](../../integrations/deeptutor-knowledge/bridge.py#L29-L50) | 必须按 provider 分派并对 request/config 做字段白名单 |
| 已有 `knowledge_jobs` 租约、fencing token、阶段事件、取消和有限重试 | [`knowledge-build.worker.ts`](../../services/api/src/modules/knowledge/knowledge-build.worker.ts#L31-L104) | `sync` 复用 durable queue，不新增第二个任务系统 |
| 已有版本验证后原子发布，并在发布事务再次检查来源授权 | [`knowledge-build.worker.ts`](../../services/api/src/modules/knowledge/knowledge-build.worker.ts#L219-L252) | 来源同步必须先生成候选版本，成功后才替换活动版本 |
| 现有库表、项目绑定、版本和任务表来自 `0028`；原文件表来自 `0029` | [`0028_knowledge_center.sql`](../../database/migrations/0028_knowledge_center.sql#L7-L45)、[`0029_knowledge_file_uploads.sql`](../../database/migrations/0029_knowledge_file_uploads.sql#L1-L12) | 新能力需要新迁移；不得把外部凭证塞入现有 `origin` 或 `config_snapshot` |
| `canRetrieve(assistantId)` 当前检查平台工具开关、assistant allowlist、assistant enabled | [`knowledge-center.service.ts`](../../services/api/src/modules/knowledge/knowledge-center.service.ts#L248-L257) | 新逐库绑定必须是此链条的额外 AND 条件，不能旁路 |
| 旧 `project-knowledge.service.ts` 已退役；当前引用入口检查项目归属，检索层执行助手/知识库权限与有效性复查 | [`knowledge-retrieval.controller.ts`](../../services/api/src/modules/knowledge/knowledge-retrieval.controller.ts)、[`knowledge-retrieval.service.ts`](../../services/api/src/modules/knowledge/knowledge-retrieval.service.ts) | 不恢复自动项目建库；冻结项目 grant 的接线另按当前治理合同验收 |
| 当前管理端只有知识库/知识引擎双 Tab、文件与重建操作 | [`settings/knowledge/page.tsx`](../../apps/admin-console/app/(console)/settings/knowledge/page.tsx#L29-L115) | 在既有知识库详情中增加来源、连接状态和绑定面板，不改变顶层导航 |

### 1.3 设计取舍

1. **连接与创建是两种命令。** `create_new` 表示由启途智学拥有或托管索引生命周期；`link_existing` 表示只保存外部指针并就地检索。两者不能通过一个布尔字段隐式切换。
2. **外部资源不复制、不重建。** connected flavour 的删除只解除本地指针；不能删除 vault、远端 KB、ZIM 或 MarginNote 数据。
3. **配置与凭证分离。** JSON 编辑器只允许 provider、模式、数值参数、模型稳定引用、非敏感远端 ID；凭证通过 ModelRegistry 的受保护模型/服务配置或服务端环境解析。前端永远不能提交密钥，也不能读取密钥回显。
4. **状态与可用性分离。** `Ready` 只是允许创建/连接的前置状态；某个 KB 必须通过真实预检、创建/连接、原文或远端资料验证、一次真实检索后才能标记 `ready`。
5. **绑定采用授权交集。** 全局工具授权、逐库助手绑定、项目对象权限和 provider/source 白名单都满足时才允许检索；任何一层撤权，下一次检索立即失败或返回无证据。
6. **Partner 采用本仓库运行时身份。** DeepTutor 只公开了 Partner workspace 的 assignment 粒度，没有公开 SQL 表结构，故不复制上游表名。启途智学以 `admin_assistants`、`tutor_partners`、`agent_configs` 的稳定 ID 做绑定目标，并由服务端校验目标存在和可用。

## 2. 领域模型与迁移

### 2.1 新迁移

新增 `database/migrations/0030_knowledge_connections_sources_bindings.sql`，并提供同名 `.down.sql`。这是**需要新迁移**的变更；不修改 `0028`、`0029`。数据库 schema 包装层同步修改 `packages/database/src/schema/knowledge.ts` 或实际承载知识中心表的现有 schema 文件，文件名以 agent 开工时仓库实际路径为准；不得新增第二套数据库访问模型。

建议迁移内容如下，字段名是实施合同，`jsonb` 内容必须由服务端 schema 校验：

#### `knowledge_base_connections`

一条 KB 最多一条连接记录，indexed 本地 KB 可没有该记录。

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| `id` | `text PK` | 服务端生成 |
| `kb_id` | `text NOT NULL UNIQUE FK knowledge_bases` | 对象归属 |
| `flavour` | `text NOT NULL` | `obsidian`、`linked`、`subagent`、`lightrag_server`、`ima`、`weknora`、`marginnote4`、`kiwix` |
| `provider` | `text NOT NULL` | 与 `ENGINE_CATALOG` provider 一致 |
| `external_ref` | `jsonb NOT NULL` | 仅非敏感引用：经规范化的路径/URL、远端 KB ID、ZIM 名、device ID 的不可逆摘要；禁止 token/key/password/cookie |
| `credential_ref` | `text` | 服务端注册的 opaque 引用；不能是密钥值；审计只记录 ref 的 hash |
| `status` | `text NOT NULL` | `unconfigured`、`probing`、`ready`、`stale`、`unreachable`、`unauthorized`、`revoked`、`unsupported`、`error` |
| `last_check_at` | `timestamptz` | 最近预检时间 |
| `last_error_code` | `text` | 稳定错误码，不写上游原始 body |
| `created_at`/`updated_at` | `timestamptz` | 服务端时间 |

`external_ref` 的 provider 字段白名单：

| flavour | 允许字段 |
| --- | --- |
| `obsidian` | `vaultPath`（必须通过服务端 root allowlist 和 symlink realpath 校验） |
| `linked` | `externalPath`、`ragProvider`、`indexVersion`、`embeddingSignature` |
| `lightrag_server` | `serverUrl`、`workspace`；API key 只在 `credential_ref` |
| `ima` | `remoteKnowledgeBaseId`、`clientId`（如需展示只返回脱敏/摘要）；token 只在服务端连接 |
| `weknora` | `serverUrl`、`remoteKnowledgeBaseId`；API key 只在 `credential_ref` |
| `marginnote4` | `deviceId`、可选 `serverUrl`；配对凭证只在服务端 |
| `kiwix` | `serverUrl`、`zimName` |
| `subagent` | `agentKind`、可选 `cwd` 或 `partnerId`；不得将 CLI command 写入此表 |

#### `knowledge_sources`

来源是 KB 内的同步输入，不等同于 connected KB 指针。

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| `id` | `text PK` | 服务端生成 |
| `kb_id` | `text NOT NULL FK` | 所属 indexed KB |
| `kind` | `text CHECK(folder,github,web)` | 来源类型 |
| `source_config` | `jsonb NOT NULL` | 非敏感路径/repo/branch/path/glob/URL/depth/page limit |
| `credential_ref` | `text` | GitHub 私有仓库等的服务端 opaque ref |
| `schedule_hours` | `integer NULL CHECK 1..168` | `NULL` 表示仅手动同步；范围与上游 Web 频率约束一致 |
| `next_sync_at`/`last_sync_at` | `timestamptz` | 调度状态 |
| `last_source_revision` | `text` | ETag/commit/tree hash 等不含秘密的版本标识 |
| `status` | `text NOT NULL` | `active`、`paused`、`syncing`、`stale`、`failed`、`revoked` |
| `last_error_code` | `text` | 稳定错误码 |
| `created_by` | `text NOT NULL` | 审计主体 |
| `created_at`/`updated_at` | `timestamptz` | 服务端时间 |

同一 KB 内以 `unique(kb_id, kind, source_fingerprint)` 防止重复来源；fingerprint 由服务端规范化后计算，不能由客户端指定。

#### `knowledge_sync_runs`

用于审计和幂等查询，实际执行仍由现有 `knowledge_jobs` 完成。

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| `id` | `text PK` | 与 job 关联 |
| `source_id` | `text NOT NULL FK` | 来源 |
| `idempotency_key` | `text NOT NULL` | 客户端 key 经作用域化；定时任务使用服务端生成 key |
| `request_hash` | `text NOT NULL` | 重放一致性 |
| `budget_snapshot` | `jsonb NOT NULL` | files/bytes/pages/depth/time 上限，不含正文 |
| `state` | `text NOT NULL` | `queued`、`running`、`ready`、`failed`、`cancelled` |
| `discovered_count`/`accepted_count`/`rejected_count` | `integer` | 统计 |
| `bytes_read`/`pages_read` | `bigint`/`integer` | 预算计量 |
| `error_code` | `text` | 稳定错误码 |
| `created_at`/`updated_at` | `timestamptz` | 服务端时间 |

增加 `knowledge_jobs.source_id NULL`、`knowledge_jobs.request_hash NULL` 和 `knowledge_jobs.budget_snapshot NOT NULL DEFAULT '{}'`；保留原有 `(kb_id, operation, input_revision)` 唯一约束，另加 `unique(source_id, request_hash)`（`source_id` 非空时）。`operation` 增加受控值 `sync`，不接受任意 operation 字符串。

#### `knowledge_base_agent_bindings`

逐库授权的唯一写模型。建议字段：

| 字段 | 类型/约束 | 语义 |
| --- | --- | --- |
| `kb_id` | `text NOT NULL FK` | 知识库 |
| `agent_kind` | `text CHECK(admin_assistant,tutor_partner,runtime_agent)` | 绑定目标类别 |
| `agent_id` | `text NOT NULL` | 稳定目标 ID；服务端按 kind 查询对应表/注册表 |
| `mode` | `text CHECK(retrieve,materialize)` | `retrieve` 只允许远程/当前 KB 检索；`materialize` 允许进入项目资料派生流程 |
| `enabled` | `boolean NOT NULL DEFAULT true` | 撤权即失效 |
| `revision` | `integer NOT NULL DEFAULT 1` | 并发控制 |
| `created_by`/`updated_by` | `text NOT NULL` | 审计主体 |
| `created_at`/`updated_at` | `timestamptz` | 服务端时间 |

主键为 `(kb_id, agent_kind, agent_id, mode)`。不在此表保存 prompt、模型、渠道 token 或原文。`agent_id` 的存在性和 enabled 状态必须在后端事务中校验；禁止只凭前端列表写入。

### 2.2 绑定统一规则

1. `platformTools.project-knowledge.enabled` 与现有 `boundAssistants` 是平台能力门槛，继续保留；它们不被逐库绑定替换。
2. 新增 `KnowledgeCenterService.canRetrieve(assistantId, knowledgeBaseId?)`：无 `knowledgeBaseId` 时保持现有行为；有 KB 时先执行现有全局检查，再检查 `knowledge_base_agent_bindings.enabled=true`。所有项目检索、通用助手检索和远端 adapter 查询统一调用它。
3. `project_knowledge_bindings` 现仅作历史记录，不授予当前检索权限，不因创建/确认项目自动建库。当前引用入口和检索实现分别见 [`knowledge-retrieval.controller.ts`](../../services/api/src/modules/knowledge/knowledge-retrieval.controller.ts)、[`knowledge-retrieval.service.ts`](../../services/api/src/modules/knowledge/knowledge-retrieval.service.ts)；冻结项目 grant 的范围不能由旧表或助手全局绑定代替。
4. ima 的 `allowedKnowledgeBaseIds` 是远端来源白名单，`allowMaterialize` 是是否允许复制原文；新逐库绑定不能扩大这两个范围。若 `mode=materialize`，三者必须同时满足：助手逐库授权、ima 远端 ID 白名单、服务端物化许可。
5. `tutor_partners`/`agent_configs` 目标必须经过运行时身份映射；不能因为 Partner 拥有一条 memory 或 session 就自动获得所有 KB。Partner 会话的检索调用仍传入稳定的 assistant/partner ID，并经过同一 `canRetrieve` 链。
6. 未成年人资料默认只在其所属学生/项目/学校对象范围内可见；逐库绑定列表不得返回其他学生原文、source 内容或密钥。绑定变更写服务端审计，客户端不能写审计记录。

## 3. API 合同

所有新接口均在 `/api/v1/admin/knowledge` 下，仅管理员可调用。前端权限只控制显示，后端每次按对象重新校验。所有写接口要求 `Idempotency-Key`；同 key 不同 request hash 返回 `409 IDEMPOTENCY_CONFLICT`，同 key 同 hash 返回第一次结果，不重复创建任务或审计。响应不返回密钥、Authorization header、cookie、上游原始诊断、绝对服务器路径或未脱敏未成年人正文。

### 3.1 引擎 readiness

`GET /engines` 保留现有响应，新增每个 instance 的：

```json
{
  "id": "pageindex-main",
  "provider": "pageindex",
  "configurationStatus": "ready",
  "health": {
    "status": "ready|needs_key|needs_setup|not_installed|unavailable",
    "errorCode": null,
    "checkedAt": "2026-10-18T00:00:00.000Z",
    "capabilities": {"create": true, "connect": true, "search": true, "materialize": false}
  }
}
```

四态判定：

| 状态 | 判定条件 |
| --- | --- |
| `ready` | adapter 已安装/启用；所需 credential ref 可解析；endpoint/tenant/远端配置完整；服务端 bounded preflight 成功。对向量引擎还必须真实调用 embedding；对远端引擎必须真实调用最小查询或 capabilities 接口 |
| `needs_key` | 所需 credential ref 不存在、已撤销或服务端 env 未配置；只返回状态，不暴露缺哪一段秘密 |
| `needs_setup` | 凭证存在但 endpoint、workspace、remote KB、ZIM、device pairing、模型引用或本地 root 未完成；连接失败可归入该态，错误码必须稳定 |
| `not_installed` | adapter/package/运行时能力不在服务端 allowlist 或依赖检测失败；绝不接受客户端上传 package/command |

`POST /engines/:id/check` 继续要求 `Idempotency-Key`，返回上述状态、能力和稳定错误码。只有 `status=ready` 才允许相应的 Create/Link action；`ready` 仍不代表已有某个 KB 可检索。

### 3.2 创建与连接知识库

保留现有 `POST /bases` 的兼容字段，同时扩展为：

```json
{
  "name": "数学教材",
  "engineInstanceId": "pageindex-main",
  "mode": "create_new|link_existing",
  "retrievalMode": "hybrid|global|local|basic|naive|agentic",
  "storageWorkspaceRef": "account-library|ready-workspace-id",
  "connection": {
    "externalPath": "/allowlisted/path/index",
    "serverUrl": "https://example.invalid",
    "remoteKnowledgeBaseId": "remote-id",
    "zimName": "wikipedia_zh_all_maxi_2024-06.zim",
    "deviceId": "device-id"
  }
}
```

实际允许字段由 `provider + mode` 决定；`connection` 中不允许 `apiKey`、`token`、`password`、`cookie`、任意 command、任意 Python module 或未登记 `credentialRef`。服务端忽略/拒绝未知字段，不做静默降级。

响应：

```json
{
  "id": "kb-...",
  "name": "数学教材",
  "mode": "create_new",
  "flavour": null,
  "state": "unindexed|probing|ready|failed",
  "engineInstanceId": "pageindex-main",
  "activeIndexVersionId": null,
  "connection": {"status": "not_applicable|probing|ready|unreachable|..."},
  "jobId": "job-..."
}
```

失败码：`ENGINE_NOT_READY`、`ENGINE_NEEDS_KEY`、`ENGINE_NEEDS_SETUP`、`ENGINE_NOT_INSTALLED`、`LINKED_PATH_NOT_ALLOWED`、`LINKED_INDEX_NOT_READY`、`EMBEDDING_SIGNATURE_MISMATCH`、`REMOTE_RESOURCE_NOT_FOUND`、`REMOTE_CREATE_UNSUPPORTED`、`REMOTE_CONNECTION_FAILED`、`CONFIG_REFERENCE_INVALID`、`IDEMPOTENCY_CONFLICT`。

`Link existing` 先调用 `POST /bases/link-probe`，请求为 `{provider, externalPath}` 或对应 remote ref，响应给出 `ok`、`provider`、`version`、`docCount`、`embedding.compatible`、`warnings`、稳定 `errorCode`。Probe 失败时不能创建指针。上游明确 PageIndex Cloud 不能从本地 folder link；本地 link 首期仅允许 LlamaIndex、GraphRAG、LightRAG，路径必须在服务端 allowlist 内且 realpath 后仍在 allowlist 内，这与上游 [`linked_kb.py`](https://raw.githubusercontent.com/HKUDS/DeepTutor/6cf793bd868ba5ecbe64722936d4be8fab5a01df/deeptutor/services/rag/linked_kb.py) 一致。

### 3.3 外部来源与同步

`GET /bases/:id` 在现有 files/versions/jobs 外增加 `connection`、`sources`、`bindings`，均为脱敏摘要。

新增：

- `POST /bases/:id/sources`：创建 folder/GitHub/Web 来源。请求只含非敏感 source config 和可选服务端已登记的 credential ref；返回 source、预算和 `jobId=null`。
- `PATCH /bases/:id/sources/:sourceId`：修改来源或暂停；修改后 `source_revision` 增加，旧活动索引不被删除。
- `POST /bases/:id/sources/:sourceId/sync`：手动入队 `operation=sync`，必须有 `Idempotency-Key`；返回既有 job 以实现重放。
- `POST /jobs/:id/cancel`：复用现有取消合同；sync 只在安全边界取消，不发布半成品。

同步请求可带 `{reason:"manual|schedule", expectedSourceRevision}`；服务器把预算快照写入 `knowledge_sync_runs`，不接受客户端提高上限。响应必须返回 `discovered/accepted/rejected/bytes/pages` 和 `state`，不能返回整批原文。

### 3.4 逐库助手/Partner 绑定

新增：

- `GET /bases/:id/bindings`：返回已绑定的 agent 摘要、`agentKind`、`agentId`、`mode`、`enabled`、revision；不返回学生原文或密钥。
- `PUT /bases/:id/bindings`：请求 `{expectedRevision, bindings:[{agentKind,agentId,mode,enabled}]}`，服务端完整替换该 KB 的授权集合；空数组表示撤销全部逐库授权。必须验证目标存在、KB 可见、项目库不能被无关对象绑定。
- `POST /bases/:id/bindings/:agentKind/:agentId/revoke`：可选的显式撤权快捷接口，仍需幂等键；与 PUT 使用同一事务和审计动作。

响应返回 `bindingRevision`、当前集合和 `effective` 判定，不返回客户端可直接写入的 audit ID。错误码：`AGENT_NOT_FOUND`、`AGENT_DISABLED`、`KNOWLEDGE_BINDING_NOT_ALLOWED`、`KNOWLEDGE_BINDING_CONFLICT`、`CAPABILITY_NOT_AUTHORIZED`、`CONFIG_REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`。

## 4. Adapter 实施规格

### 4.1 云端 PageIndex Cloud / WeKnora / Tencent ima

在 `knowledge-engine.service.ts` 中增加服务端 adapter registry，禁止按客户端传入的字符串动态 import：

```text
provider pageindex  -> PageIndexCloudAdapter
provider weknora   -> WeKnoraAdapter
provider ima       -> ImaAdapter（统一现有 ImaMcpClient 与 source policy）
provider lightrag-server -> LightRagServerAdapter
local providers    -> bridge.py adapter
```

统一接口：

```ts
interface KnowledgeEngineAdapter {
  readiness(): Promise<ReadinessReceipt>;
  check(input: CheckInput): Promise<EngineReceipt>;
  create(input: CreateInput): Promise<RemoteCreateReceipt>;
  connect(input: ConnectInput): Promise<RemoteConnectReceipt>;
  search(input: SearchInput): Promise<EngineReceipt>;
  detach(input: DetachInput): Promise<void>;
}
```

`create`/`connect` 能力由 adapter manifest 声明，未声明就返回 `REMOTE_CREATE_UNSUPPORTED`，不创建一个看似成功但无法查询的 KB。根据当前可核实的上游材料：PageIndex Cloud 已证实 hosted upload + agentic traversal，可实现 `create_new`；WeKnora 已证实连接已有自托管 KB，ima 已证实访问已有 library，二者的远端“创建空库”API 契约在本次上游材料中**未证实**，首期不得编造 endpoint。它们可以先实现 `connect`；要支持远端 create，必须先补 provider 官方 API/SDK 证据和 adapter contract test。

**凭证解析：**

- `ModelRegistryService` 负责 `embeddingModelRef`、`llmModelRef` 等模型引用和模型 provider 的运行时 target；现有校验已经要求模型引用存在（[`knowledge-center.service.ts`](../../services/api/src/modules/knowledge/knowledge-center.service.ts#L137-L173)）。
- provider API credential 只能通过服务端登记的 `credential_ref` 或部署环境读取。现有 ima 连接已从 `QITU_IMA_MCP_URL`、`QITU_IMA_MCP_TOKEN` 判定 credentialConfigured（[`services/api/src/modules/platform-registry/ima-settings.service.ts`](../../services/api/src/modules/platform-registry/ima-settings.service.ts#L46-L51)）；新 adapter 延续这一服务端路径。
- API 调用在进程内短暂持有 secret；不写 `platform_configuration_revisions.config`、`knowledge_*` 的 JSON、审计 detail、job event、stdout/stderr、浏览器响应、Git 或日志。
- 任何前端 JSON editor 提交 `apiKey`/`token`/`password` 都返回 `CONFIG_SECRET_FORBIDDEN`。如未来需要录入凭证，必须做独立的服务端受保护登记流程，成功后前端只得到 `credentialConfigured: true`。

**云端状态验收：**

| provider | `Ready` 必须通过 | `create_new` | `link_existing`/connected |
| --- | --- | --- | --- |
| PageIndex Cloud | adapter/package、credential、tenant/workspace、最小 capabilities 或 dry-run 上传检查 | 上传至少一份受控原文，远端返回 KB/document ref，再执行一次 agentic retrieval | 不接受本地 `externalPath` link；远端已有对象的连接能力需 provider API 证据 |
| WeKnora | endpoint、credential、remote KB ID、一次 bounded search | 仅在官方 create API/SDK contract test 具备后开放；否则稳定返回 `REMOTE_CREATE_UNSUPPORTED` | 保存 `serverUrl + remoteKnowledgeBaseId`，原文不复制，实际 query 成功才 ready |
| Tencent ima | 已登记 MCP/HTTP bridge、credential、远端 KB 白名单、`ima_list_knowledge_bases` 和 bounded search | 本次材料未证实远端建库 API；暂不宣称支持，保留 Qitu indexed create 作为独立本地库路径 | 复用现有来源白名单；搜索成功且撤权即时失效 |

三类云端卡片的四态落地判定必须逐 provider 实现，不能只用“配置对象存在”代替：

| provider | `Ready` | `Needs key` | `Needs setup` | `Not installed` |
| --- | --- | --- | --- | --- |
| PageIndex Cloud | Cloud adapter 已安装，服务端 credential 可解析，workspace/tenant 已绑定，最小 hosted capability 或受控上传+检索通过 | PageIndex credential ref 或服务端环境凭证不存在/已撤销 | credential 有效但 workspace、tenant、上传策略或远端能力检查未完成 | PageIndex Cloud adapter/allowlisted runtime 不存在 |
| WeKnora | adapter 已安装，server URL、credential、remote KB ID 完整，bounded search 成功 | WeKnora API key/credential ref 不存在或已撤销 | endpoint、remote KB ID、TLS/租户配置或服务端健康检查不完整/失败 | WeKnora adapter 或其 allowlisted HTTP capability 不存在 |
| Tencent ima | 现有服务端 MCP/HTTP bridge 已登记，服务端 credential 可用，远端白名单可读，list + bounded search 成功 | `QITU_IMA_MCP_TOKEN` 或受保护 credential 不存在/已撤销 | `QITU_IMA_MCP_URL`、MCP registration、远端 KB 白名单或工具能力未完成 | ima bridge/MCP 服务未注册或部署未启用 |

### 4.2 本地 GraphRAG / LightRAG / PageIndex OSS / LightRAG Server

`integrations/deeptutor-knowledge/bridge.py` 改为静态 provider dispatch：

1. 先校验 request 的 `operation`、`provider`、`kbId`、`versionId`、成员 ID、`allowedMemberIds` 和 `config` 的字段集合；未知字段、绝对路径穿透、任意模块名、任意 command 一律失败。
2. `llamaindex` 保留现有真实 embedding、build 后 test search 和 allowed member filter。
3. `graphrag` 分派 GraphRAG 本地 pipeline；`mode` 仅允许 `local/global/drift/basic`，`response_type`、`community_level`、`dynamic_community_selection` 来自服务端白名单；build 必须生成版本 manifest 并执行一次真实查询。
4. `lightrag` 分派本地 graph+vector pipeline；`mode` 仅允许 `naive/local/global/hybrid/mix`；`baseModelRef`、`extractModelRef`、`keywordModelRef`、`queryModelRef`、`vlmModelRef` 先由 API 通过 ModelRegistry 解析为运行时 target，bridge 不接收裸 token。
5. `pageindex-oss` 分派 agentic document-tree pipeline；它不是普通向量 RAG，不能以“embedding 预检通过”替代页面遍历和页级引用验证。其检索失败必须返回 `REASONING_RETRIEVAL_REQUIRED` 或更具体的稳定错误，不能退回关键词搜索。
6. `lightrag-server` 不在 bridge 建索引；由 Node adapter 通过已登记 `serverUrl` 和服务端 credential 调用远程 `/query`，结果必须映射到 `EngineHit` 并保留远端 locator；remote server 的 API key 不进入 bridge JSON。
7. 所有 provider 的 `check` 需达到真实能力标准：依赖 import、真实模型/远端调用、最小索引或 query、结果结构校验。不能仅以包安装状态或配置存在标记 ready。

`knowledge-center.config.ts` 的字段白名单扩展建议：

| provider | 允许的非秘密配置 |
| --- | --- |
| `graphrag` | 现有 `mode`、`response_type`、`community_level`、`dynamic_community_selection` |
| `lightrag` | 现有 mode/top_k/并发/超时和 ModelRef；不增加 credential 字段 |
| `pageindex-oss` | `mode`、受控 agent budget/profile 引用；不接收任意 prompt 指令 |
| `lightrag-server` | `mode`、`top_k`、opaque `connectionRef`；URL/credential 放 connection table/服务端登记 |
| `pageindex`/`weknora`/`ima` | `connectionRef`、非敏感 capability/profile 引用；remote ID 在 connection record，前端 JSON 不写 secret |

### 4.3 Link existing 与外部来源

| 功能 | 实现文件/函数 | 数据语义 | 失败态 |
| --- | --- | --- | --- |
| 本地既有索引 | `knowledge-source.service.ts` 新增 `probeLinkedFolder/connectLinkedFolder`；`knowledge-engine.service.ts` 调 adapter | 只保存 realpath、provider、version、embedding signature；不复制 raw、不重建；删除只 detach | `LINKED_PATH_NOT_ALLOWED`、`LINKED_INDEX_NOT_READY`、`EMBEDDING_SIGNATURE_MISMATCH`、`LINKED_PATH_REVOKED` |
| Obsidian vault | `knowledge-source.service.ts` 新增 `connectObsidian` | 保存 allowlisted vault pointer；走专用 live-file capability，不冒充普通 RAG；不 materialize 未经许可的原文 | `VAULT_NOT_FOUND`、`VAULT_OUTSIDE_ALLOWLIST`、`VAULT_UNREADABLE`、`EXTERNAL_CAPABILITY_UNAVAILABLE` |
| Kiwix/ZIM | `knowledge-source.service.ts` 新增 `connectKiwix`、`searchKiwix` | 保存 `kiwix-serve URL + zimName`；文章留在服务端；本地只存 citation/locator 摘要 | `KIWIX_SERVER_UNREACHABLE`、`ZIM_NOT_FOUND`、`KIWIX_QUERY_FAILED` |
| MarginNote 4 | `knowledge-source.service.ts` 新增 `connectMarginNote`；必要时新专用 client | 保存 device/pairing ref；通过官方 Add-on/同步 API；不得把 MN4 token 写库；不走普通 RAG | `DEVICE_NOT_PAIRED`、`MARGINNOTE_SYNC_FAILED`、`MARGINNOTE_CAPABILITY_UNAVAILABLE` |
| 外部 connected 删除 | `KnowledgeCenterService.detachConnection` | 只将本地 connection/source 标为 revoked/deleted，不发远端 delete | `EXTERNAL_DETACH_FAILED` 只表示本地状态未完成，不能重试远端删除 |

这些语义来自上游 `kb_types.py` 和 `linked_kb.py`；本仓库新增 adapter 必须为不可检索的 Obsidian/MarginNote 返回专用能力状态，不能把“连接成功”写成普通 RAG ready。

### 4.4 文件夹/GitHub/Web 来源与 sync job

**文件夹挂载：** 只允许管理员选择服务端配置的 root 下目录；服务端 `realpath` 后重新检查 root，拒绝 symlink 穿透。默认预算建议为每次最多 200 个文件、50 MiB、单文件 5 MiB；超限返回 `SOURCE_SYNC_BUDGET_EXCEEDED`，不发布部分结果。

**GitHub：** `repo`、`branch`、`path`、`glob` 为非秘密配置；私有仓库 token 只能是服务器登记的 `credential_ref`。同步使用 commit/tree SHA 做 `last_source_revision`，下载前做 repo/path/glob allowlist 和文件大小预算。GitHub API 超时、速率限制和权限失败分别映射稳定错误码，不把 token URL 写事件。

**Web：** `url` 必须通过 SSRF 防护：只允许 `http/https`、解析后拒绝 loopback/private/link-local/reserved IP，限制 redirect 次数和 host allowlist；`depth` 默认不超过 3，`maxPages` 默认不超过 200，单页和总字节受服务端预算限制。上游文档只证实 1–168 小时调度范围；抓取实现还必须限制脚本、外部资源和内容类型，不能把搜索摘要当原文。

**sync 幂等与发布：**

1. API 按 `(actorId, sourceId, Idempotency-Key)` 计算 scope；首次请求创建 `knowledge_sync_runs`、递增 KB revision、创建 `knowledge_jobs(operation='sync')`，三者同事务写入。
2. 同 key 同 hash 返回原 job；同 key 不同 hash 返回 `409 IDEMPOTENCY_CONFLICT`；调度任务使用 `schedule:<sourceId>:<sourceRevision>`，同一 source revision 不重复执行。
3. Worker 复用现有租约/fencing/heartbeat；每个 fetch、parse、candidate upsert 和 publish boundary 记录阶段事件。取消时停止在下一个安全边界，fencing token 递增，候选版本不成为 active。
4. 同步先把源内容写入候选成员/候选版本，完成完整性、对象权限、source revision 和实际检索验证后才将旧版本替换为新版本；失败保留旧 active version，`stale/failed` 明确展示。
5. 审计动作至少为 `knowledge.source.create`、`knowledge.source.update`、`knowledge.source.sync.request`、`knowledge.source.sync.finish`、`knowledge.source.sync.cancel`、`knowledge.connection.detach`。detail 只写 source ID、状态、计数、预算结果、错误码和 hash，不写正文、URL 中的 token 或密钥。
6. 定时调度只由 worker/server scheduler 创建，客户端不能直接写 `next_sync_at`、job state、fencing token、audit 或 active version。

## 5. 缺口到实施任务矩阵

| 缺口 | 修改文件/函数 | 数据模型 | API | 验收标准 |
| --- | --- | --- | --- | --- |
| 云端连接/创建 | `knowledge-engine.service.ts:execute/check`；新增 `knowledge-engine.adapters.ts`；`knowledge-center.config.ts` 白名单 | `0030` 的 connection；不存 secret | `GET/POST engines`、`POST bases`、`link-probe` | PageIndex Cloud create 或 WeKnora/ima connect 只有真实远端操作成功才 ready；未配置明确失败；响应不含 secret |
| 本地 provider 扩展 | `bridge.py:run`；`knowledge-engine.service.ts` 的 provider 分派；各 provider 测试 | `knowledge_index_versions.manifest` 增加 provider/capabilities/embedding signature | 复用 build/search/check | GraphRAG/LightRAG/PageIndex OSS/LightRAG Server 各有真实 provider path；不回退关键词；模型不匹配拒绝查询 |
| Link existing | `knowledge-source.service.ts`、`KnowledgeCenterService.createBase`、`knowledge-engine.service.ts` | `knowledge_base_connections` flavour=`linked` | `link-probe`、`bases` create mode | root allowlist、ready index、embedding signature 全通过才创建；不复制、不重建；detach 不删外部目录 |
| Obsidian/Kiwix/MarginNote | `knowledge-source.service.ts`、对应 adapter/client、`project-knowledge.service.ts` 能力分流 | connection flavour 和脱敏 `external_ref` | `connect`、`search`/capability 状态 | Kiwix 真实 URL+ZIM 查询；Obsidian/MarginNote 不伪装普通 RAG；断连、撤权、删除失败态可见 |
| 文件夹/GitHub/Web/sync | `knowledge-source.service.ts`；`knowledge-build.worker.ts` 的 operation dispatch；controller | `knowledge_sources`、`knowledge_sync_runs`、jobs 扩列 | source CRUD、sync、cancel | 同 key 重放不重复；预算硬上限；取消不发布半成品；旧版本保留；审计脱敏 |
| 逐库助手/Partner 绑定 | `knowledge-center.service.ts:canRetrieve`；新增 binding service/controller；`project-knowledge.service.ts` | `knowledge_base_agent_bindings` | GET/PUT bindings、revoke | 全局门槛+逐库绑定+对象权限均满足才查；撤权在下一次检索前后均失效；项目/ima 原有绑定不冲突 |
| 管理端 UI | `settings/knowledge/page.tsx`、`lib/api/knowledge-center.ts` | 无额外前端状态源 | 调用上述 API | 双 Tab 导航不变；覆盖 loading/empty/error/offline/permission denied；四态、来源、绑定、取消和失败原因可操作；不显示 secret |

## 6. 管理端交互合同

保持现有 Knowledge Center 双 Tab，不新增顶层导航：

1. **引擎卡片：** 展示 Local/Server/Cloud/External 分组、四态、能力标签和“配置/检查连接”入口。`Needs key` 只显示“需服务端配置凭证”，不渲染输入密钥。
2. **新建知识库：** 第一步选择 `Create new` 或 `Link existing`；第二步按 provider 展示非敏感字段；第三步显示预检结果和预算；只有预检通过才提交创建/连接。
3. **库详情：** 保留 `Files`、`Index versions`、`Settings` 等已有区域；增加 `Linked folders`、`GitHub`、`Web`、`Connections`、`Assistants/Partners`。Kiwix 使用 `Articles/Settings` 视图，MarginNote 使用 `Devices/Settings` 视图，不能用普通上传组件伪装。
4. **绑定面板：** 一行一个 KB，按 `admin_assistant`、`tutor_partner`、`runtime_agent` 分组；mode 用 `retrieve/materialize` 明示；被全局工具门槛、项目范围、ima 白名单挡住的项显示只读原因。
5. **状态覆盖：** 首屏 loading；无库/无来源/无绑定 empty；API 失败 error + retry；浏览器断网 offline；403/管理员失效 permission denied；job 取消和旧版保留必须可见。前端只根据 API 状态显示，不自行推断 ready。

## 7. 不做清单

| 不做 | 理由 |
| --- | --- |
| 不在前端 JSON editor 接受 API key、token、password、cookie 或任意 credential payload | 凭证是服务端 secret，避免泄露到浏览器、配置快照和审计 |
| 不把 `connected` 统一实现成“本地复制一份再索引” | 与上游 pointer 语义冲突，也会扩大未成年人资料复制面 |
| 不把 Obsidian、MarginNote、subagent 当普通 `rag` provider | 上游明确它们是专用能力/不可普通 RAG 类型 |
| 不把 PageIndex OSS/Cloud 的 agentic traversal 降级成关键词或假向量搜索 | 验收要求真实引擎能力；教学对话不得编造引用 |
| 不在首期为 WeKnora/ima 编造远端建库 endpoint | 本次可核实上游材料只证明已有库连接；没有 provider API 证据就返回 `REMOTE_CREATE_UNSUPPORTED` |
| 不实现任意 URL 抓取、任意本地路径挂载、任意 GitHub command/plugin | SSRF、路径越界、命令执行和跨学生数据风险不可接受 |
| 不做全量 OCR、图像视觉覆盖、默认库迁移和跨校自动推荐 | 当前事实源列为后续缺口，超出需求 2；当前上传链路明确不做 OCR |
| 不让客户端直接改 build state、active version、job lease、审计或 binding revision | 违反服务端状态机、幂等和审计规则 |
| 不修改冻结导航，不新增独立“助手知识库系统” | 知识中心是唯一管理入口，避免第二套权限/配置事实源 |

## 8. 落地顺序与独立验收

| 阶段 | 可独立合入内容 | 验收门槛 |
| --- | --- | --- |
| A | `0030` schema、redaction/validation、四态 projection、测试 fixtures | migration up/down 在隔离库通过；secret/未知字段拒绝；既有 LlamaIndex/ima 行为不变 |
| B | adapter registry、云端 check/connect、Link probe | PageIndex Cloud 至少一个真实 sandbox create+search；WeKnora/ima connect 真实 search；未配置失败明确 |
| C | bridge provider dispatch 与本地 GraphRAG/LightRAG/PageIndex OSS/LightRAG Server | 每 provider 有依赖缺失、配置错误、真实成功、真实检索失败测试；不宣称未安装 provider 可用 |
| D | 外部连接器与 `knowledge_sources` 手动 sync | Obsidian/Kiwix/MarginNote/本地 linked 的失败态和 detach 通过；无复制/重建副作用 |
| E | GitHub/Web/folder scheduler、`sync` worker | 幂等、预算、取消、租约丢失、旧版保留、审计脱敏通过 |
| F | binding table、`canRetrieve(assistantId,kbId)`、项目/ima 交集 | 逐库授权、全局撤权、助手停用、项目越权、ima 白名单和 materialize 交集测试通过 |
| G | 管理端面板与完整状态 QA | 双 Tab/详情流程通过；loading/empty/error/offline/permission denied；截图/手工验收不显示 secret |

每阶段都必须保留固定 DeepTutor pin 和仓库已有真实向量验收口径：只有真实向量模型绑定（适用于向量引擎）、引擎预检、原文/远端资料操作和一次实际检索都通过，才可把对应 KB 标为可用。未配置时必须失败且教学对话继续运行，不生成无依据引用。

## 9. 并行工作包与文件边界

### 9.1 后端工作包

**允许修改：**

- `database/migrations/0030_knowledge_connections_sources_bindings.sql` 及对应 `.down.sql`
- `packages/database/src/schema/` 中承载知识中心表的 schema 文件
- `services/api/src/modules/knowledge/knowledge-center.config.ts`
- `services/api/src/modules/knowledge/knowledge-center.request.ts`
- `services/api/src/modules/knowledge/knowledge-center.controller.ts`
- `services/api/src/modules/knowledge/knowledge-center.service.ts`
- `services/api/src/modules/knowledge/knowledge-engine.service.ts`
- `services/api/src/modules/knowledge/knowledge-source.service.ts`
- `services/api/src/modules/knowledge/knowledge-build.worker.ts`
- 新增的 knowledge adapter、binding、source sync service/controller/test 文件，仍放在 `services/api/src/modules/knowledge/`
- `integrations/deeptutor-knowledge/bridge.py` 及其测试文件

**不允许修改：**

- `docs/admin/knowledge-center.md`（事实源由另一个文档维护流程更新）
- `apps/student-center/**`、其他三个前端
- 非知识中心模块的导航、认证和项目状态机
- `.env`、凭证文件、Git internals

**后端交付必须包含：**权限/对象校验、稳定错误码、幂等 replay/conflict、审计 action、secret redaction、迁移说明、单元测试和隔离数据库闭环。任何新 adapter 未通过真实 check + real query 不能把 `health_status` 写成 `ready`。

### 9.2 管理端前端工作包

**允许修改：**

- `apps/admin-console/app/(console)/settings/knowledge/page.tsx`
- `apps/admin-console/lib/api/knowledge-center.ts`
- 如现有状态组件无法表达本需求，仅可新增知识中心局部组件于 `apps/admin-console/lib/components/knowledge/`
- 必要的知识中心局部测试文件

**不允许修改：**

- 顶层路由和冻结导航
- 学生端、教师端、家长端
- 后端权限、审计、job state 或 API 响应的客户端推断逻辑
- 任意 secret/credential storage 或 JSON editor schema 绕过

**前端交付必须包含：**四态卡片、Create new/Link existing 分支、连接器专用字段、source sync/job cancel、逐库 binding、旧版本保留提示、四类异常状态和 permission denied；所有写请求生成稳定 `Idempotency-Key`，403/断网不自动重试写操作。

## 10. 验收用例

1. 未配置 embedding/远端 credential：引擎显示 `Needs key` 或 `Needs setup`，创建按钮不可用；教学对话返回无知识证据而不编造引用。
2. LlamaIndex：真实模型预检、上传原文、build、验证、一次语义检索均成功后才显示 `ready`；更换 embedding 后旧版本不能直接查询。
3. PageIndex OSS/Cloud：agentic path 可追溯到页/文档 locator；不能以关键词命中替代。
4. GraphRAG/LightRAG：模式和 ModelRef 白名单生效；缺 package、模型不匹配、真实 query 失败均为明确失败。
5. Link existing：越过 allowlist、无 `version-N`、embedding signature 不兼容都拒绝创建；detach 不改变外部目录。
6. Kiwix：正确 URL+ZIM 可查文章；服务断连、ZIM 不存在和撤权均 fail closed。
7. Folder/GitHub/Web：同 idempotency key 重放不重复 source/job；超过 files/bytes/pages/depth 预算不发布；取消和 worker lease 丢失不发布候选版本。
8. Binding：仅 platform tool 开启但无逐库绑定时拒绝；逐库绑定后可检索；撤销全局授权、逐库授权、助手 enabled、项目归属或 ima allowlist 任一项，下一次 search/read 都拒绝。
9. 未成年人：跨项目、跨学生、跨学校资料不出现在 binding/source 列表；审计只有 ID、hash、计数和错误码，无正文/密钥。
10. 管理端：首屏 loading、空库、API error、离线、403、job failed/cancelled、旧版保留均有明确界面状态；页面刷新后不丢失 server-owned job/binding 状态。

## 11. 仍需用户拍板的问题

1. WeKnora 与 Tencent ima 是否要求首期支持“远端建空库”，还是接受本规格先支持连接已有库、待官方 API/SDK 证据补齐后开放 create？
2. `credential_ref` 由现有 ModelRegistry 扩展为通用服务凭证，还是每个部署只允许固定环境变量/MCP 注册？两者的 secret rotation 和审计策略需要统一。
3. `tutor_partner`、`admin_assistant`、`agent_configs` 是否采用同一稳定 ID 命名空间；若存在同 ID 冲突，需确定 `agent_kind` 的优先级和 runtime mapping owner。
4. folder source 的服务端 allowlist 根目录和 GitHub/Web host allowlist 由平台管理员配置在哪里；本规格不允许客户端临时扩大。
5. 首期同步预算的默认值（文件数、总字节、网页数、超时）是否按本规格建议值落地，还是由平台治理文档另行冻结？
6. MarginNote 连接是否允许服务端保存专用同步投影；若未批准，首期只能显示 connected capability，不得 materialize 到启途智学知识库。

在这些问题没有拍板前，实施 agent 应按本规格的保守默认执行：只连接已有远端资源、凭证服务端托管、失败闭环、最小可见范围、旧版本保留，不扩大权限和数据复制范围。
