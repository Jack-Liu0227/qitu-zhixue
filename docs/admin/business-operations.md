# 一人运营工作区

入口为现有 `/admin/settings/ops`，主导航不变。官网 `/showcase` 展示项目包；家长首页提供课程订单；统一登录页 `/login?mode=register` 支持个人自助注册。关联 [实施 Issue](../../Plan/issues/20261026-one-person-operations.md) 和 [注册变更](../../Plan/issues/20261026-family-self-registration.md)。

## 商品与经营配置

管理员填写经营主体、客服邮箱、备案/业务范围说明，以及正式隐私、服务、退款条款。资料完整只表示已填写，不代表平台已经核验主体资质、教育业务资质、版权或备案。项目包必须绑定已发布且具有 active 教学安排的平台课程版本，填写适用人群、成果、整数分价格和有效期。

商品支持草稿、发布、下架。首次发布后课程版本与购买门槛冻结。后续价格/文案修改产生新修订，原订单继续使用其商品及条款快照。售卖开关和支付商户配置均通过后才能下单。已有项目不会因新增商业配置而改写教学状态。

## 个人注册与权限

学生和家长从首页或登录页分别注册，无需邀请。公开注册仅创建一个新账号，只允许学生或家长角色，不建立监护关系或覆盖已有账号。教师和管理员账号继续由平台管理。旧邀请接口已移除，历史邀请表与审计保留，不再使用邀请签名密钥。

用户填写自己的称呼，选择学生或家长身份、邮箱或短信验证手机号，设置至少 12 位密码，阅读服务端账号开通说明及已配置的服务/隐私文本，确认服务条款与成年或已获监护人同意的声明。注册不依赖商户、售卖开关或项目包；说明内容摘要用于版本校验。Directory owner 在同一事务创建一个账号、异步 scrypt 密码记录和审计，不创建正式项目。重复提交持久去重，写入后响应丢失可恢复。已有账号、订单和学习记录保留。家长查看孩子数据前，通过既有平台受控流程核验监护关系；注册本身不授予访问学生的权限。

手机号注册采用阿里云短信；服务器配置、限额、错误码和真实短信验收见 [短信注册](./sms-registration.md)。配置不全时手机号注册明确不可用，邮箱方式继续开放。短信验证成功仅证明本次号码接收能力，不证明监护人实名身份。

当前邮箱仅作为登录标识，没有发送验证邮件，也不宣称已核验邮箱或真实监护身份。注册接口按来源限流 15 分钟 10 次，并限制四个并发注册；计数为单实例内存状态，重启会清空，多实例前须改为共享限流。密码和原始请求不写入审计，审计只含说明版本、授权确认及来源。幂等请求摘要使用慢速加盐派生，不保存原始密码。正式售卖仍须补齐真实经营资料、条款和商户验收。

家长每次读取订单、获取支付码、查询支付及申请退款，服务端核对购买人和当前监护关系。Admin-only 经营读取记录审计。咨询联系人、订单和成长原文不进入公开接口；用量记录不保存提示词或对话正文。

## 微信支付 Native

仅服务器访问固定微信支付 API 域名。下单请求使用商户私钥签名；响应和通知校验微信公钥标识、时间、原始字节与 RSA 签名，通知使用 APIv3 密钥解密。平台再次核对商户、应用、币种、冻结金额和交易凭据，数据库事务更新订单及审计。浏览器的“查询”本身不是支付证明。

服务器需要以下配置，禁止将实际值提交仓库：

| 变量 | 用途 |
| --- | --- |
| `QITU_PAYMENT_PUBLIC_ORIGIN` | 正式 HTTPS 公网 origin，不含业务路径 |
| `QITU_WECHAT_APP_ID` | 已关联商户的应用 |
| `QITU_WECHAT_MERCHANT_ID` | 商户号 |
| `QITU_WECHAT_CERT_SERIAL` | 商户 API 证书序列号 |
| `QITU_WECHAT_PRIVATE_KEY_FILE` | 受限商户 RSA 私钥文件路径 |
| `QITU_WECHAT_PUBLIC_KEY_ID` | 当前微信支付验签公钥标识 |
| `QITU_WECHAT_PUBLIC_KEY_FILE` | 微信支付 RSA 公钥文件路径 |
| `QITU_WECHAT_API_V3_KEY` | 32 字节通知解密密钥 |

通知地址为 `/api/v1/business/payments/wechat`，服务器保留此路由有界的原始 JSON 字节。必须先执行 0054 迁移，再发布依赖新表的 API。配置存在不等于商户联调完成，页面明确展示此边界。上线前需用真实商户完成下单、查询、重复通知、退款及公钥轮换验收。

