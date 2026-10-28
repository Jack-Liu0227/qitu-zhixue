> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../README.md) 和各责任域文档。

# MCP 与工具最小权限治理

> 状态：capability-v1-m1 / 2026-10-19；真实助手当前授权和纯编译校验已有源码，本地全量离线复核已通过。项目 grant/provenance 尚未接线，不宣称完整权限链完成。协议参考固定 MCP 2025-11-25，不声称为最新版本。来源见 [研究报告](./research-report.md)，交付边界见 [实施计划](./implementation-plan.md)。

## 1. 研究工具不等于产品工具

Grok Search MCP 的已有开发研究记录有三次零来源，不构成教材事实，也不因此成为学生工具。当前实施轮次没有重新联网。外部安装器、浏览器、文件系统、shell、电脑控制、邮件写入、支付及临床/实验室硬件工具不进入学生 runtime。

| 能力 | 当前事实 | 路线 |
| --- | --- | --- |
| IMA 四只读工具 | 有白名单、动态撤权和网络上限；缺项目 grant/参数过滤/provenance | 第一优先补齐，不必先增加工具数量 |
| 手工知识库检索 | 有 assistant + school/student owner、索引重验、remote evidence 24h 期限 | 扩展现有 owner 的 project/binding scope，不建项目知识库 |
| Admin IMA 发现/PDF | 最新三提交新增列库验证、关联重验、原文代理/PDF.js | 管理能力，不是学生项目权限链 |
| 光学模拟 | 可视化原型，未形成正式证据闭环 | 内部注册 typed handler；无外部边界不必套 MCP |
| OpenAlex/Crossref | 官方元数据 API 文档已读，不是已接入官方 MCP | 后续内部只读适配器候选 |
| OpenStax | 教材参考，不是 MCP 服务 | 教师审核资源/权利后进入既有知识治理 |

## 2. 统一服务端授权执行边界

```text
allowed = frozen project ceiling
        ∩ current Admin global grant
        ∩ actual assistant/server/tool grant
        ∩ actor/project/session/object permission
        ∩ current gate/task domain
        − deny/revocation
```

缺 project、role、KB 上限或 schema 即拒绝。Skill 依赖仅影响编译检查，不创建权限。只过滤工具目录不够，每次执行 closure 必须重检。ToolBroker 是现有 runtime/client 内的边界，不是第二个注册中心；沿用 canonical IDs，Board/KaTeX/Mermaid 不是工具权限。

以上是完整目标。M1 当前只让 Tutor/SDK 和 IMA 当前授权沿同一真实助手身份解析，Admin assistant MCP 配置受当前精确 Agent 限制收紧；runtime-only Agent 仍保留。纯编译器已校验 IMA server/tool/KB ceilings，但输出未冻结至项目。原生四工具尚无完整项目 scope、参数/结果过滤与 provenance，Worker 也未接 closures；不得以当前 resolver 或编译通过替代这些执行检查。

每轮只暴露本任务有效 schema，project/student/assistant/grant 从服务器注入，拒绝模型覆盖。Admin 新关联库可能扩大当前 global allowlist，绝不能扩大旧项目 frozen ceiling。

## 3. 四工具逐项合同

| canonical tool | 强制约束 | 必须拒绝 |
| --- | --- | --- |
| `ima_list_knowledge_bases` | 结果按 frozen ∩ current KB grant 过滤，隐藏无权库及摘要/计数 | 全局 bridge 目录直接给模型；空 scope=全部 |
| `ima_search_knowledge` | 注入/严格验证 KB，限制查询/结果/字节，结果建立项目 provenance | 跨 KB 参数、通配符绕过、grant 外结果、身份原话外发 |
| `ima_list_documents` | 同样约束 KB/分页/条数，返回前重验授权/来源 | list-KB 过滤却 list-doc 可枚举外库 |
| `ima_read_document` | 服务端未过期、同项目/制品/来源版本 provenance，当前 KB/对象再次授权 | 签名有效即放行、自报 KB、跨项目 ref、过期/指纹变化 |

