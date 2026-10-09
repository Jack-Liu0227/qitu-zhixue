# 统一登录与会话

> 实现：`services/api/src/modules/identity-auth/`、`packages/auth`、`apps/auth-portal` 和四个角色应用的 `AuthGuard`。
> 相关：[`permissions.md`](./permissions.md)、[`deployment.md`](./deployment.md)。

## 1. 统一身份登录

平台按**身份**统一登录：同一个登录入口按角色把用户送到对应端。

公开官网（`/`）与统一登录（`/login`）同在 `apps/auth-portal`，都无需登录即可访问；
首页所有入口均指向 `/login`（见 [`public-site.md`](./public-site.md)）。

| 角色      | 登录后落地       |
| --------- | ---------------- |
| `student` | `/student`       |
| `parent`  | `/parent`        |
| `teacher` | `/teacher`       |
| 健康检查  | `/api/v1/health` |

**管理端入口**：`/admin`；未登录时由前端守卫回到 `/login`，不再维护独立的 `/admin/login` 页面。

前端通过相对路径调用 `/api/v1/*`，因此**必须**经统一入口（Nginx 端口 80）访问，
不能直连各应用端口。端口约定与反向代理见 [`deployment.md`](./deployment.md)。

## 2. 会话与 Cookie

- API 在登录成功后下发 HttpOnly cookie **`qitu_session`**。
- 前端**不使用 `localStorage`** 保存登录态。
- `AuthGuard`（`packages/auth`）按 `expectedRole` 做前端路由保护，但**只是体验层**；
  所有对象级权限仍由后端判定（见 [`permissions.md`](./permissions.md)）。
- 当前会话由 API 进程内的受限 session store 管理，默认 8 小时，勾选记住登录时 30 天；重启 API 会使进程内会话失效。数据库中的 `sessions` 表尚未接入持久化轮换与跨实例撤销。

## 3. 演示账号

演示账号只由 `database/seeds/demo-identities.sql` 在 `demo` / `test` 数据模式创建，登录页的测试账号按钮也只适用于共享演示环境。账号和口令不写入文档、提交记录或生产配置；具体值由部署环境通过受限种子和 `DEMO_*` 环境变量管理。

| 账号 | 默认邮箱 | 角色 |
|---|---|---|---|
| 学生 | `student@qtzx.local` | student |
| 学生 2 | `student2@qtzx.local` | student |
| 家长 | `parent@qtzx.local` | parent |
| 家长 2 | `parent2@qtzx.local` | parent |
| 班主任 | `teacher@qtzx.local` | teacher |
| 管理员 | `admin@qtzx.local` | admin |

覆盖变量：`DEMO_*_EMAIL` / `DEMO_*_PASSWORD`。
演示账号只在 `demo` 数据模式下有意义（见 [`initialization.md`](./initialization.md)）；
`live` 环境不注入演示账号，缺少种子时登录失败是预期行为。

## 4. 域名与访问

| 用途     | 地址                                                             |
| -------- | ---------------------------------------------------------------- |
| 主域名   | `http://www.qtzx.de5.net/`                                       |
| IP 回退  | `http://122.51.130.204/`                                         |
| 统一登录 | `http://122.51.130.204/login`                                    |
| 管理端   | `http://122.51.130.204/admin`（未登录时由前端守卫回到 `/login`） |

> HTTPS 曾因 `www.qtzx.de5.net` 的 DNSSEC Bogus 被阻断；修复方式：
> `certbot --nginx -d www.qtzx.de5.net ...` 签发证书后再启用。

## 5. 状态与错误

- 未登录访问受保护路由 → 前端跳转登录，后端返回 `401`。
- 角色不符 → 前端 `AuthGuard` 带出原因（如 admin-console 的 `qitu.admin.auth-denied`），后端返回 `403`。
- 登录接口必须覆盖 loading / error / 断网状态；不得把失败渲染为成功。

## 6. 未决事项

- [ ] 将 session store 接入持久化 `sessions` 表，并支持跨实例轮换和撤销。
- [ ] MFA、会话轮换与撤销。
- [ ] 跨角色账户面（凭证、设备会话、退出）。