参考 [微信 Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[APIv3 签名与验签](https://pay.wechatpay.cn/doc/v3/merchant/4012365342)。

## 订单与教学边界

订单状态为 pending、paid、refund_requested、refunding、refunded、cancelled。请求键与交易凭据具有唯一约束。金额、商品版本、条款版本、孩子与购买人由服务端冻结，客户端不能传入付款或学习判定。

商户订单号使用 32 位十六进制标识。过期订单保留待核对状态，家长查询时先查单，再向商户关单；关闭确认前不允许同一课程重复下单。关单超时或验签失败保持原状态并允许重试。未收到支付凭据不能仅凭本地过期时间判为未付款。该流程对应 [微信关闭订单接口](https://pay.wechatpay.cn/doc/v3/merchant/4012791881)。

付款仅提供对应孩子及确切课程版本的访问权益。两条正式项目确认路径在原事务中校验权益，理论掌握、课时完成和作品评价仍由原 owner 判定。曾发布并明确要求购买的版本在商品下架后仍检查权益。未受商业控制的旧课程继续沿用原合同。

家长申请全额退款，管理员明确确认后通过商户接口原路退回。已保存的退款意图使用稳定退款单号重试；收到成功回执前保持“退款处理中”。退款失败回到待处理状态，需经营者对照商户后台核实。退款不删除学习证据，确认退款后不能再凭该订单新建项目。当前实现不自动撤销已经开始的项目；服务条款须明确此边界。

发票、特殊退款和合同争议通过配置的客服渠道处理，本版本未对接税务开票接口。

## 经营数据、成本和运营检查

统计读取真实订单、咨询及现有 Projects 完成事实。交付聚合匹配孩子、确切课程版本及订单创建后的项目；不会把购买、课时位置或聊天摘要算作完成。计数口径不同，页面不把这些计数直接宣称为严格用户转化率。

ModelGateway 在成功返回时记录调用用途、供应商、模型及有界 token 元数据；缺上游用量保持未知，不计为零。记录失败进入服务端告警，页面只称“已记录调用”，不宣称账单完整。当前不支持按孩子/项目自动分摊模型成本。

成本账支持供应商账单、支付手续费、服务器/存储、客服交付及其他成本，记录实际金额、人工分钟与可选关联订单。界面展示“实收扣退款及已记录成本后结余”，不将漏记成本算成已核实利润。

定时检查默认关闭，Admin 启用后每 5 分钟创建超时咨询、退款、已开通但未确认项目的持久化待办。唯一引用防止重复任务，管理员处理咨询可同步关闭对应待办。手动检查和定时检查均审计，不向外部渠道发送消息。当前提醒只在工作区内展示，外部故障通知、客户自动触达与运营日报推送需要后续明确配置及渠道验收。

运维状态取实际 `/health/ready` 依赖探针，不能用静态状态替代。数据库备份脚本已存在，但本次不代表生产 HTTPS、异地备份和恢复演练已完成。

## API 与错误

Admin 端使用 `/admin/business`、`settings`、`offers`、`expenses`、`leads/:id`、`tasks/:id/resolve`、`check` 和 `orders/:id/refund`。家长端使用 `/parent/children/:studentId/orders`、`/parent/orders` 及订单 checkout、reconcile、refund。公开只读目录为 `/public/project-offers`；`GET /public/account-registration` 读取注册说明，`POST /public/account-registration` 创建个人账号，要求 32 位随机十六进制 `Idempotency-Key`。

所有配置/商品/订单/成本/线索写入使用原持久幂等服务，业务及审计同事务。支付与退款回执通过订单行锁、稳定交易身份和状态检查去重。运营检查通过待办唯一约束去重。响应成功后前端回读，回读失败显示“待核实”。

主要错误码为 `BUSINESS_INPUT_INVALID`、`BUSINESS_NOT_READY`、`BUSINESS_CONFLICT`、`BUSINESS_ACCESS_DENIED`、`BUSINESS_COURSE_UNAVAILABLE`、`BUSINESS_ENTITLEMENT_REQUIRED`、`PAYMENT_UNAVAILABLE`、`PAYMENT_SIGNATURE_INVALID`、`PAYMENT_FACT_CONFLICT`。注册使用 `ACCOUNT_REGISTRATION_INVALID`、`ACCOUNT_REGISTRATION_CONSENT_REQUIRED`、`ACCOUNT_REGISTRATION_CONFLICT`、`ACCOUNT_REGISTRATION_POLICY_CHANGED`、`ACCOUNT_REGISTRATION_RATE_LIMITED`、`ACCOUNT_REGISTRATION_UNAVAILABLE`。权限失败不返回其他家庭对象。

## 验证

`node tooling/verify-business-operations.mjs` 按真实依赖图构建源码包，检查 API 与三个应用类型，并执行业务、项目、计划、认证和模型网关回归。使用隔离输出及源码解析钩子，不覆盖 UNC 安装快照。

`tooling/test-business-postgres.mjs` 仅接受专用本地非 5432 端口 fixture，创建并销毁独立数据库，执行真实 PostgreSQL 事务、幂等、回调事实、监护撤权、自助注册和会话恢复测试。注册场景由 `test-account-registration-postgres.mjs` 组合执行，包含并发邮箱竞争、说明变更、存量账号保护和丢失幂等回执后的恢复。测试数据是合成 fixture，不构成真实支付或教学效果验收。