上游不能证明 KB 归属时停止，不猜范围。probe 成功只证明运维连接，不证明学生授权。

### Provenance

先做 schema 对比，再扩现有 knowledge remote evidence store，避免平行 citation 数据库。最小字段：`projectId/bindingDigest/assistantId/serverId/kbId/documentId-or-refDigest/sourceVersion-or-fingerprint/retrievedAt/expiresAt`，以及有界标题/作者/实际可得段落定位。opaque ref 只在受控服务器保留，浏览器/模型文本不当可信映射。

关系从批准的 search/list 结果建立，不在 read 时接受自报归属。上游无可核验归属则不发可读引用。TTL 由 Admin 策略设定，不凭空规定 7/30 天；手工路径 24h 不能冒充原生 MCP 已支持。每次 read 重验权限，未过期也非永久授权。

过期/重启不得丢失或放宽 scope，需重新检索。撤权阻止新 call，未接受候选在 owner 接受前重验；不抹除已有合法历史证据。当前不可读时仅保留允许元数据及不可用提示。

检索文本是不可信证据而非指令：带来源/信任标签、有界长度，不能改变角色、工具、门禁、答案披露。命中不证明掌握；不虚构页码，不复制教材全文/原始学生对话/token 到成长、家长或公开作品。

## 4. 连接与供应链

固定批准 server identity、transport、tool schema digest、adapter 版本、网络目的地、数据级别与风险。Registry 收录是发现线索，不是安全认证；传输需明确，历史 SSE 与 Streamable HTTP 不能混写。

- HTTP 授权按所选规范/实际部署执行，校验资源受众，禁止 token passthrough、混淆代理、把 session ID 当身份。现有 IMA service credential 不等于已实现 OAuth。
- 外连只允许批准 origin/路径；防 DNS/私网/云元数据 SSRF、重定向，限制超时/分页/响应/并发/重试。本地桥须显式隔离，学生不能传 URL。
- annotations/描述/结果不可信；输入/输出 schema 与业务范围仍校验。新增工具/schema 漂移/服务身份改变 fail closed 后评审，不静默扩权。
- `stdio` 仅用于明确隔离的运维场景；不因安装 Skill 启动任意进程，不接受学生可执行包/安装命令。
- secret/endpoint 留在 Admin gateway/secret 流程，不进模板、Skill、快照、浏览器或日志。错误脱敏，区分不可用、越权、过期、超时。

## 5. 新适配器准入

必须登记 owner、用户价值、原服务/API/条款、固定代码/schema/hash、认证、输入数据类别、端点、scope 来源、读写级别、预算/缓存、撤权/审计、故障降级和威胁测试；缺项不发布。

OpenAlex/Crossref 候选只查询有界 bibliographic metadata，不任意抓网页/下载全文，不提交姓名/学校/学生原话；服务器构建去标识化查询，验证 DOI/标题/年份。实现前重新核验配额/条款，不硬编码未确认额度。缓存按 scope 隔离并保留来源/时间，不共享泄漏私有资料。

光学优先 `specVersion + typed parameters + deterministic output` 内部 handler。Tool ID 在正式 contracts 一次定义，不在方案另发同义 ID。证据提交走 server-owned action/evidence，不提供 `write_database`、`mark_mastered`、`advance_stage`。

## 6. 验收与恢复

四工具分别覆盖合法/空 grant/错 KB/列表侧漏/伪 ref/跨项目-助手-binding/过期-重启/来源变化/schema 漂移/注入/discovery 后撤权。任一维 deny 都不能向上游发新请求；另测 HTTP auth/SSRF/异常响应/预算。

Worker 必须实际接 closures 并有 request/result trace；未接明确不支持工具任务。日志仅有 IDs、授权 revision、有界状态/耗时/字节/request ID，不记 token、完整查询、全文或学生原话。

检索失败标未核验，不接受依赖来源的事实候选；仍可显示明确的一般性安全引导，不能静默换 KB/助手/模型。loading、empty、error、offline、permission-denied、expired、partial-success 都有回执，成功须经服务端回读。
