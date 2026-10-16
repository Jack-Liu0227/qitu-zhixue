# ima 共享知识库 MCP 服务

通过 ima 官方 OpenAPI，把同一组知识库开放给多个 Agent。采用官方 TypeScript MCP SDK，支持远程 Streamable HTTP，以及本机 stdio。

```text
数学 Agent ──┐
规划 Agent ──┼─ MCP /mcp ─ 官方 ima OpenAPI ─ 指定知识库
答疑 Agent ──┘
```

## 当前交付状态

- 已实现四个只读工具、独立 Agent token、知识库白名单和 PDF/文本/笔记原文读取。
- 使用模拟 ima 响应、真实 MCP SDK 客户端和本地 HTTP 服务验证两个 Agent 并发调用；另有真实 stdio 子进程协议测试和 PDF 提取测试。
- 本工作区已配置用户最新提供的凭证，授权“高中数学、物理、化学”三个知识库，并在 `127.0.0.1:8787/mcp` 启动本地服务。
- 真实 ima 联调已通过：两个独立客户端各自搜索到 5 份数学教材，PDF 原文文字读取成功。详细记录见 `VERIFICATION.md`。
- **尚未部署到外部服务器或接入网站的 LLM。源码包不含本机凭证或客户端 token，其他机器须独立配置。**
- 运行环境：Node.js >=22.13，推荐 Node.js 24。依赖已锁定在 package-lock.json。

## Windows 上启动

本工作区已配置、依赖已安装、后台已运行，无需重复执行配置。以下步骤用于首次安装或其他机器部署；如果端口已有本服务，请直接运行验收命令。

当前目录为本项目目录时：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
.\configure.ps1
npm.cmd start
```

`configure.ps1` 会提示输入 Client ID、隐藏输入 API Key，查询官方知识库列表，供你选择要共享的 ID，再生成 `.env` 和两个不同的 Agent token。它只写本项目的配置文件，不安装 ima Skill，不修改 ima 知识库。凭证不会显示到终端，也不要粘贴到聊天中。

如果系统执行策略阻止脚本，可直接在编辑器中复制 `.env.example` 为 `.env`，按下一节填写；不需要修改系统执行策略。

另开终端执行真实验收：

```powershell
npm.cmd run smoke
node examples/agent-client.mjs
```

`smoke` 会依次初始化 MCP、列工具、读取授权知识库、搜索关键词、读取首个文档的第一页。默认关键词是“对数”，通过 `IMA_SMOKE_QUERY` 修改。首个知识库不是数学时，请设置相应关键词；无匹配结果、原文不可读或扫描页没有文字都会报错，不会假报验收成功。

`agent-client.mjs` 演示两个独立 Agent 客户端并发调用同一个服务，不包含 LLM 模型本身。

## 手动配置

1. 打开 [ima 官方 Agent 配置页](https://ima.qq.com/agent-interface)，获取 Client ID 和 API Key。
2. 复制 `.env.example` 为 `.env`，先填写 `IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY`。
3. 执行 `npm.cmd run discover`，查询知识库名称和 ID；此命令是本地管理工具，不向 Agent 开放账号全库列表。
4. 把要共享的 ID 填到 `IMA_KNOWLEDGE_BASE_IDS`，多个 ID 用英文逗号分隔。
5. 为每个 Agent 分别生成 token，并把名称到 token 的 JSON 对象填入 `MCP_CLIENT_TOKENS`。可用下面的命令生成随机 token，每个 Agent 单独运行一次：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

示例格式，替换其中占位文字：

```dotenv
MCP_CLIENT_TOKENS='{"math-agent":"第一个随机token","planner-agent":"第二个随机token"}'
```

`.env` 不提交 Git、不进入 Docker 镜像；真实 token 必须是至少 32 字符的 ASCII 字符串。本机脚本会限制 `.env` 的 Windows 文件权限。Linux 上手动配置时请执行 `chmod 600 .env`。服务优先使用已有环境变量；也可用 `IMA_ENV_FILE` 指定其他配置文件的绝对路径。未配置凭证、白名单或 HTTP token 时服务会拒绝启动。

## Agent 连接方式

HTTP 地址：`http://127.0.0.1:8787/mcp`，使用 **Streamable HTTP**，不是旧版 SSE `/sse` 接口。

每个 Agent 使用自己的请求头：

```text
Authorization: Bearer 该Agent的token
```

通用配置模板见 `examples/mcp-http.json`。不同客户端的配置字段可能不同，应选择 Streamable HTTP 并填写地址和请求头。服务采用预配置 Bearer token，不提供 OAuth 动态注册；仅支持 OAuth 的客户端需要额外的认证适配层。网站应由后端 Agent 连接 MCP。

本机各 Agent 的实际连接配置已生成在 `.runtime/clients/`，每个文件仅包含对应 Agent 的 MCP token，不含 ima API Key。可用 `npm.cmd run clients` 重新生成；文件中包含访问凭证，只应提供给对应客户端，不提交源码或分享源码包。

