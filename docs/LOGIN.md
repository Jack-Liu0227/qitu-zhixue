# 统一登录入口

## 访问入口

```text
http://www.qtzx.de5.net/
```

统一登录后按身份进入：

- 学生：`/student/`
- 家长：`/parent/`
- 班主任：`/teacher/`
- API 健康检查：`/api/v1/health`

## 当前开发演示账号

账号由 API 服务端环境变量控制。未设置环境变量时，初始化默认账号为：

| 身份 | 邮箱 | 密码 |
|---|---|---|
| 学生 | `student@qtzx.local` | `student123` |
| 家长 | `parent@qtzx.local` | `parent123` |
| 班主任 | `teacher@qtzx.local` | `teacher123` |

这些账号只用于当前开发初始化阶段。接入 PostgreSQL 用户系统后，应移除默认账号并通过邀请流程创建用户。

## 认证行为

- API 设置 HttpOnly `qitu_session` Cookie。
- 统一登录页面根据所选身份校验角色。
- 三个前端系统启动时校验 `/api/v1/auth/me`。
- 角色不匹配或会话失效时返回统一登录页。
- 登录态不放入 localStorage。

## HTTPS

当前 Nginx 已绑定 `www.qtzx.de5.net`，但证书申请被该域名的 DNSSEC Bogus 状态阻断。修复 DNSSEC 或关闭 DNSSEC 后，在服务器重新运行：

```bash
sudo certbot --nginx -d www.qtzx.de5.net --non-interactive --agree-tos --register-unsafely-without-email --redirect
```
