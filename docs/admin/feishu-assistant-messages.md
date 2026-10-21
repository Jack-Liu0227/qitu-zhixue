# 飞书机器人与助手消息绑定

更新日期：2026-10-21。沿用 `/admin/settings/feishu`。助手详情中的“绑定飞书机器人”携带该助手的 canonical ID 进入同一页面。

## 使用与权限

每位助手独立保存 Feishu/Lark 应用、加密凭证、接收开关与管理员映射。切换助手重新读取服务端配置，旧保存、扫码和发送响应不能覆盖当前选择。保存采用服务端回读结果；扫码完成后再次读取 App ID 和启用状态。授权完成、长连接成功与消息发送成功分别显示。

`feishu-reporting-assistant` 即“学生-家长-教师汇报与问题总结助手”。已绑定管理员私聊机器人发送“汇报”“问题总结”或 `/report`，服务端重新核验身份，再调用既有 `ReportingService` 生成脱敏聚合，仅回复请求人。其他文本返回用法提示。群消息、机器人消息、非文本、无映射身份和已撤权管理员不能触发汇报。报告不再引用反馈工单原文片段。

其他助手可独立保存应用和扫码绑定，默认关闭消息接收。开启后，尚无业务处理器的助手只回复“尚未接入消息处理功能”。服务端模块可调用 `FeishuAssistantHandlers.register(assistantId, handler)` 接入，复用连接、身份校验、收件箱与发送协议。当前指令为 `report`、`help`；其他交互需显式扩充受控指令和领域合同。绑定不授予报告、项目、掌握度或成长事实权限，处理器仍须调用各领域 owner。

当前外部身份只映射平台管理员，学生、家长、教师的飞书身份接入尚未开放。配置、扫码、发送、发送记录和连接诊断均为 Admin-only；既有教师受限汇报预览权限保留。凭证只写入服务端加密存储，前端不回显。

## 消息协议与恢复

```mermaid
flowchart LR
  A[Admin 按助手绑定] --> B[每助手独立长连接]
  B --> C[私聊协议与身份校验]
  C --> D[持久化分类指令和身份哈希]
  D --> E[租约领取与当前权限复核]
  E --> F[服务端助手处理器]
  F --> G[租户令牌回复请求人]
  G --> H[消息回执与审计]
```

SDK 回调仅等待校验和收件入库。后台每 5 秒扫描收件箱，临时失败至少间隔 15 秒重试，最多尝试 5 次；崩溃留下的租约在 120 秒后可恢复。收件箱只存指令类型、助手/应用 ID、身份哈希、状态与回复回执，不保存聊天原文或模型输出。领取使用状态与尝试次数，避免 PostgreSQL 微秒时间被 JavaScript 截成毫秒后无法匹配。

主动发送沿用 `POST /api/v1/admin/integrations/feishu/deliver?assistantId=...`，必须提供 `Idempotency-Key`。只有持有租约的请求可以发送，逐收件人持久化回执。部分失败重试跳过已完成收件人，继续使用稳定 provider UUID；新增收件人不扩大同一请求的冻结名单。主动发送的临时失败须再次点击发送，以同一请求重试；页面不宣称已进入自动重试队列。

