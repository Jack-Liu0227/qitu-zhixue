# 公开官网与公开接口

> 实现：`apps/auth-portal`；公开接口：`services/api/src/modules/public-content/`。
>
> 产品叙事见 [`../aboutus/README.md`](../aboutus/README.md)，部署与访问见 [`deployment.md`](./deployment.md)。

## 1. 入口与路由

官网和统一登录由 `apps/auth-portal` 提供，生产入口通过 Nginx 代理到 `3100`。公开页面不需要登录，角色应用由统一登录后的服务端会话和前端守卫保护。

| 路径                                            | 内容                                               | 登录 |
| ----------------------------------------------- | -------------------------------------------------- | ---- |
| `/`                                             | 首页主张、项目式学习摘要、能力摘要、公开作品和入口 | 否   |
| `/learning`                                     | 项目式学习路径和阶段                               | 否   |
| `/competencies`                                 | 能力维度和过程性成长                               | 否   |
| `/showcase`                                     | 公开模板和作品展示                                 | 否   |
| `/about`                                        | 关于启途智学、团队和品牌                           | 否   |
| `/contact`                                      | 联系方式和咨询提交                                 | 否   |
| `/login`                                        | 四类角色统一登录                                   | 否   |
| `/student/`、`/parent/`、`/teacher/`、`/admin/` | 角色应用                                           | 是   |

首页旧 fragment（例如 `/#pbl`、`/#about`）由客户端映射到正式页面路由；fragment 不会发送到服务器，因此不能由 Nginx 做 301。

## 2. 首页数据来源

首页是服务端渲染页面，业务数字和公开模板不由前端硬编码：

| 展示内容                                               | 数据来源                                            |
| ------------------------------------------------------ | --------------------------------------------------- |
| 学习者、学校、公开模板、公开作品统计                   | `GET /api/v1/public/home` 的 `stats`                |
| 模板卡片的学科、适龄、难度、时长、阶段、版本和更新时间 | `GET /api/v1/public/home` 的 `templates`            |
| 项目式学习步骤、能力说明、品牌信息                     | `apps/auth-portal/app/public-content.ts` 的静态内容 |
| 咨询线索                                               | `POST /api/v1/public/consultations`                 |

公开聚合只包含 `role=student` 且未停用用户数量、active school、平台级 published template，以及 `visibility in ('school','public')` 的已发布作品。学生私有数据、原始对话、语音、Agent 提示词和模型凭证不能进入公开投影。

## 3. 公开接口合同

```http
GET  /api/v1/public/home
POST /api/v1/public/consultations
```

`GET /public/home` 返回 `{ data: { stats, templates, generatedAt } }`，允许公开缓存 60 秒并在 300 秒内 stale-while-revalidate。

`POST /public/consultations` 是不要求签名凭据的公开咨询写入口：

- 必须携带 `Idempotency-Key` 或 `X-Idempotency-Key`，长度由服务端限制。
- 只接受白名单字段 `name`、`phone`、`identity`、`message`；`identity` 只能是 `student`、`parent` 或 `school`。
- 服务端校验长度、电话格式、未知字段和幂等冲突；数据库不可用时返回 `CONSULTATION_UNAVAILABLE`，不能假装写入成功。
- 写入 `consultation_requests`、`idempotency_keys` 和审计记录，不保存 IP、UA 或其他额外访客追踪信息。

## 4. 页面状态

公开页面和咨询表单要覆盖：

| 状态              | 行为                                                         |
| ----------------- | ------------------------------------------------------------ |
| loading           | 使用路由 loading 骨架，并保持内容槽位稳定                    |
| empty             | 没有公开模板或作品时给出清晰空态和探索入口                   |
| error             | 只展示安全错误摘要和重试，不泄露内部异常                     |
| offline           | 禁止提交咨询，保留当前页面内容并提示网络恢复                 |
| permission-denied | 公开页不泄露受保护对象是否存在，角色页由统一登录处理         |
| API unavailable   | 统计显示 unavailable/`—`，不得伪造数字；公开模板回到明确空态 |

## 5. 品牌与内容边界

公开页面使用产品名称“启途智学”和 `QITU ZHIXUE` 标识，品牌资产位于 `apps/auth-portal/public/brand-logo.png`、`brand-mark.png`。关于产品定位和 AI 与人共成长的内容维护在 [`../aboutus/README.md`](../aboutus/README.md)，不要把营销文案复制为接口或权限合同。

首页展示三个中学生项目案例（无人机工程、桌面机器人、光的衍射与散射），由生成图片合成无声短片，不是真实学生录像。历史剧本、素材来源及减弱动态/离线降级设计见 [已归档的品牌故事草案](../../Plan/archive/pre-20261018/design/brand-story.md)；当前产品叙事以 [`../aboutus/README.md`](../aboutus/README.md) 为准。导航与公开数据接口保持不变。

## 6. 当前能力与限制

- 咨询线索的 Admin 受控跟进与审计，入口为现有运维页。
- 提供经营主体、隐私政策、未成年人数据说明和备案信息的配置与展厅公示；正式文案及资质由经营者核实。
2026-10-26：展厅加入由服务端返回的项目包与条款，购买入口指向家长登录。按用户后续要求移除邀请制，首页和登录页提供 `/login?mode=register` 自助注册。`GET/POST /public/account-registration` 分别读取说明和创建个人账号；每次仅创建一个学生或家长账号，不接受特权角色、家庭联合注册字段或已有用户 ID。保留当前导航，注册表单覆盖说明加载、失败重试、断网禁写和注册后对应身份登录引导。详见[一人运营工作区](./business-operations.md)。

[相关计划与执行记录](../../Plan/maintenance/usage-records-20261028.md)。

## 介绍页首屏排版

注册表单提供邮箱、手机号切换；手机号入口按服务器返回的短信配置状态显示，验证码请求提供单独同意、发送进度、冷却倒计时和错误重试。未配置短信时明确提示邮箱方式可用，不能伪装验证码已发出。登录框接受手机号或邮箱。

项目式学习、能力体系、关于我们使用 `public-hero--wide`：标题占满容器宽度，
主句与强调句按语义分行，字号 36–72px、行高 1.18；简介与提示卡片位于标题下方双列。
800px 以下改为单列。验收覆盖手机、平板与桌面，并检查卡片在首屏可见。
