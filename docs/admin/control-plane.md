# AI 运行时与初始化控制面

## 边界

`GET /api/v1/admin/ai-runtime` 返回服务端脱敏快照；Agent 的 `POST` / `PATCH` 由管理员执行，并要求 `Idempotency-Key`。初始化操作只允许受限的 foundation 写入，数据库 schema migration 永远通过部署或 CLI 执行。

运行时快照包含根 `AGENTS.md`、`.agents/skills/*/SKILL.md`、Agent 配置、内置 Tools、MCP 安全元数据和初始化状态。Agent 配置在同一个表单中维护：角色定义、Agent-local `AGENTS.md`、直接选择的 `providerId + modelId`、能力、Skills、Tools 和 MCP。不存在独立的模型用途绑定步骤。

根 `AGENTS.md` 是服务端加载的全局策略，随运行时快照以版本和内容指纹引用；它不能由浏览器、Agent prompt 或单个 Agent 配置覆盖。Agent-local 定义只提供受限的角色说明，权限、对象范围和领域不变量仍由服务端执行。

## 管理 API

| 方法 | 路径 | 权限 | 幂等 |
|---|---|---|---|
| GET | `/api/v1/admin/ai-runtime` | admin | 否 |
| POST | `/api/v1/admin/ai-runtime/agents/:agentId` | admin | 必填 |
| PATCH | `/api/v1/admin/ai-runtime/agents/:agentId` | admin | 必填 |
| GET | `/api/v1/admin/initialization` | admin | 否 |
| POST | `/api/v1/admin/initialization/{knowledge\|template\|tutor}/execute` | admin | 必填 |

服务端在 Agent 写入时校验模型是否存在且启用、供应商和模型是否成对出现、绑定的 Skill/Tool/MCP 是否属于注册表，并在同一事务写审计日志。模型凭证永远不返回给前端。

## 快照语义

`agents` 来自 `agent_configs` 及其 binding 表；旧数据库可短暂回退 `tutor_partners`。每个 Agent 返回 `modelProviderId`、`modelId`、`modelLabel` 和 `modelAvailable`。`modelOptions` 是脱敏的可选模型列表，供 Agent 编辑器联动选择服务商和模型。

`agent_configs.model_usage` 仅是旧数据兼容字段。迁移 `0016_agent_direct_model_selection.sql` 会把旧 `tutor.chat` 绑定复制到直接模型字段；新写入以直接模型字段为准。

## Team Runtime 通信

Tutor Agent 作为 Team Leader 创建 `TeamRun`，通过已启用的 route 委派 `TeamTask`。服务端同时写入收件箱 `TeamMessage`；worker 以租约领取消息并把执行结果记录为任务状态和 `TeamEvent`。浏览器只能读取运行图和状态投影，不能伪造 Agent、任务、事件或领域写入。

事件经 outbox 投递到异步投影 worker。learner profile、growth trajectory 等结果先写入 `agent_projection_candidates`，由对应领域服务重新校验、幂等接受并审计；候选行本身不是成长档案、画像或项目事实。

## 前端状态

`apps/admin-console/app/(console)/settings/ai-runtime/page.tsx` 必须覆盖 loading、empty、error、offline、403 和接口未部署状态。模型供应商页面负责接入和刷新目录，AI 运行时页面负责 Agent 的最终模型选择，两者通过 `modelOptions` 连接。
