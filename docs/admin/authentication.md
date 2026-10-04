# 统一登录与会话

> 实现：`services/api/src/modules/identity-auth/`、`packages/auth`、四个前端的 `AuthGuard`。
> 相关：[`permissions.md`](./permissions.md)、[`deployment.md`](./deployment.md)。

## 1. 统一身份登录

平台按**身份**统一登录：同一个登录入口按角色把用户送到对应端。

| 角色 | 登录后落地 |
|---|---|
| `student` | `/student` |
| `parent` | `/parent` |
| `teacher` | `/teacher` |
| 健康检查 | `/api/v1/health` |

**管理端单独入口**：`/admin/login` → `/admin`。

前端通过相对路径调用 `/api/v1/*`，因此**必须**经统一入口（Nginx 端口 80）访问，
不能直连各应用端口。端口约定与反向代理见 [`deployment.md`](./deployment.md)。

## 2. 会话与 Cookie

- API 在登录成功后下发 HttpOnly cookie **`qitu_session`**。
- 前端**不使用 `localStorage`** 保存登录态。
- `AuthGuard`（`packages/auth`）按 `expectedRole` 做前端路由保护，但**只是体验层**；
  所有对象级权限仍由后端判定（见 [`permissions.md`](./permissions.md)）。
- 当前会话在进程内保存，过期即失效；持久化 `sessions` 表与轮换 / 撤销**尚未实现**。

## 3. 演示账号

演示账号来自 `database/seeds/demo-identities.sql`（幂等）。邮箱 / 密码可用环境变量覆盖。

| 账号 | 默认邮箱 | 默认密码 | 角色 |
|---|---|---|---|
| 学生 | `student@qtzx.local` | `student123` | student |
| 学生 2 | `student2@qtzx.local` | `student123` | student |
| 家长 | `parent@qtzx.local` | `parent123` | parent |
| 家长 2 | `parent2@qtzx.local` | `parent123` | parent |
| 班主任 | `teacher@qtzx.local` | `teacher123` | teacher |
| 管理员 | `admin@qtzx.local` | `admin123` | admin |

覆盖变量：`DEMO_*_EMAIL` / `DEMO_*_PASSWORD`。
演示账号只在 `demo` 数据模式下有意义（见 [`initialization.md`](./initialization.md)）；
`live` 环境不注入演示账号，缺少种子时登录失败是预期行为。

## 4. 域名与访问

| 用途 | 地址 |
|---|---|
| 主域名 | `http://www.qtzx.de5.net/` |
| IP 回退 | `http://122.51.130.204/` |
| 管理端 | `http://122.51.130.204/admin/login` |

> HTTPS 曾因 `www.qtzx.de5.net` 的 DNSSEC Bogus 被阻断；修复方式：
> `certbot --nginx -d www.qtzx.de5.net ...` 签发证书后再启用。

## 5. 状态与错误

- 未登录访问受保护路由 → 前端跳转登录，后端返回 `401`。
- 角色不符 → 前端 `AuthGuard` 带出原因（如 admin-console 的 `qitu.admin.auth-denied`），后端返回 `403`。
- 登录接口必须覆盖 loading / error / 断网状态；不得把失败渲染为成功。

## 6. 未决事项

- [ ] 持久化 `sessions` 表与迁移（`roles` / `identities` / `sessions` 正式结构）。
- [ ] MFA、会话轮换与撤销。
- [ ] 跨角色账户面（凭证、设备会话、退出）。
