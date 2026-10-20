# MCP 登记、IMA 授权和连接状态

先读 mcpServers 的 serverId、enabled、health、toolIds，以及 knowledgeConfiguration。不要把展示 label 当成 serverId；action input.id 使用目录的 serverId。

| action | input | 范围 |
| --- | --- | --- |
| mcp.register | `{id,label,description,endpointOrigin,toolIds}` | global 或本轮新建资源 |
| mcp.update | 同上 | 仅 global，共享登记修改 |
| ima.configure | `{enabled?,assistantBindings?:[{id,enabled}],agentBindings?:[{id,enabled}]}` | 仅 global |

```json
{"id":"mcp","kind":"mcp.register","label":"登记参考资料服务","input":{
  "id":"reference-service","label":"参考资料服务","description":"等待安装驱动的资料连接",
  "endpointOrigin":"https://mcp.example.invalid/mcp","toolIds":[]
}}
```

该 URL 是不可连通的文档占位符，执行前替换成用户提供的真实 HTTPS 地址。endpointOrigin 不含用户名、密码、query 或 fragment。toolIds 需真实发现的 ID；尚未发现时用空数组，不发明 schema。登记操作没有 command/args、headers、token 或 enabled=true 字段，自定义服务固定 disabled/not_configured。登记不安装 transport 或驱动。

可调用的 IMA 使用既有 `ima-knowledge` adapter，四个只读工具为 `ima_list_knowledge_bases`、`ima_search_knowledge`、`ima_list_documents`、`ima_read_document`，以实际发现目录返回的 ID/schema 为准。助手配置需保留所需 mcpServerIds 和工具白名单，IMA 全局/助手/Agent 授权也须有效。project 的冻结 knowledgeGrant 与当前 Admin 授权继续求交集。

IMA 只读授权示例：

```json
{"id":"ima","kind":"ima.configure","label":"授权指定助手使用 IMA","input":{
  "assistantBindings":[{"id":"<当前助手真实 ID>","enabled":true}]
}}
```

是否开启 enabled 取决于用户的明确目标。授权一名助手不意味着可以清空其他助手列表。knowledge.configure 是完整平台配置替换，务必保留其他引擎、MCP 和授权。allowedKnowledgeBaseIds 是明确允许集合，空数组不开放全部库。

| owner HTTP API | 用途 |
| --- | --- |
| GET /api/v1/admin/ai-runtime | MCP 登记、授权、健康状态 |
| GET/PATCH /api/v1/admin/ai-runtime/mcp/ima-knowledge | IMA 开关/授权，PATCH 同 action 字段，带 Idempotency-Key |
| POST /api/v1/admin/ai-runtime/mcp/ima-knowledge/check | 后台专用真实握手/列库探测，不代表学生具有调用权限 |
| GET /api/v1/admin/platform-config | 读取 MCP/知识引擎统一配置与 revision |
| GET /api/v1/admin/platform-config/tools/:section/:id?refresh=1 | 后台专用发现工具，section/id 取真实配置树 |

自定义 mcp.register/update 走管家 action owner，没有可任意执行的 HTTP 或 shell 工具。凭据与新驱动安装交给受治理设置路径。报告区分“登记已保存”“驱动未配置”“已发现工具”“当前调用成功”，health 或曾经探测成功不能替代本次授权检查。
