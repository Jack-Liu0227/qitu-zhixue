# 飞书/Lark 管理汇报助手实施任务

> 状态：`implemented / real-tenant validation pending`
> 评审基线：2026-10-17
> 目标：为管理员提供一个只读的“学生—家长—教师管理汇报助手”，并允许在每个助手的设置中完成飞书（Feishu/Lark）绑定、授权和汇报范围配置。

本文是需求拆解和验收台账，不把未完成的代码描述成已交付能力。实现合入 `main` 前，必须逐项完成本文件的验收条件，并同步更新状态。

## 1. 需求边界

### 1.1 必须交付

- 新增一个服务端管理汇报助手，面向管理员聚合学生项目进度、家长授权投影和教师工作量/待处理事项。
- 每个助手可以独立配置一个 Feishu/Lark 机器人；至少支持 Feishu 与 Lark 两个域名。
- 管理员可以在设置中查看连接状态、选择汇报助手、选择汇报范围，并通过手机扫码完成绑定。
- 所有凭证只在服务端保存（加密），前端和普通查询接口只能看到脱敏状态。
- 报告只发送经过对象级权限校验和最小化脱敏的摘要；原始未成年人对话、语音和内部风险标签不得外发。
- 写操作具备幂等键、审计记录、明确错误码和可重试行为。

### 1.2 不在本次范围

- 不把飞书机器人变成学生端聊天入口，不改变现有四个平台导航。
- 不允许飞书回调直接修改项目阶段、掌握度、成长档案、AI 决策或审计事实。
- 不把 Feishu `open_id` 当作启途管理员身份；必须先映射到已认证管理员和其可管理对象范围。
- 不提交 `.env`、App Secret、Token、二维码会话原文或未脱敏的未成年人数据。

## 2. 任务拆解

### F0. 工作区与依赖基线（P0）

**目标**：在独立分支完成可审查的最小闭环，不污染主分支既有改动。

- [x] 从最新 `main` 创建 `feature/feishu-assistant`，记录基线 SHA 和影响范围。
- [x] 确认数据库迁移编号、种子执行顺序、`@qitu/contracts` 导出和 API 前缀均与现有单体架构一致。
- [x] 记录 `QITU_MODEL_SECRET_KEY` 与 `QITU_FEISHU_REDIRECT_URI` 的部署要求；只提交 `.env.example`，不提交真实值。
- [x] 依赖审查：确认是否使用官方 Feishu/Lark SDK；若引入二维码库，优先本地生成，禁止把授权 URL 发送到第三方二维码服务。

**完成标准**：分支可独立安装、迁移可重复执行，`pnpm typecheck` 能定位到真实代码而不是缓存或缺失依赖。

### F1. 管理汇报助手与数据合同（P0）

**目标**：建立“只读、可审计、按管理员范围聚合”的报告事实源。

- [x] 新增内置助手（建议 ID：`admin-reporting-assistant`），默认模型使用已注册的 `gpt-6.1-sol`；模型不存在时明确返回配置错误，不静默切换到未授权模型。
- [x] 定义报告输入：学生项目阶段/进度/最近活动/停滞信号、家长授权投影、教师在册人数/待介入/已解决事项。
- [x] 定义报告输出：摘要、时间范围、对象计数、数据来源和“已脱敏”标记；禁止输出原始会话、语音、密钥和内部提示词。
- [x] 增加只读报告服务/工具并挂接服务端权限；禁止复用 `growth_record_append`、项目状态写入等写工具。
- [x] 报告生成时重新解析管理员角色、组织/班级/学生范围，不能信任客户端或 Feishu 配置中的范围字段。

**完成标准**：用一个管理员账号只能看到其授权范围，越权对象返回 `403`，报告生成留下审计事件但不记录原文。

### F2. Feishu 配置持久化与密钥治理（P0）

**目标**：为每个助手保存独立配置，并保证敏感字段永不回显。

