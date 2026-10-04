# 作用域知识模块（knowledge）

真源表：`knowledge_documents` / `knowledge_chunks`（迁移 `0008_domain_foundation.sql`）。
本模块是这两张表的**唯一服务端读写入口**，并按作用域做强对象级授权。

## 路由

| 方法 | 路径 | 说明 | 幂等 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/knowledge/search?q=&projectId=&limit=` | 作用域内检索，仅返回已校验知识的**有界证据** | — |
| `GET` | `/api/v1/knowledge/documents/:id` | 读取单篇（可读者或可维护者） | — |
| `POST` | `/api/v1/knowledge/documents` | 新建 / 修订文档 | 必需 `Idempotency-Key` |
| `POST` | `/api/v1/knowledge/documents/:id/verify` | 校验文档 | 必需 `Idempotency-Key` |

响应统一为 `{ data: ... }`。写接口省略 `Idempotency-Key` 返回 `400 IDEMPOTENCY_KEY_REQUIRED`。

## 作用域规则（服务端判定，前端隐藏不构成授权）

| scope | 读 | 写 / 校验 | 绑定字段 |
| --- | --- | --- | --- |
| `system` | 任意已认证主体 | 仅平台管理员 | `schoolId`/`ownerUserId`/`projectId` 必须为空 |
| `school` | 与主体同校 | 管理员，或**本校**教师 | `schoolId` 必填 |
| `project` | 请求绑定该项目且主体对该项目有访问权 | 管理员，或可访问该项目的教师 / 学生 | `projectId` 必填 |
| `student` | **仅本人**（监护 / 班主任 / 管理员默认不可见） | 仅学生本人 | `ownerUserId` 必填 |

- 项目可访问性：学生=项目归属本人；教师 / 家长=`AccessPolicy.canReadStudent(项目归属学生)`（active 班主任 / 监护）；管理员 / 客服=**默认拒绝**（个别学生访问模型落地前 fail closed）。
- 只有 `status = 'verified'` 的文档可被检索；`draft` / `archived` 永不进入检索候选。
- 未授权与不存在统一返回 `404 KNOWLEDGE_NOT_FOUND`，避免用状态码差异探测文档存在性。

## 修订语义

- 新建：`v1` / `draft`。
- 正文（checksum）变更：升版本 `v{n} → v{n+1}`、回到 `draft`、清空 `verifiedBy` / `verifiedAt`。
- 仅元数据变更（title / summary / tags / source）：保留版本与校验状态。
- 内容与元数据都不变：`unchanged`，不写库、不写审计。
- 既有文档的作用域绑定不可变（改作用域 → `400 KNOWLEDGE_SCOPE_INVALID`）。

## 边界与安全

- **共享知识路径与 AI 搭档对话隔离**：`source` / `sourceRef` 命中保留前缀（`tutor_turn:`、`tutor_conversation:`、`tutor_raw_transcript:`、`tutor_raw_audio:`、`voice_raw:`）时返回 `400 KNOWLEDGE_SOURCE_FORBIDDEN`。未成年人原始对话 / 语音不得进入 `knowledge_documents`。
- 写入体经 `pickFields` 白名单，客户端无法写入 `status` / `version` / `checksum` / `verifiedBy` / `verifiedAt` 等服务端字段。
- 证据投影有界：正文与摘要截断到 360 字，最多 4 条，结构对齐 AI 搭档 `context_packet.knowledgeEvidence`。
- 审计 fail-closed：无 `DATABASE_URL` 时 `AuditWriter` 抛 503，写操作不会伪装成功。
- 本切片只审计写入 / 校验；检索读取不落审计（读审计与敏感读审批属于 `AccessPolicy.assertSensitiveRead` 的后续任务）。

## 错误码（模块本地；待并入契约 `ApiErrorCode`）

| code | HTTP | 场景 |
| --- | --- | --- |
| `KNOWLEDGE_INPUT_INVALID` | 400 | 字段缺失 / 超长 / 类型错误 |
| `KNOWLEDGE_SCOPE_INVALID` | 400 | 作用域与绑定字段不一致，或修订时改作用域 |
| `KNOWLEDGE_SOURCE_FORBIDDEN` | 400 | 保留来源（原始对话 / 语音） |
| `KNOWLEDGE_FORBIDDEN` | 403 | 作用域写权限不足 |
| `KNOWLEDGE_NOT_FOUND` | 404 | 不存在或无权访问 |
| `KNOWLEDGE_UNAVAILABLE` | 503 | 依赖不可用（如审计 / 未来向量化） |
| `IDEMPOTENCY_CONFLICT` | 409 | 同键异载荷 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 缺少幂等键 |

## 日志与审计

- 日志：仅记录文档 id / scope / version 等非敏感元数据，不打印正文。
- 审计动作：`knowledge.document.create`、`knowledge.document.revise`、`knowledge.document.verify`。
  `unchanged` 不产生审计。审计 detail 只含 scope / schoolId / ownerUserId / projectId / version / source。

## 向量检索（pgvector 后续）

- **初始化 flow integration**：管理员 `tutor` 初始化只写入无学生归属的 synthetic strategy record，并在同一事务追加 `agent-memory.index` pending outbox 事件；不会写入原始未成年人对话 / 语音，也不会进入 admin runtime projection。关系记忆仍由 `agent-memory` API 写入，保持 90 天过期与纠错/删除后的索引清理语义。

- 当前默认 `KeywordRetrievalPort`：确定性关键词检索（字段加权 + 中文二元组），同分按文档 id 升序，跨进程可复现。
- `knowledge_chunks.embedding` 现为 **JSONB 占位**，`EmbeddingProvider` 绑定为 `ReservedEmbeddingProvider`（`isConfigured() === false`，调用即抛 `KNOWLEDGE_UNAVAILABLE`）；`knowledge.embed` 尚未接入 `ModelGateway`。
- 后续任务（不在本切片）：
  1. 在 `ModelGateway` 落地 `knowledge.embed` 用途；
  2. 提供 `EmbeddingProvider` 适配器并回填 `embedding` / `embedding_model`；
  3. 新迁移把 `embedding` 改为 `vector(n)`，确定维度与 HNSW / IVFFlat 索引；
  4. 以向量 / 混合检索实现替换 `RetrievalPort`，对外证据合同不变。

## 测试

`services/api/src/modules/knowledge/` 下：

- `knowledge.scope.test.ts`：作用域隔离、verified-only、写权限矩阵、来源守卫。
- `knowledge.retrieval.test.ts`：确定性排名、字段权重、tie-break、中文匹配、limit。
- `knowledge.service.test.ts`：写入幂等、冲突、修订 / 校验生命周期、检索授权隔离、单篇读取授权。
- `knowledge.content.test.ts`：checksum、版本自增、分块边界、证据投影截断。

运行（未纳入 `services/api/package.json` 的既有测试 glob，属本切片范围外）：

```bash
cd services/api
pnpm --filter @qitu/database build
../../node_modules/.bin/tsc -p tsconfig.json --outDir .tmp/test-dist
node --test ".tmp/test-dist/modules/knowledge/**/*.test.js"
```
