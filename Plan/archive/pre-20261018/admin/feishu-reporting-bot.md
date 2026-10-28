# 飞书 / Lark 管理者汇报机器人

管理员可在 `/settings/feishu` 配置一个飞书（国际版称 Lark）应用，将学生、家长和教师状态摘要发送到绑定的管理者会话。原始未成年人对话、语音和凭证不会写入配置或审计详情。

## 配置顺序

1. 在飞书开放平台创建企业自建应用，启用 OAuth 与机器人能力。
2. 将 `QITU_FEISHU_REDIRECT_URI` 设置为绝对 HTTPS 地址，并将同一地址登记到应用的 OAuth 重定向白名单。仅本地 `localhost` / `127.0.0.1` 调试允许 HTTP。
3. 执行 `database/migrations/0024_feishu_bot.sql`，再执行种子 `database/seeds/feishu-reporting-assistant.sql`（内置助手模型为 `gpt-6.1-sol`）。
4. 在管理后台填写 App ID、App Secret、Verification Token、Encrypt Key，并选择汇报助手。密钥使用 `QITU_MODEL_SECRET_KEY` 加密后落库，响应只返回是否已配置。
5. 点击“手机扫码绑定”。服务器通过 OAuth code 换取用户标识，将其加入 `reportRecipients`（去重），二维码会话状态变为 `bound`。轮询 `GET /api/v1/admin/integrations/feishu/qr-sessions/:id` 可获得状态。

## API 与安全约束

- `GET/PATCH /api/v1/admin/integrations/feishu` 仅管理员可用；PATCH 必须携带 `Idempotency-Key`。
- `POST /api/v1/admin/integrations/feishu/qr-sessions` 创建十分钟有效的一次性会话，同样要求幂等键。
- `/api/v1/integrations/feishu/oauth/callback` 不要求登录，但必须匹配服务端生成的随机 `state`；授权码只用于服务端交换，不持久化。
- 所有绑定和配置变更写入审计日志。审计中仅保存接收者哈希，不保存原始 open_id、授权码或密钥。
