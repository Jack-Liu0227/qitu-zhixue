# 阿里云短信注册

登录页保留邮箱自助注册，并提供手机号注册。学生与家长分别验证自己的手机号后设置密码，一次只创建一个账号。四端继续使用原统一认证与后端权限。

## 服务器配置

实际值只写入服务器受限环境文件，不能提交仓库或放入浏览器。study-remote 当前由 `/etc/qitu/launch-api-main.sh` 读取 canonical worktree 的 `tooling/qitu-ports.env`。修改后重启 `qitu-api`。

| 变量 | 内容 |
| --- | --- |
| `QITU_ALIYUN_SMS_ACCESS_KEY_ID` | 有 SendSms 权限的 RAM 身份 AccessKey ID |
| `QITU_ALIYUN_SMS_ACCESS_KEY_SECRET` | 对应服务器密钥 |
| `QITU_ALIYUN_SMS_SIGN_NAME` | 阿里云已审核通过的短信签名 |
| `QITU_ALIYUN_SMS_TEMPLATE_CODE` | 已审核验证码模板编号，形如 `SMS_…`，变量为 `code` |
| `QITU_SMS_VERIFICATION_KEY` | 至少 32 字符的随机验证码摘要密钥，由部署生成并持久保存 |

不要在有待验证短信时轮换摘要密钥；轮换后旧验证码失效。服务器需要能访问 `https://dysmsapi.aliyuncs.com`。配置缺失或模板编号非法，公开注册策略的 `phoneRegistration.available` 为 false，页面明确提示使用邮箱。此字段为配置就绪状态，不代表供应商审核、余额或实际送达已验收。

## 接口与行为

`GET /api/v1/public/account-registration` 返回服务说明、版本摘要和短信配置状态。`POST /api/v1/public/account-registration/sms` 接收 `phone`、`policyVersion`、`acceptedSmsTerms: true` 及 32 位随机十六进制 `Idempotency-Key`，返回 challengeId、expiresAt、retryAfterSeconds。短信同意仅授权本次注册验证码，不订阅营销。

`POST /api/v1/public/account-registration` 的手机号方式使用 `method: phone`、`phone`、`challengeId`、`code` 和称呼、student/parent 身份、个人密码及使用授权。邮箱方式使用 `method: email`、`email`。返回 login 和 role。登录沿用历史 `email` 字段传手机号或邮箱，不修改既有 Cookie 与角色规则。

验证码有效期 5 分钟，最多 5 次错误。每手机号 60 秒内最多发送一次、每天最多 5 次；每来源每小时最多 20 次；全站每天最多 500 次。限额由共享数据库锁与发送记录维护，失败发送同样计入。丢失发送响应可用相同请求键重取已发送回执；发送结果不确定时不自动再调用供应商，等待冷却后重新请求。

短信表仅存 HMAC 摘要、时限、状态和消费关联；账号表存已验证手机号。验证码记录超过 7 天在下一发送请求清理。一般目录与成长投影不返回手机号。账号、验证码消费与注册审计在同一事务提交。接口错误码为 `REGISTRATION_SMS_INVALID`、`REGISTRATION_SMS_RATE_LIMITED`、`REGISTRATION_SMS_UNAVAILABLE`，不返回供应商原始异常或凭据。

## 验收与回滚

先运行 `node tooling/verify-business-operations.mjs --registration-only`，再用专用本地 PostgreSQL 执行 `tooling/test-business-postgres.mjs`。短信 fixture 只存在于测试 runner，绑定 loopback，使用独立临时数据库；产品代码无固定验证码或绕过接口。

配置完成后，使用运营者授权号码实际获取短信并完成注册、手机号密码登录和重复提交验收。不要用真实学生数据造数。真实供应商发送尚未验收时，报告必须明确区分代码、配置和实际送达。

API 启动前应用 0055 数据库迁移。发布失败可还原代码和构建，保留向前兼容的新列和短信表；若已有手机号专用账号，0055 down 迁移拒绝删除登录信息，须先制定数据迁移方案。

实现依据：[阿里云 SendSms](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)、[ACS3 请求签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)。
