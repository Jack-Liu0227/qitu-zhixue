# 知识库、引擎和授权

读取 knowledgeConfiguration 的 revision/config，以及 knowledgeBases 的 id、revision、engineInstanceId、buildState、bindings。engineInstanceId 是配置实例的 key，例如 ima-main，不是供应商名称 ima；embeddingModelRef 为目录中的 providerId:modelId。

| action | input |
| --- | --- |
| knowledge.create | `{name,engineInstanceId,embeddingModelRef?,retrievalMode?,storageWorkspaceRef?:"account"}` |
| knowledge.bind | `{id:<本地知识库 ID>,expectedRevision,bindings:[{agentKind,agentId,mode,enabled}]}` |
| knowledge.configure | `{expectedRevision,config:<完整当前平台配置>}`，仅 global |

knowledge.bind 的常用 agentKind 为 admin_assistant，mode 为 retrieve。现有 bindings 也可能含 runtime_agent/tutor_partner 或 materialize，未要求修改的项须保留。提交前去掉 agentName/avatar/effective/reasons 等只读展示字段，bindings 每行只保留 agentKind/agentId/mode/enabled。expectedRevision 使用库级 revision，不能传平台 revision。

```json
{"reply":"创建空库并授权指定助手。","actions":[
  {"id":"base","kind":"knowledge.create","label":"创建光学资料库","input":{
    "name":"光学项目资料","engineInstanceId":"<当前已配置的引擎实例 ID>"
  }},
  {"id":"grant","kind":"knowledge.bind","label":"绑定资料库助手","input":{
    "id":{"$ref":"base.id"},"expectedRevision":{"$ref":"base.revision"},
    "bindings":[{"agentKind":"admin_assistant","agentId":"<真实助手 ID>","mode":"retrieve","enabled":true}]
  }}
]}
```

这个示例只适用于没有旧授权的新库。现有库必须合并原 bindings。管家 knowledge.create 创建空平台库，既不上传文档也不创建远端 IMA 内容；连接已有库的 mode/connection 字段属于后台连接 owner，当前不在 knowledge.create adapter 白名单。

平台配置外层为 `{mcpServers,knowledgeEngines,platformTools,growthProjection?}`。project-knowledge 总开关位于 `config.platformTools["project-knowledge"]`，结构是 `{name,description,enabled,tools,boundAssistants}`，tools 使用 knowledge_search/knowledge_read 的 canonical ID。只有用户要求授权检索时才合并助手到 boundAssistants，且保留其他成员。

knowledgeEngines 每个实例是 `{name,description,provider,enabled,config}`。config 字段由 provider 校验，不能把任意 URL、凭据或 command 塞入。IMA 使用已有安全 connectionRef、明确 allowedKnowledgeBaseIds。引擎完整配置按当前返回值修改，不能从本文重建全量默认值。expectedRevision 来自 knowledgeConfiguration.revision。

检索生效需同时满足：平台开关与助手授权、助手本身启用及工具绑定、逐库绑定、引擎/索引可用、对象权限；正式项目还须通过冻结教学包授权。IMA 的上游 KB ID 与本地 knowledgeBases.id 是不同命名空间。本地索引库若尚无项目冻结合同，不得假定已具备正式项目访问权。

| owner HTTP API | body / 状态 |
| --- | --- |
| GET/PUT /api/v1/admin/platform-config | PUT `{expectedRevision,config}`，带 Idempotency-Key |
| POST /api/v1/admin/platform-config/validate | 后台验证当前完整配置 |
| GET /api/v1/admin/knowledge/bases | 列库 |
| POST /api/v1/admin/knowledge/bases | 后台连接 owner 支持的建库/链接合同比管家 action 更宽，不能直接塞进 action |
| GET /api/v1/admin/knowledge/bases/:id | 当前库、revision、构建状态 |
| GET/PUT /api/v1/admin/knowledge/bases/:id/bindings | PUT `{expectedRevision,bindings}`，带 Idempotency-Key |
| POST /api/v1/admin/knowledge/bases/:id/uploads | 后台专用文档上传 |
| POST /api/v1/admin/knowledge/bases/:id/rebuild | 后台专用索引任务 |
| GET /api/v1/admin/knowledge/jobs/:id | 后台查看索引/同步任务状态 |

上传、链接探测、索引、远端文件管理不是现有管家 action。只能说明下一步或转到后台原入口，不能生成 knowledge.upload/rebuild 等未知操作。回读创建库的 unindexed 状态应明确资料尚不能检索；只有实际任务/检索回执才能报告对应成功。

## 测试、更新与删除

- `knowledge.test {id,mode:"configuration"}` 检查活动平台库和启用引擎，单独报告 buildState/indexReady。空库可以配置有效，但 indexReady=false 不能说可检索。
- `knowledge.test {id,mode:"engine_connection"}` 调用原知识引擎 check owner，验证引擎连接及依赖，不假称已针对每个教材问题检索成功。
- `knowledge.update {id,expectedRevision,patch:{name?,isDefault?,engineInstanceId?}}` 使用原 library settings owner；revision 冲突后必须回读。
- `knowledge.delete {id,expectedRevision}` 使用同一 owner 软删除，取消未结束任务并撤销来源/连接。保留历史本地记录及上游服务的文档，不发出远端删除命令。回读 lifecycle=deleted，而非把任何 404 都当删除成功。

知识库更新/删除对应 `POST /api/v1/admin/knowledge/bases/:id/settings`，直接请求体分别是 `{expectedRevision,...patch}` 和 `{expectedRevision,deleted:true}`；带 Idempotency-Key。引擎 check 对应 `POST /api/v1/admin/knowledge/engines/:id/check`。
