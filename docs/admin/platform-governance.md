# 平台治理（管理端总览）

管理端是平台治理控制面，默认展示聚合指标、权限关系、模型供应商、AI 运行时和初始化状态，不承担班主任的日常学生处理。

## 页面与导航

`apps/admin-console` 使用 `basePath: '/admin'`。设置入口保持冻结：

| 导航         | 实际路径                     | 说明                 |
| ------------ | ---------------------------- | -------------------- |
| 治理概览     | `/admin`                     | 平台总览和聚合指标   |
| 学生数据统计 | `/admin/students/statistics` | 聚合治理投影         |
| 关系绑定     | `/admin/relationships`       | 监护关系和班主任分配 |
| 设置         | `/admin/settings`            | 设置索引和子导航     |

设置子页面包括：

- `/admin/settings/ai-runtime`：AGENTS.md、Skills、模型、Tools、MCP、Agent 配置和初始化检查。
- `/admin/settings/assistants`：助手目录、启用状态和 Agent 直接模型选择。
- `/admin/settings/teams`：团队成员、协同 route 开关和真实 Team Run 测试。
- `/admin/settings/model-providers`：供应商凭证、模型目录、连接测试、用途场景和 Agent 链路绑定。
- `/admin/settings/models`：旧书签重定向到供应商工作区，不单独保存模型目录。
- `/admin/settings/knowledge`、`templates`、`database`：知识、模板和数据库状态。
- `/admin/settings/feishu`：管理员汇报助手的 Feishu/Lark 机器人配置、手机授权状态和汇报范围；该页面不保存明文凭证。

模型专属覆盖在 AI 运行时维护；用途模型和链路自动分发在供应商工作区维护，不增加导航。管理员明确选择用途后才清空专属覆盖；学生不能自由换模。

## 权限与数据边界

- 前端只负责显示；所有 Agent、供应商、模型和对象级权限由后端再次校验。
- 涉及未成年人数据时默认最小化可见范围，并保留审计记录。
- 密钥、MCP 凭据、完整系统提示词和未成年人原始对话不进入治理投影。
- 数据库不可达或状态无法证实时返回 `unknown` / `unavailable`，前端不得推断为已就绪。

## AI 运行时

运行时页面集中展示根目录 `AGENTS.md`、已加载 Skills、Agent-local `AGENTS.md`、直接选择的供应商与模型、显式 Skill/Tool/MCP 绑定和初始化检查。开发协作目录（例如 `.pi`）不自动进入 Tutor runtime。

Agent 写入使用 Admin-only API、幂等键、事务和审计。子 Agent 不默认继承 Tool/MCP；Skill 继承必须显式声明。模型调用前服务端重新解析 Agent 配置，客户端不能直接写入模型决策、项目状态或成长档案。

### Feishu/Lark 管理汇报助手

Feishu 只是外部通知渠道，不是新的权限边界。管理员配置、二维码会话、凭证轮换和发送状态均由服务端持久化并审计；`open_id` 必须映射到启途管理员后才能生成报告。报告助手只读聚合学生、家长授权投影和教师运营摘要，默认最小化可见范围，禁止发送原始未成年人对话或语音。手机扫码绑定、状态机、错误码和真实租户验收以 [`../plan/20261017-feishu-reporting-assistant.md`](../plan/20261017-feishu-reporting-assistant.md) 为准。
<!-- Settings navigation: the sidebar is the only section switcher; /settings/models redirects to /settings/model-providers. -->

The settings UI now uses the sidebar as its single source of navigation. Provider credentials and model records are edited together in the provider workspace, while the legacy `/settings/models` route only redirects for bookmark compatibility.

### 知识库与 JSON 配置树

当前知识相关配置统一位于“知识库”下，ima 作为知识引擎实例纳入其中。JSON 工作台保留原双卡布局，子工具可展开查看真实参数；目标映射、管理员目录接口及未提供 schema 的状态边界见 [工具与 MCP JSON 配置树](./mcp-json-tree.md)。统一配置以 `platform-config` 修订为准。

### 历史 ima 集成兼容说明

以下记录旧版 ima 专用接口与迁移背景；当前配置入口与项目检索治理以知识中心及上述统一配置树为准。

`设置 → 工具与 MCP` 的 ima 总开关、助手授权矩阵、运行时 Agent 绑定、JSON 编辑及预览均读取服务端配置。`GET/PATCH /api/v1/admin/ai-runtime/mcp/ima-knowledge` 只向管理员开放；写入必须携带幂等键，并在事务内审计。`POST .../check` 实际完成 MCP 握手并读取知识库清单；连接正常与允许调用是两个独立状态，关闭总开关仍可检查连接。

学生 Tutor 必须同时通过全局开关、运行时 Agent 工具白名单、当前阶段助手授权和角色启用检查；每次新工具请求前重新查库，已发现的工具也不能绕过撤权。已发出的上游请求可能完成。数据库异常时拒绝调用。此配置不修改助手启停、模型绑定或教学门禁。

浏览器 JSON 仅允许 `enabled`、`assistantBindings`、`agentBindings`，不接受地址、命令或凭证。连接参数和 ima 密钥保留在服务器配置中，响应不含密钥或上游原始错误。旧页面的本地 MCP 草稿不再被当作已连接服务，不修改或删除其浏览器存储。

新增工具、MCP、Skill、助手和团队必须进入服务端注册表或配置库，并提供真实状态、授权绑定和失败状态；只写浏览器存储不算完成接入。设置总览与工具页能力清单读取后端状态，不能用默认数量或模拟延迟宣称就绪。

升级已部署的 ima 集成时执行 `tooling/migrate-ima-admin.sql`，一次性保留既有阶段导师的访问授权；迁移审计键防止重跑后覆盖管理员撤权。该迁移不启用已停用的助手，不修改任何模型。新助手默认无 ima 授权，管理员须在矩阵明确授予。

验证：API 单测覆盖管理员权限、字段白名单、敏感信息脱敏、全局/角色/工具/阶段授权和数据库异常；MCP 客户端测试覆盖工具发现后撤权不向上游发请求。发布时还需验证真实连接、开关刷新持久化、JSON 保存、矩阵撤权和桌面/移动端页面。

### 知识库卡片选择与助手绑定

知识库卡片左上角显示选择框，单击卡片选中一个知识库，双击打开详情；键盘空格选择，Enter 打开。列表下方的“检索助手绑定”始终显示当前选中库的助手，而非平台整体检索权限。未选择时显示引导，读取失败支持重试。勾选或取消后点击“保存助手绑定”调用逐库绑定接口，沿用修订校验、幂等与权限控制，并保留其他类型 Agent 的绑定。切换库丢弃未保存草稿；快速切换不得显示上一个库的延迟响应。全局工具开关和助手启用状态仍限制实际检索。