- [x] 建立 `feishu_bots`（按 `assistant_id` 唯一的机器人配置）和 `feishu_qr_sessions`（短期授权会话）表；会话设置过期时间和状态机：`pending → bound | expired | cancelled`。
- [x] `app_secret`、`verification_token`、`encrypt_key` 使用服务端密钥加密；数据库、日志、审计详情和响应均不得出现明文。
- [x] `reportRecipients` 只保存必要的 Feishu 身份标识；日志使用哈希或计数，不写入原始 `open_id`。
- [x] 为 PATCH、创建二维码会话和应用绑定分别定义幂等作用域；重复请求返回第一次结果，不重复写入或发消息。
- [x] 增加管理员权限校验、数据库不可用错误（`503`）、字段白名单校验和审计动作名称。

**完成标准**：数据库迁移/回滚可重复运行；敏感字段轮换不会覆盖未提交字段；GET 配置只返回 `credentialConfigured/connected` 等状态。

### F3. Feishu/Lark 手机扫码绑定（P0）

**目标**：通过手机完成一次性授权，并把绑定结果安全写回指定助手。

- [x] 首选实现 Feishu/Lark Device Authorization：`registration begin → verification_uri_complete → poll`；处理 `authorization_pending`、`slow_down`、拒绝、过期和租户域名切换。
- [x] 设备码、state、client secret 只保存在服务端短期会话；前端只能拿到二维码图片/授权 URL、状态和过期时间。
- [x] 若保留传统 OAuth 回调，回调必须使用绝对 HTTPS `QITU_FEISHU_REDIRECT_URI`，并校验服务端 state 后再交换 code；禁止接受相对 URL 或客户端自带 device code。
- [x] 成功后将 `client_id/client_secret/open_id` 映射到目标助手；同一收件人幂等去重，绑定动作写审计。
- [x] Feishu 与 Lark 使用正确的账户域名、API 域名和显示名称；不要把“Lark”当作第三种独立产品。

**完成标准**：手机扫码成功后轮询最终返回 `bound`，刷新页面仍能看到 `connected`；过期/拒绝后可重新开始，旧会话不能再次应用。

### F4. 管理端设置与助手入口（P0）

**目标**：在冻结的 `/admin/settings` 信息架构内提供可操作、可恢复的设置页。

- [x] 新增 `/admin/settings/feishu`（或经评审后并入助手详情页），支持选择助手、Feishu/Lark 域名、启用开关、汇报范围和绑定状态。
- [x] 每个助手详情提供“配置飞书”入口；助手列表不得截断可选项，选项来自服务端启用目录。
- [x] 提供加载、空数据、错误、断网、权限失败、二维码等待、过期和成功状态；错误中不暴露上游凭证或完整响应。
- [x] PATCH/创建会话携带 `Idempotency-Key`；保存成功后刷新服务端状态，不以本地草稿宣称已连接。
- [x] 展示危险操作提示：机器人可向管理员发送跨角色汇报，`full access` 不适用于该只读助手，任何外发必须经过服务端策略。

**完成标准**：管理员从设置页完成“选择助手 → 保存配置 → 手机扫码 → 轮询绑定 → 看到已连接”的流程；非管理员无法访问或修改。

### F5. 报告生成、发送与回执（P1）

**目标**：把汇报助手接入异步发送链路，避免 HTTP 请求阻塞和重复外发。

- [x] 通过 worker/outbox 生成日报或按需报告；报告消息带时间范围、来源和脱敏标记。
- [x] 发送前重新校验助手启用状态、管理员授权范围、收件人绑定和 Feishu 凭证；任一项失败则拒绝发送并记录可读错误码。
- [x] 对 Feishu API 超时、限流、撤回授权和网络断开实现指数退避、死信/人工重试和状态观测。
- [x] 记录发送结果、上游 request id（如有）和哈希后的收件人标识；不记录消息全文。
- [x] 支持管理员查看最近发送状态，但不开放学生/家长/教师端查看管理汇报原文。

**完成标准**：同一幂等键只产生一条外发消息；失败可重试且不会越权扩大收件范围；审计能够回答“谁、何时、向哪类对象、以何种结果发送”。

### F6. 测试、部署与验收（P0）

