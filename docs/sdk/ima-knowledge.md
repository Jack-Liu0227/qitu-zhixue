# ima 共享教材知识库

启途现有学习搭档通过服务端模型网关的原生 tool call 调用 ima MCP；所有 Agent 共用一个教材服务，各自只能看到服务端绑定允许的工具。没有创建额外的数学/规划/答疑 Agent。

## 配置

独立的 ima MCP 服务监听服务器回环地址（例如 `http://127.0.0.1:8787/mcp`），ima Client ID/API Key 只保存在该服务的受保护环境文件。API 仅配置 `QITU_IMA_MCP_URL` 和 `QITU_IMA_MCP_TOKEN`，不把它们放入模型上下文、前端或 Git。

在 `runtime_mcp_servers` 注册 `ima-knowledge`，transport 为 `streamable_http`，启用以下只读工具，并在 `agent_mcp_bindings` 为现有 Agent 配置允许工具：

- `ima_list_knowledge_bases`
- `ima_search_knowledge`
- `ima_list_documents`
- `ima_read_document`

绑定与启停每轮由 PlatformRegistry 重新解析；未绑定、禁用的服务或工具不会传给模型。知识库接入不替用户选择或修改模型；既有运行时的独立模型选择/用途路由保持原状。独立模型字段均为空时，当前 PlatformRegistry 会尝试原有 `modelUsage` 绑定，因此不能仅凭数据库两个空字段判断有效模型不可用。学生浏览器不能提交 MCP endpoint、token 或工具授权；管理员仅可通过受权限保护的设置接口修改授权。

独立服务源代码位于 `integrations/ima-mcp`，保留自己的 npm lockfile，不纳入 pnpm workspace。安装后执行 `npm ci --ignore-scripts`、`npm test`，再使用 `qitu-ima-mcp.service` 启动；凭证文件应仅允许服务账号读取。操作员可执行 `tooling/setup-ima-mcp.sql` 幂等登记已有六个 Agent 的只读绑定，现有配置不覆盖，也不修改模型字段。构建 API 后，可用 `node --env-file=/etc/qitu/ima-api.env tooling/verify-ima-mcp.cjs` 验证两个并发 MCP 客户端、三个教材库、搜索及 PDF 读取；脚本只输出计数和来源元数据。

登记脚本默认停用运行时入口。先在候选 API 验证，再发布包含执行器的 API 并启用 `ima-knowledge`；避免旧 API 将工具仅作为提示词元数据展示。正式切换前应记录旧 API 所属进程和启动器，只重启 API，不操作前端。当前服务器 API 采用 postgres 系统账号及现有配置文件启动；部署复用这些配置，不另行复制整套进程环境。直接启动编译产物时需保留原 Nest/pnpm 提供的依赖搜索路径（`NODE_PATH=<checkout>/node_modules/.pnpm/node_modules`）。

## 执行与边界

已授权的 Tutor 请求进入 GatewayTutorProvider，建立 stateless Streamable HTTP MCP 会话、发现工具并与绑定取交集。ModelGateway 将 schema 交给已配置模型，由模型生成原生工具调用；执行实际 MCP 请求后，以原生 tool result 回填模型上下文，再生成引导回复。只读工具最多调用 8 次、模型工具回合最多 90 秒、单次 MCP 请求最多 25 秒、响应最多 1 MiB。权限由 API 的对象检查和服务端 Agent 绑定共同控制，ima 服务再校验知识库 allowlist 与签名文档引用。

当前实际模型对话入口是学习搭档；其他 Agent 的工具授权已登记，可复用 ImaMcpClient 与 ModelGateway 原生工具循环，但这不表示尚未实现的团队模型执行器已完成。共享工具授权与具体 Agent 的模型编排是两层能力。

工具记录只保存真实调用名称及成功/失败状态，不保存原文、参数、凭证或学生身份。教材是未经信任的参考数据，不能覆盖教学约束；原有提示阶梯和答案泄露检查继续执行。故障只记录稳定代码，模型收到明确失败结果；没有结果时不能假称查到教材。

ima 的关键词接口可能只匹配文件名，不能视为完整语义 RAG。知识点未命中时需要按学科/书名浏览，再读取目录与 PDF 页码。引用须给出书名和文件页序。扫描件、公式和插图识别仍受 PDF 文本提取能力限制。

## 验证和发布

执行 model-runtime 和 API 的 typecheck、lint、测试及生产构建。运行时测试覆盖模型原生工具调用、结果回填、未授权工具拒绝；MCP 测试覆盖握手、SSE、绑定交集和并发会话隔离。生产验收分别检查服务健康、实际知识库列表、教材搜索/PDF读取以及 Agent 模型绑定状态；未绑定模型时不能宣称完整导师问答已验证。

发布前保存现有 MCP/Agent 绑定和 API 启动环境；通过隔离 checkout 启动，保留旧进程启动方式作为回滚路径。停用 `ima-knowledge` 或删除指定 Agent 的绑定即可撤销读取权限；不影响正式项目、掌握度或成长数据。

## 管理员工具与 MCP 页面

保持原有授权矩阵、四个 MCP 配置条目、JSON 编辑/预览、添加与删除以及内置工具的布局。矩阵追加“是否使用 ima 知识库”列，“配置目标与清单”追加与其他条目同样式的“ima知识库”行。

ima 列按现有助手保存授权，配置行显示服务器实际连接状态、工具数和授权数；在该行可设置全局“允许调用”及执行连接检查。矩阵、绑定标签与 JSON 的 `enabled`、`boundAssistants`（助手 ID）均调用管理员 API 保存，刷新后从服务器读取。全局配置也保留 ima 条目，停用通过 `enabled: false` 表达。ima 的连接地址、凭证、工具清单由服务器管理，页面不可覆盖；读取失败显示错误和重试，保存失败不会假装成功。不会新增 Agent、启用助手或变更模型绑定。
