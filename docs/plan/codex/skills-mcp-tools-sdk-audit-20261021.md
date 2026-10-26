> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# Skills、MCP、内置工具与 SDK 审计

> 状态：能力审计与改进记录；源码、配置、发布和真实调用分别判断。（2026-10-21）

> 日期：2026-10-21。源码基线：`1643b4a` 加当前工作树。此文为代码审计、隔离复现和优化建议；未修改业务实现、未读取生产凭据、未调用真实模型/MCP，不能据此判断线上连接状态。

> 后续已实施部分优化，当前结果与剩余事项见 [优化及验证报告](./runtime-governance-optimization-20261021.md)。下文保留修复前的审计事实。

## 1. 结论

项目已适配 Pi 的模型层，已有启途自己的 Agent 范围合同、教学领域服务和知识工具执行器；未集成完整 Pi Agent Core / Coding Agent 工具集。Skills 中心、普通助手、SDK facade、团队 Worker 与知识工具之间仍存在不同目录和加载逻辑。

优先修正 SDK 未执行却返回成功、API/Worker 的 Skill 范围与撤销规则、项目知识授权，然后统一工具目录与执行边界。

## 2. Pi 接入到哪一层

| 能力 | 当前源码事实 |
| --- | --- |
| 模型协议适配 | `@qitu/model-runtime` 基于 Pi `packages/ai`，本地 UPSTREAM 记录 0.87.1、commit `f07218c4d4bbc12bef056a7058c3dd49dfe41abe` |
| 模型工具调用循环 | `completeWithPi` 接收服务端注入的工具 schema / execute，保留工具回执，最多 8 次调用，带超时/取消信号 |
| 启途 Agent Runtime | `createTutorAgentRuntime` 绑定 actor/student/project/session，校验模型用途、上下文及输出；执行由注入端口承担 |
| Pi Agent Core | 未发现包依赖或完整 Agent Core 源码接入 |
| Pi Coding Agent | 未发现包依赖或其文件/终端工具的执行接线 |
| `read`、`write`、`edit`、`bash`、`grep`、`find`、`ls` | 未作为这些 Pi 内置工具接入产品 SDK；开发环境能使用终端/文件工具不代表产品助手有这些能力 |
| 通用 MCP host | 未发现可驱动任意已登记 MCP 的统一执行器；已有专用 IMA Streamable HTTP 客户端 |

本地证据：[UPSTREAM](../../../packages/model-runtime/UPSTREAM.md)、[模型运行时](../../../packages/model-runtime/src/runtime.ts)、[Agent Runtime](../../../packages/ai-client/src/agent-runtime.ts)。