- [x] 合同/校验测试：字段白名单、长度、域名、权限、幂等键和错误码。
- [x] 密钥测试：加密/解密、脱敏、密钥缺失、密钥轮换；测试日志和审计中不存在明文。
- [x] Device Flow 测试：begin 参数、二维码 URL、pending、slow down、域名切换、成功、拒绝、过期、重复 poll。
- [x] API 测试：管理员 GET/PATCH、QR 创建/查询、OAuth callback state 绑定、越权 `403`、数据库不可用 `503`。
- [x] 前端测试：加载/空/错误/断网/权限失败、轮询停止、过期重试、助手切换和移动视口。
- [ ] 真实验收：测试租户完成一次 Feishu 与一次 Lark 绑定；发送脱敏报告；确认回滚迁移和撤销授权后的行为。
- [ ] 发布记录：影响范围、迁移编号、环境变量、权限风险、数据保留期、回滚步骤和验证命令。

## 3. Current implementation status (2026-10-17)

| 项目 | 当前状态 | 说明 |
| --- | --- | --- |
| Backend configuration/migrations/API | `implemented` | Assistant-scoped Feishu/Lark settings, Device Flow, OAuth callback, reporting and delivery-status APIs are implemented with migrations 0024-0027. |
| Secret encryption and redaction | `implemented` | App credentials and device codes are encrypted server-side; responses, logs, audits and reports expose only state, counts or hashes. |
| QR authorization | `implemented` | Feishu/Lark Device Authorization is complete; the admin client encodes verificationUriComplete locally with qrcode-generator and keeps the explicit URL fallback. |
| Admin settings page | `implemented` | `/admin/settings/feishu` covers assistant selection, Feishu/Lark switching, loading/empty/error/offline/permission states, polling, countdown and retry. |
| Reporting and delivery | `implemented` | Read-only aggregation, server permission gates, redaction, outbox enqueue, durable delivery idempotency ledger and admin delivery status query are wired. |
| Real Feishu/Lark acceptance | `pending` | A test tenant, registered Device Flow capability and deployment variables are still required; mocks do not count as tenant acceptance. |
## 4. API 合同草案

所有路径均位于 `/api/v1` 下，响应统一包裹为 `{ data }`。管理员写请求必须带 `Idempotency-Key`。

| 方法 | 路径 | 权限 | 作用 |
| --- | --- | --- | --- |
| `GET` | `/admin/integrations/feishu` | `admin` | 返回脱敏配置和 `connected/credentialConfigured` 状态。 |
| `PATCH` | `/admin/integrations/feishu` | `admin` | 更新非敏感配置及可选凭证；敏感字段只写不读。 |
| `POST` | `/admin/integrations/feishu/qr-sessions` | `admin` | 创建一次性手机授权会话，返回二维码 URL 和过期时间。 |
| `GET` | `/admin/integrations/feishu/qr-sessions/:id` | `admin` | 查询绑定状态；不能返回 device code 或 secret。 |
| `POST` | `/admin/integrations/feishu/device-sessions` | `admin` | Create an assistant-scoped Device Authorization session; return only the verification URI and expiry. |
| `POST` | `/admin/integrations/feishu/device-sessions/:id/poll` | `admin` | Poll one Device Flow session and return pending/slow_down/denied/expired/bound state. |
| `GET` | `/admin/integrations/feishu/deliveries` | `admin` | Read recent delivery status, retry classification and recipient counts without raw identities. |
| `GET` | `/admin/integrations/feishu/report` | `admin` | Build the redacted assistant-scoped management report; raw minor data is never returned. |
| `GET` | `/integrations/feishu/oauth/callback` | 无登录（state 绑定） | 交换授权 code，成功后只更新对应会话和收件人投影。 |

> 路由表是当前管理汇报助手的兼容入口。要满足“每个助手独立配置”，正式合同应增加 `assistantId` 路径参数（例如 `/admin/assistants/:assistantId/integrations/feishu`），或在服务端把它作为不可变的幂等作用域；不得由客户端通过任意 body 字段越权切换助手。

建议错误码：`FEISHU_CONFIG_INVALID`、`FEISHU_CREDENTIALS_UNAVAILABLE`、`FEISHU_QR_EXPIRED`、`FEISHU_QR_ALREADY_USED`、`FEISHU_AUTH_DENIED`、`FEISHU_UPSTREAM_UNAVAILABLE`、`IDEMPOTENCY_KEY_REQUIRED`、`FORBIDDEN`。

