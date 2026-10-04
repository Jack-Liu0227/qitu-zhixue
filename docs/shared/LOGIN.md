# 统一登录入口

## 访问入口

域名入口：

```text
http://www.qtzx.de5.net/
```

IP 入口（域名 DNSSEC 修复前可直接使用）：

```text
http://122.51.130.204/
```

> IP 入口经 Nginx 80 端口转发，路径与域名入口完全一致。各前端也直接监听在服务器上（auth 3000、student 3001、parent 3002、teacher 3003、admin 3004），但前端以相对路径调用 `/api/v1/*`，直接按端口访问只能打开页面，登录与鉴权请求需要走 Nginx 80 端口的 IP/域名入口。

统一登录后按身份进入：

- 学生：`/student`
- 家长：`/parent`
- 班主任：`/teacher`
- API 健康检查：`/api/v1/health`

管理员使用独立入口，不经过上述统一登录页：

```text
http://122.51.130.204/admin/login
```

登录成功后进入 `/admin`；未登录或非管理员角色访问 `/admin` 会被重定向回 `/admin/login`。

## 当前开发演示账号

账号由 API 服务端环境变量控制。未设置环境变量时，初始化默认账号为：

| 身份 | 邮箱 | 密码 |
|---|---|---|
| 学生（演示一） | `student@qtzx.local` | `student123` |
| 学生（演示二） | `student2@qtzx.local` | `student123` |
| 家长（演示一） | `parent@qtzx.local` | `parent123` |
| 家长（演示二） | `parent2@qtzx.local` | `parent123` |
| 班主任 | `teacher@qtzx.local` | `teacher123` |
| 管理员 | `admin@qtzx.local` | `admin123` |

管理员账号只在 `/admin/login` 使用，不在统一登录页选择身份。

可通过环境变量覆盖账号和密码：`DEMO_STUDENT_EMAIL` / `DEMO_STUDENT_PASSWORD`、`DEMO_STUDENT2_EMAIL` / `DEMO_STUDENT2_PASSWORD`、`DEMO_PARENT_EMAIL` / `DEMO_PARENT_PASSWORD`、`DEMO_PARENT2_EMAIL` / `DEMO_PARENT2_PASSWORD`、`DEMO_TEACHER_EMAIL` / `DEMO_TEACHER_PASSWORD`、`DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`。

这些账号只用于当前开发初始化阶段。接入 PostgreSQL 用户系统后，应移除默认账号并通过邀请流程创建用户。

## 认证行为

- API 设置 HttpOnly `qitu_session` Cookie。
- 统一登录页面根据所选身份校验角色。
- 四个平台前端启动时校验 `/api/v1/auth/me`。
- 学生/家长/班主任角色不匹配或会话失效时返回统一登录页 `/`。
- 管理员角色不匹配或会话失效时返回独立登录页 `/admin/login`。
- 登录态不放入 localStorage。

## HTTPS

当前 Nginx 已绑定 `www.qtzx.de5.net`，但证书申请被该域名的 DNSSEC Bogus 状态阻断。修复 DNSSEC 或关闭 DNSSEC 后，在服务器重新运行：

```bash
sudo certbot --nginx -d www.qtzx.de5.net --non-interactive --agree-tos --register-unsafely-without-email --redirect
```