Pi 官方把有状态执行循环放在 Agent Core，Coding Agent SDK 提供会话、资源和工具配置；其工具示例明确演示文件与终端工具。官方当前文档用于对照能力分层，不表示本地固定版本已自动获得这些能力：[Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)、[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[工具示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/05-tools.ts)。

## 3. 当前工具清单

### 3.1 Admin 内置工具目录：6 项

| canonical ID | 描述职责 |
| --- | --- |
| `tutor.context_packet` | 组装受限教学上下文 |
| `tutor.pedagogy_move` | 选择追问、提示等教学动作 |
| `tutor.mastery_gate` | 检查理论掌握门禁 |
| `tutor.escalation` | 学习困难升级与教师介入 |
| `agent-memory.index` | 记忆索引事件处理 |
| `project.next_step` | 下一学习目标选择，描述要求 TheoryMastered |

[built-in-tools.ts](../../../services/api/src/modules/platform-registry/built-in-tools.ts) 返回描述符、风险、能力和默认 agentIds，目录 status 写为 enabled；没有提供这 6 项各自的统一 `execute` 入口。相关领域服务存在，但不能仅凭目录 enabled 判断模型可以直接调用。`project.next_step` 也不能被理解为允许模型写阶段完成事实。

### 3.2 SDK facade：4 项声明，默认没有执行器

| SDK ID | 声明功能 | 当前默认行为 |
| --- | --- | --- |
| `mastery_query` | 查询掌握度 | 返回参数回显 |
| `learning_plan_advance` | 学习计划/项目门禁流转 | 返回参数回显 |
| `student_profile_get` | 获取学生画像 | 返回参数回显 |
| `knowledge_search` | 检索知识库 | 返回参数回显 |

它们位于 [qitu-sdk.ts](../../../packages/ai-client/src/qitu-sdk.ts) 的 `BUILTIN_TOOLS`，缺少 `execute` 和输入 schema。`tools.call` 没有执行器时返回 `{ok:true,tool,echoed}`；`mcp.callTool` 没有 `mcpExecutor` 时返回 `{ok:true,server,tool,arguments}`。

[QituSDKFactory](../../../services/api/src/modules/qitu-sdk/qitu-sdk.service.ts) 当前只给 facade 注入 mastery / agent / project / profile，没有注入 tools / skills / mcpExecutor。独立的 `sdk.mastery.*`、`sdk.project.*`、`sdk.profile.get()` 接到了领域 owner，不能与上述工具回显路径混为一谈。生产源码搜索未发现调用这两个 facade 工具方法的业务调用点；这是已复现的潜在误报，未证明已有真实请求受影响。

### 3.3 具有实际执行代码的知识工具

| 入口 | 工具 |
| --- | --- |
| 平台知识服务 | `knowledge_search`、`knowledge_read` |
| IMA 专用 MCP 客户端 | `ima_list_knowledge_bases`、`ima_search_knowledge`、`ima_list_documents`、`ima_read_document` |

[KnowledgeRetrievalService.tools](../../../services/api/src/modules/knowledge/knowledge-retrieval.service.ts) 为前两项提供 schema、参数检查和执行 closure；[ImaMcpClient](../../../services/api/src/modules/ai-tutor/ima-mcp.client.ts) 实现 initialize / tools/list / tools/call、四工具白名单和执行前动态授权。

这些通过 [GatewayTutorProvider](../../../services/api/src/modules/ai-tutor/gateway-tutor.provider.ts) 传给模型运行时，绕过上述 SDK facade 的占位路径。`knowledge_search` 因而存在“SDK 默认占位”和“知识服务真实执行”两个同名事实层。真实 IMA 请求仍依赖部署连接、当前授权和资料，审计没有探测线上可用性。

### 3.4 配置里出现的其他名称

[内置助手声明](../../../packages/ai-client/src/assistant-registry.ts) 包含 27 个不同 toolIds，与 6 项 Admin canonical 目录不一致。例如 `simulation_runner`、`data_analyzer`、`code_syntax_check`、`artifact_review`、`radar_synthesizer`、`project_recommend` 等尚未在上述统一内置工具目录注册，不能仅凭绑定声明视为已接入的通用工具。实际相关能力可能由专用业务流程完成，需要逐个映射现有 owner，不能简单补名字或给模型写事实权限。

[历史 MCP 清单](../../../services/api/src/modules/platform-registry/legacy-mcp-catalog.ts) 的 Grok、Chrome DevTools、AionUI Browser、Fetch 共 16 个子工具是展示 manifest；代码明确说明未经过真实 MCP 发现/执行核验。新管家自定义 MCP 登记也保持 disabled / not_configured。

管家的 19 类管理动作在 [AdminCopilot 合同](../../../packages/contracts/src/admin-copilot.ts) 和 [操作适配器](../../../services/api/src/modules/admin-copilot/copilot.operations.ts) 中执行，尚未投影为统一 SDK 工具目录。它们受 Admin 权限保护，不能通过普通助手 toolIds 授权给学生。

## 4. 已复现的加载与执行问题

| 问题 | 证据与影响 |
| --- | --- |
| SDK 未执行却成功 | 无 tools / mcpExecutor 的 fixture 调用 `mastery_query`、虚构 MCP 工具均返回 ok:true，领域调用计数为 0 |
| 教学 Skill 撤销未生效 | 合成 `runtime: teaching, status: revoked` 文件仍被 API loader 判为 ready，`buildTutorRuntimeBlocks` 将正文放进提示 |
| Worker 范围规则落后 | 合成绑定下，Worker 同时加载了 admin / published 和 teaching / revoked 文件；其独立 parser 仅排除 dev-only |
| SDK Skills 目录仍独立 | facade 返回 guided / planning / escalation / qitu-interactive-concept 四项硬编码声明，不读取统一目录或实际助手绑定 |

上一轮 77 项验证覆盖 API / 管家 / 注册表和相关页面类型，不能视为 Worker 的范围隔离验收。本轮发现的独立 Worker loader 需补齐。API 管理 Skill 加载本身已检查 admin / ready / published；这里的撤销问题发生在普通教学加载路径。

定位：[API source loader](../../../services/api/src/common/tutor-runtime/runtime-source.ts)、[助手运行解析](../../../services/api/src/modules/platform-registry/platform-registry.service.ts)、[Worker loader](../../../services/workers/src/team-runtime-executor.ts)。

复现方式：读取当前源码，用 TypeScript `transpileModule` 在内存转成 CommonJS 后执行；无数据库、模型或网络连接。SDK 的非目标团队目录依赖使用空 fixture，领域端口只计数；Skill 文件仅写入系统临时目录，Worker 数据库用合成绑定，执行后删除 fixture。

```json
{"kind":"sdk-no-executor","toolResult":{"ok":true,"tool":"mastery_query","echoed":{}},"mcpResult":{"ok":true,"server":"fixture-server","tool":"fixture-tool","arguments":{}},"domainCalls":0}
{"kind":"revoked-skill","status":"ready","publicationStatus":"revoked","includedInTeachingPrompt":true}
{"kind":"worker-scope","loadedIds":["admin-fixture","revoked-fixture"],"productionDataUsed":false}
```

上述结果是缺陷复现，不是功能通过；未修改业务代码来改变结果。

## 5. 优化优先级

### P0：先让状态、权限与执行一致

1. **取消 SDK 假成功**：无 handler 返回稳定不可用错误；真实执行器由服务端 owner 注入，区分 unknown / not configured / denied / failed。测试要断言未配置时绝不成功、无权限时不调用 owner。
2. **共享 Skill 解析和准入规则**：API / Worker 复用同一服务端实现，明确 runtime 范围、发布状态、版本/hash、未知元数据和损坏文件的处理。新教学制品仅发布后使用；兼容旧技能须显式迁移，避免全局过滤突然停掉存量助手。revoked 必须立即拒绝，Admin 技能不能进入教学 Worker。
3. **完成项目知识授权交集**：当前 Tutor 传入检索 closure 的是 studentId + assistantId；原生 IMA callback 主要检查助手/server/tool。还需注入 frozen project/binding/session 和 KB ceiling，四工具分别校验参数、结果和文档来源，避免当前 Admin 新增库扩大旧项目。复用已有知识 owner 与 provenance 存储。
4. **统一工具定义与授权视图**：Admin 工具页、助手绑定、SDK、模板编译、API 和 Worker 使用同一 canonical 清单；保留各领域执行 owner。每项必须有 schema、版本/hash、执行器类型、scope、读写分类和状态。现有 27 个声明 ID 逐项迁移，缺能力显示未实现，禁止仅登记名称就标为可调用。

### P1：把加载、运行和历史展示接完整

5. **SDK 使用服务端解析结果**：skills / tools / MCP / assistants / teams 从当前授权及冻结绑定投影，不再由 facade 返回硬编码四 Skill、内置助手和两套团队。角色范围从服务器注入，Skill 声明依赖不自动增加权限。
6. **统一执行循环和事件**：目前 complete 路径有工具循环，stream 路径没有给 Pi context 注入 tools；Tutor 把工具事件暂存在数组，等 complete 返回后才 yield。改为统一带 schema 校验、调用预算、幂等回执、即时事件和可恢复 trace 的执行边界，再连接右侧团队历史。写工具继续走领域 owner。
7. **补 Worker 的真实工具能力**：当前 Worker 调 `runtime.complete` 未传 tools，读取自己的 agent_configs / agentSkillBindings 并自行加载文件。应消费同一受治理能力解析和受限 closure；未接入时明确任务不支持工具，不能仅在 prompt 中列出名称。
8. **补 Skill 生命周期与按需加载**：统一目录已经解决显示问题，但 UI 内容编辑仍不能持久写回运行时文件；增加不可变版本、验证、发布/撤销和回读。候选技能先只提供目录摘要，按本轮角色/任务加载获准正文，设总上下文预算，避免仅依赖每文件截断。
9. **MCP 连接状态分层**：分别展示登记、发现 schema、连接探测、当前授权、最近调用结果；通用 transport adapter 逐项接入，不能把历史 manifest 当实时 schema。发现缓存失效不能扩大授权。

## 6. 通用 Agent 工具接入建议

现有架构可以保留 Pi 模型适配层，先补齐启途的受控执行器。若需要通用循环、取消、事件与上下文处理，可评估 Agent Core 的明确适配接口；不要把 Coding Agent 的默认会话/目录/凭据发现隐式带入教学应用。

| 场景 | 建议接入范围 |
| --- | --- |
| Admin 管家 | 已有助手、团队、工作流、模板、技能、知识与模型操作；统一投影并复用现有执行器 |
| 学生 AI 搭档 | 已授权检索、受控计算、注册实验模型、题目呈现与答案提交、作品提交；阶段/掌握/作品通过由 owner 决定 |
| 隔离开发或教师制作空间 | 如确需 Pi 文件读写、搜索、终端工具，限定可丢弃工作区、批准命令/网络和资源预算，独立授权 |

Mermaid、KaTeX、BoardBlock 是展示合同；渲染成功不代表有代码执行权限。光学沿用注册模拟模型和 server-owned action/evidence 协议。

推荐实施顺序：SDK 错误语义 → Skill 统一加载/撤销 → canonical 工具目录与执行器映射 → 项目知识授权 → API/Worker 事件与真实工具闭环 → 新增通用工具。

## 7. 本轮交付范围

新增本审计文档并链接到方案入口；业务代码和已有用户修改保留。完成源码搜索、官方 Pi 文档核对和三类隔离缺陷复现，没有重新执行全仓构建、线上数据库写入、模型或 MCP 连通性验收。既有治理细节继续见 [MCP 与工具治理](./mcp-tool-governance.md)，本报告补充当前代码事实。
