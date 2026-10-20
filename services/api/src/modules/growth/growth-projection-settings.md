# 画像与成长用途绑定和事件任务授权

## 范围

Admin 的画像助手、成长助手选择持久化为 `platform_configuration_revisions.config.growthProjection`。
只保存精确 `profileAssistantId` / `growthAssistantId`，没有默认别名或按名称推断。
每个非空 ID 必须同时存在于已启用的 `admin_assistants` 和 `agent_configs`。
未配置时返回 `unconfigured`；配置就绪只说明身份可用，不代表模型、工具或事件路由已经成功。

用途写入复用平台配置的锁 `281017`、revision 并发检查、审计和请求幂等键。
知识中心编辑器保留该分区，但不能绕过用途 owner 更改它。

## API 与权限

- `GET /admin/growth-projection/settings`：Admin 专用，返回当前 revision、用途设置、可选助手和身份就绪状态。
- `PATCH /admin/growth-projection/settings`：Admin 专用，要求 `idempotency-key`，请求为 `{expectedRevision,settings}`。
- `GrowthProjectionSettingsService.save` 自身再次检查 Admin，管家调用也复用此入口。
- `GrowthProjectionOwnerService.accept/reject` 自身再次检查 Admin；教师评审尚未提供对象授权合同，不能直接使用此入口。

写入结果从同一事务内回读，审计动作 `growth.projection.settings.save` 只含用途 ID 和版本元数据。
模型密钥、原始对话和未成年人资料不进入设置与审计。

## 入队与执行

服务端把 `{routeId,trigger,fromAgentId,toAgentId,taskType}` 写进 task input 的 `authorization`。
API 委派强制覆盖客户端同名字段。事件队列与 Worker 自动委派也写入此字段。

Worker 执行时核对 task/message/run/mailbox 范围，精确回查当前启用的路由及双方 Agent。
`projection.request` 只能使用持久化的 `event` 授权；旧的无元数据委派仅可使用 `delegate` 路由。
消息 payload 不能提供授权或覆盖任务输入。用途绑定在入队与执行时分别读取，更换或停用立即阻止旧任务继续调用模型。
`runtime: admin`（包括 `qitu-project-configurator`）不会被教学或画像 Worker 加载。

## 候选与读取

Worker 结果保持 `proposed`。接受时 owner 再检查当前用途、助手启用、成功任务与事件路由、来源事件、学生/项目归属、证据引用和结果版本。
已接受的历史结果显示实际生产助手，不因全局用途修改而伪装成新助手生成。
无已接受结果时，学生投影的助手 provenance 为 null。

## 错误与边界

主要错误码：`GROWTH_PROJECTION_ADMIN_REQUIRED`、`GROWTH_PROJECTION_SETTINGS_INVALID`、`GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE`、`CONFIG_REVISION_CONFLICT`、`CONFIG_READBACK_FAILED`、`IDEMPOTENCY_KEY_CONFLICT`、`PROJECTION_PURPOSE_UNCONFIGURED`、`PROJECTION_ASSISTANT_UNAVAILABLE`、`PROJECTION_PURPOSE_CHANGED`、`TEAM_TASK_SCOPE_INVALID`、`TEAM_TASK_AUTHORIZATION_INVALID`、`TEAM_AGENT_ROUTE_NOT_FOUND`、`PROJECTION_TASK_INVALID`、`PROJECTION_ROUTE_REVOKED`。

未配置事件会失败/重试，不能被宣称已完成画像分析。已有队列重试上限与失败记录仍由 Worker 管理。
本切片没有完成所有对话事件覆盖、授权学习内容装配、自动接受、历史回填和成长页面完整投影。
现有输入只包含有界引用与元数据，不能把一个生成候选视为可靠的学情结论。

## 验证说明

回归测试覆盖用途保存与回读、幂等/CAS、全局配置保留、权限拒绝、停用撤权、实际配置 ID、精确事件路由、错误 trigger/from/to/task 拒绝、旧委派兼容、Admin Skill 排除和真实 HTTP 模型适配器调用（本地合成 fixture）。
这些检查不构成真实学生数据、生产模型或全课时验收。
