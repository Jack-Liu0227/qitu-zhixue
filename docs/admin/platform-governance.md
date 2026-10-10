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
- `/admin/settings/model-providers`：供应商凭证、模型目录和连接测试。
- `/admin/settings/models`：由 Provider Registry 聚合的模型视图和连接测试，不单独保存模型目录。
- `/admin/settings/knowledge`、`templates`、`database`：知识、模板和数据库状态。

模型选择已经并入 AI 运行时。旧模型用途 API 只作为后端兼容和迁移边界，不再有独立导航或管理页面。

## 权限与数据边界

- 前端只负责显示；所有 Agent、供应商、模型和对象级权限由后端再次校验。
- 涉及未成年人数据时默认最小化可见范围，并保留审计记录。
- 密钥、MCP 凭据、完整系统提示词和未成年人原始对话不进入治理投影。
- 数据库不可达或状态无法证实时返回 `unknown` / `unavailable`，前端不得推断为已就绪。

## AI 运行时

运行时页面集中展示根目录 `AGENTS.md`、已加载 Skills、Agent-local `AGENTS.md`、直接选择的供应商与模型、显式 Skill/Tool/MCP 绑定和初始化检查。开发协作目录（例如 `.pi`）不自动进入 Tutor runtime。

Agent 写入使用 Admin-only API、幂等键、事务和审计。子 Agent 不默认继承 Tool/MCP；Skill 继承必须显式声明。模型调用前服务端重新解析 Agent 配置，客户端不能直接写入模型决策、项目状态或成长档案。
<!-- Settings navigation: the sidebar is the only section switcher; /settings/models redirects to /settings/model-providers. -->

The settings UI now uses the sidebar as its single source of navigation. Provider credentials and model records are edited together in the provider workspace, while the legacy `/settings/models` route only redirects for bookmark compatibility.