发送使用 `tenant_access_token`，同时检查 HTTP 状态、飞书 `code === 0` 与 `data.message_id`。HTTP 200 的业务错误不记成功。UUID 辅助提供商去重，本地持久化回执是完成事实。参考 [官方 SDK](https://github.com/larksuite/node-sdk)、[租户凭证](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/tenant_access_token)、[发送消息协议](https://open.feishu.cn/document/server-docs/im-v1/message/create)。

修改 App ID 或 Feishu/Lark 区域会清除旧管理员映射、收件人与未完成授权，须重新扫码，避免继承另一应用的 `open_id`。同一应用同时归属多个启用助手时，长连接拒绝启动。配置/凭证变更会重建连接，禁用助手或接收开关后关闭；每次收发仍实时复核权限。

## 诊断与审计

`GET /api/v1/admin/integrations/feishu/bridge?assistantId=...` 返回实际连接状态、最近接收/回复时间与有界错误码。连接状态不能替代真实消息回执。

| 错误码 | 含义 |
| --- | --- |
| `FEISHU_ASSISTANT_NOT_FOUND` / `FEISHU_ASSISTANT_DISABLED` | 助手不存在或停用 |
| `FEISHU_ASSISTANT_MISMATCH` / `FEISHU_REPORTING_UNSUPPORTED` | 配置归属不一致或尚未接入汇报 |
| `FEISHU_APP_BOUND_MULTIPLE_ASSISTANTS` | 同一应用有多个活动归属 |
| `FEISHU_CREDENTIAL_UNAVAILABLE` / `FEISHU_CONNECTION_FAILED` | 凭证或连接失败 |
| `FEISHU_IDENTITY_UNBOUND` / `FEISHU_ADMIN_REVOKED` | 缺平台映射或已撤权 |
| `FEISHU_NETWORK_UNAVAILABLE` / `FEISHU_HTTP_*` / `FEISHU_API_*` | 传输或业务失败，不存上游原始错误 |
| `FEISHU_MESSAGE_RECEIPT_MISSING` | 缺少成功回执 |
| `FEISHU_BINDING_REVOKED` / `FEISHU_MESSAGE_ATTEMPTS_EXHAUSTED` | 待回复消息绑定失效或尝试次数用尽 |

审计包含原配置/绑定事件、`admin.feishu.message.rejected/replied`、`admin.feishu.report.sent/retryable/failed`。成功标记与审计同事务提交，不写聊天原文、凭证或完整外部身份。

## 发布与验证

先安装锁定依赖，应用 [`0044_feishu_message_bridge.sql`](../../database/migrations/0044_feishu_message_bridge.sql)，再启动新 API；回退时先停止新进程再执行对应 down migration。0044 新增接收开关、最小化收件箱、逐收件人回执与租约字段，不改教学事实，仅为已有启用的汇报助手打开接收，其他助手默认关闭。

飞书应用需启用机器人并发布，长连接订阅 `im.message.receive_v1`，开通 `im:message.p2p_msg:readonly` 与 `im:message:send_as_bot` 等实际所需权限。管理员选中助手，保存区域与接收开关，扫码后私聊验证。长连接不需要新增公网事件回调，原 OAuth 回调兼容保留。

| 事实层 | 本次边界 |
| --- | --- |
| 源码与合同 | 已实现，沿用导航与模块化单体 |
| 隔离 PostgreSQL | 验证真实迁移、领取、并发、部分失败、恢复、扫码与撤权 |
| Admin 浏览器 | 验证助手切换、迟到保存、密钥只写、扫码回读、断网/403 与移动端 |
| 生产配置/发布 | 本次未写业务库、未发布生产 |
| 真实飞书请求 | 本次未向真实租户发消息，发布后仍须核验权限、订阅及真实回执 |

UNC 上的 pnpm 依赖导入崩溃，验证转至本地隔离目录，未加载项目 `.env`。按 `@qitu/contracts`、`@qitu/database`、`@qitu/ai-client`、`@qitu/infra`、`@qitu/agent-memory`、`@qitu/model-runtime` 的依赖顺序构建后，再编译 API、运行飞书测试和 Admin 类型检查。

验证结果：飞书 API 测试 **55/55**，其中 **9** 项连接真实隔离 PostgreSQL、模拟飞书提供商；二维码前端回归 **5/5**；浏览器验证 **9** 个场景通过，未出现页面运行错误。API 全源编译与 Admin 类型检查通过。文档检查为 **117** 份当前/索引文档、**801** 个本地链接、**0** 个问题。浏览器截图和逐项结果保存在本地隔离验证目录，均为合成管理员与合成绑定。

数据库集成测试通过显式 `QITU_FEISHU_TEST_DATABASE_URL` 启用，强制限制到本机可丢弃的 `qitu_feishu_fixture` 数据库；未设置时明确跳过。从 `services/api` 执行：

```powershell
pnpm exec tsc -p tsconfig.json --outDir .tmp/test-dist
node --test '.tmp/test-dist/modules/feishu/*.test.js'
```

仓库已有的素材库/头像、教学运行时、课程与成长投影改动均保留。本次仅在助手详情增加飞书入口，并在既有迁移索引后追加 0044，没有覆盖这些改动；其他业务行为不属于本次飞书验收。
