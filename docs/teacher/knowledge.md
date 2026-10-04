# 知识库

> **状态：planned。** ADR 0008 提及「知识库」为 Teacher 的潜在第 5 项导航，但
> 当前代码中 Teacher 导航只有 4 项，Teacher 不负责平台知识库治理。
> 新增导航前必须先更新产品文档并通过评审（冻结 IA）。
>
> 服务端 `services/api/src/modules/knowledge` 已存在，属于**平台知识治理能力**，
> 由 Admin 控制面使用（见 [`../admin/control-plane.md`](../admin/control-plane.md)）。

## 1. 现有服务端能力

```http
GET  /api/v1/knowledge/documents              文档列表
GET  /api/v1/knowledge/search                 检索（经授权 + verified-only 边界）
GET  /api/v1/knowledge/documents/:id          文档详情
POST /api/v1/knowledge/documents              创建（平台治理）
POST /api/v1/knowledge/documents/:id/verify   验证（平台治理）
```

- 文档有 `scope`，`school_id` 可空表示平台共享。
- 检索走统一 KnowledgeService 的授权 / verified-only 边界；未验证文档不进入 Tutor 上下文。
- `knowledge_chunks.embedding` 当前为 JSONB 占位，pgvector 维度与索引类型未定。

## 2. Teacher 视角（若未来开放）

- 若未来 Teacher 有只读知识视图，仍必须逐对象授权，且不能编辑 / 发布 / 验证。
- 平台知识库、模板库、数据库迁移、模型凭证、AI runtime 治理**始终归 Admin**。

## 3. 未决事项

- [ ] 是否为学生端 / 班主任端提供知识库浏览（需先改产品文档）。
- [ ] 知识文档的验证工作流与发布权限。
- [ ] pgvector 维度 / 索引（HNSW / IVFFlat）与中文召回验证。
- [ ] `KnowledgePoint`（canonical 知识点）与知识文档的映射（见 growth §3）。

## 4. 相关文档

- [`dashboard.md`](./dashboard.md)
- [`../admin/control-plane.md`](../admin/control-plane.md)
- [`../admin/database.md`](../admin/database.md)