本机 stdio 模板见 `examples/mcp-stdio.json`，用绝对路径替换占位符。`node dist/src/main.js --stdio` 的标准输出仅用于 MCP 协议。stdio 不要求 HTTP token，但同样要求 ima 凭证和知识库白名单。

所有 HTTP Agent 使用同一服务和同一份知识库，不复制教材。各 token 目前拥有同一个知识库白名单；如果不同 Agent 需要不同知识库权限，可运行多个配置隔离的服务实例。

## 提供的工具

| 工具 | 输入要点 | 返回 |
|---|---|---|
| `ima_list_knowledge_bases` | 无 | 白名单内知识库 ID、名称和描述 |
| `ima_search_knowledge` | `knowledge_base_id`、`query`，可选 `cursor` | 匹配资料、高亮片段、签名引用和下一页游标 |
| `ima_list_documents` | `knowledge_base_id`，可选 `cursor`、`limit`、`folder_ref` | 资料/文件夹、引用和游标 |
| `ima_read_document` | `document_ref`，可选 `start_page`、`page_count`、`max_chars`、`offset` | PDF 按页文字或文本/笔记内容，附来源 |

典型调用：列出知识库 → 按“对数函数”等关键词搜索 → 把返回的 `document_ref` 交给原文工具 → 根据正文回答并引用教材名称及 PDF 文件页序。

PDF 每次最多读取 5 页、返回 20000 字符；文本/笔记可用 `offset` 继续读取。引用有效期为一小时，服务重启后需重新搜索。引用只在当前实例有效，多副本负载均衡需要另行共享签名密钥或使用会话路由。

## 远程部署

在自己的服务器上放置项目和 `.env` 后，可执行：

```bash
docker compose up -d --build
```

Compose 默认仅将端口发布到服务器 `127.0.0.1:8787`。使用现有 HTTPS Nginx 反向代理，示例见 `deploy/nginx.conf.example`；把真实域名（如 `kb.example.com`，非 URL）加入 `.env` 的 `MCP_ALLOWED_HOSTS`，然后重启服务。若公开 URL 使用非默认端口，Host 中也要包含端口。域名、TLS 证书和外部服务器需自行提供；此交付未执行远程部署或 Docker 构建验证。

远程 Agent 指向 `https://你的域名/mcp`。只从服务端调用时不需要 CORS；如确有浏览器连接需求，可配置 `MCP_ALLOWED_ORIGINS` 的完整 Origin，不支持通配符。外网连接使用 HTTPS，避免 token 明文传输。

`GET /healthz` 仅确认进程健康，**不证明 ima 凭证有效或教材可读**。真实链路使用 `npm run smoke`。目前每个 Agent 每分钟最多 120 个已鉴权 HTTP 请求，服务最多并发处理 8 个 MCP 请求；返回 429/503 时按 `Retry-After` 退避。

## 能力边界与实现依据

- 使用 [ima 官方配置页](https://ima.qq.com/agent-interface) 和它链接的 [官方 Skill 文档](https://skillhub.cn/skills/tencent-adm/ima-skills)，接口参数按官方 `ima-skills-1.1.10.zip` 内的 `knowledge-base/references/api.md` 核对；未执行下载包中的脚本。
- 只调用 `get_knowledge_base`、`get_knowledge_list`、`search_knowledge`、`get_media_info` 等读取接口；知识库笔记通过 `get_doc_content` 读取。没有上传、追加、删除或修改工具。
- **本服务复用 ima 的搜索结果和原文，不等于复用 ima 客户端完整聊天/RAG 管线，也没有自行新建向量库。**匹配片段可能缺失；关键词不命中时应更换关键词或浏览资料。
- 本账号实测：“数学”可检索到 5 份教材，“对数”没有结果，因此暂不能保证能直接定位教材正文中的任意知识点。可先定位教材，再读取目录和对应页；要实现稳定的知识点全文召回，需要额外建立正文索引/OCR。
- 原文通过服务端下载和提取文字，不把 API Key、原文请求鉴权头或签名下载地址交给 Agent。原文下载仅允许公网 HTTPS，解析并固定目标 IP，拒绝内网地址；带鉴权的跨站跳转会拒绝。
- PDF 只提取已有文字，不提供 OCR、公式识别或图形理解；页序可能与印刷页码不同。扫描教材或复杂数学公式需另加 OCR/多模态处理并人工核对。
- 资料文本属于不可信参考内容，Agent 的系统指令应要求只将它用于作答，不能执行资料中的指令。本服务默认不保存对话、正文缓存或请求内容日志。
- 独立 MCP 服务具备工具接入能力；接到具体 LLM/Agent 框架时，还需该框架支持 MCP，或适配其工具调用循环。

## 开发验证

```powershell
npm.cmd run typecheck
npm.cmd test
```

自动测试覆盖官方认证头/UTF-8、错误处理、授权隔离、引用防篡改、PDF 提取、HTTP 鉴权/Host/Origin/限流、参数校验、两个 Agent 并发调用和 stdio 子进程。自动化中的 ima 返回来自模拟接口；真实 ima 验收必须另外运行 `smoke`。