## 5. 数据与权限规则

- Feishu 身份只是渠道身份，必须映射到启途管理员账户；每次生成报告重新执行管理员角色和对象级权限校验。
- 默认最小可见范围：统计和趋势优先，学生姓名/明细仅在管理员确有权限且确有业务需要时展示。
- 不发送原始对话、语音、密码、令牌、完整提示词、内部风险标签或未授权家庭信息。
- 所有绑定、配置、发送和失败重试写审计；审计详情使用计数、状态和哈希标识。
- 机器人配置删除/禁用应立即阻止后续发送；已经发出的上游消息不承诺可撤回，需在运维手册记录风险。

## 6. 发布门槛与回滚

发布前必须满足：

1. `pnpm typecheck`、相关 API/前端测试和迁移 dry-run 全部通过，且记录非缓存执行证据。
2. 管理员权限、幂等、密钥脱敏、未成年人最小化和回调 state 测试均为绿灯。
3. 至少完成一次真实 Feishu/Lark 绑定和脱敏报告发送；没有测试租户时只能发布为关闭状态，不能宣称已接通。
4. 回滚顺序为：停用发送 worker → 禁用机器人配置 → 回滚前端/API → 按迁移 down 脚本回滚（保留审计和必要的绑定记录）。
5. 交付顺序为：推送 `feature/feishu-assistant` → 提交包含影响范围、验证方式和数据/权限风险的 PR → 评审通过后再合入 `main`；不直接覆盖远程主分支。

## 7. 相关文档与代码

- 平台治理与设置导航：[`../admin/platform-governance.md`](../admin/platform-governance.md)
- Team Runtime 权限与异步链路：[`../sdk/team-runtime.md`](../sdk/team-runtime.md)
- 模型/Agent 事实源：[`../admin/model-registry.md`](../admin/model-registry.md)
- 研究参考（独立仓库，不作为 qitu 根仓库依赖）：`DeepTutor/deeptutor/services/partners/channel_onboarding.py`
- 目标后端模块：`services/api/src/modules/feishu/`
- 目标管理端页面：`apps/admin-console/app/(console)/settings/feishu/`

## 8. 诊断报告（基线检查）

### D1. QR flow (implemented)

Device Authorization now switches Feishu/Lark account domains and stores the device code encrypted server-side. The admin client creates a machine-scannable QR locally from verificationUriComplete; the explicit authorization link remains available for devices without a camera. OAuth callback state is server-owned.

### D2. Reporting source and asynchronous delivery (implemented)

ReportingService aggregates read-only project, guardian and mentor facts, re-checks the admin gate, and writes an audit event without report text. FeishuReportWorker enqueues through outbox and persists delivery status in feishu_report_deliveries so idempotency survives worker restarts.

### D3. Channel identity binding (implemented)

Feishu open_id is treated only as a channel identity. Binding stores a truncated SHA-256 mapping to the authenticated Qitu administrator; raw identifiers are not written to audit logs or report documents.

### D4. Admin UI state coverage (implemented)

The settings page reads the server assistant directory and covers loading, empty, error, offline, permission failure, polling, countdown, expiry and retry. Local drafts never claim connected until the server projection confirms it.

### D5. Verification environment (release evidence pending)

UNC workspaces can make pnpm fall back to CMD without a current directory. The release record must retain a reproducible pushd or mapped-drive command, exit code, migration dry-run and non-cached test evidence. Targeted Feishu tests pass; full-workspace typecheck still has unrelated stale package errors.

### D6. External delivery boundary (implemented; tenant validation pending)

Sending re-checks assistant enablement, authenticated binding, recipient projection and server credentials. Reports contain only redacted summaries; timeout, rate-limit and network failures are retryable while other failures are terminal.

### D7. Assistant-scoped isolation (implemented)

feishu_bots.assistant_id has a unique constraint, all settings and Device Flow writes carry an assistant scope, idempotency keys include that scope, and only one active session is allowed per assistant.
