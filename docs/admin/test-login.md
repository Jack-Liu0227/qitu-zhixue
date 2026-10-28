# 测试账号与登录页快捷填充

用户明确要求保留远程测试账号及一键填充账号密码。本次恢复已有 `student-demo`、`parent-demo`、`teacher-demo`、`admin-demo` 的登录，不创建账号、不重置密码、不重跑 seed。

## 服务器配置

仅在需要测试的部署中，将 `QITU_TEST_LOGIN_ENABLED=true` 写入服务器受保护的运行环境，并分别配置 `QITU_TEST_LOGIN_PASSWORD_STUDENT`、`QITU_TEST_LOGIN_PASSWORD_PARENT`、`QITU_TEST_LOGIN_PASSWORD_TEACHER`、`QITU_TEST_LOGIN_PASSWORD_ADMIN`。实际值不进入 Git、日志或文档。

此开关允许上述四个稳定测试身份在 live 模式使用真实目录凭据登录，不改变 `QITU_DATA_MODE`，不启用内存目录、演示消息或前端绕过认证。登录仍执行密码校验、限流、设备会话限制和原有后端角色/对象权限。

开关默认关闭。关掉开关或移除对应角色的密码配置后，该测试身份已有会话会在下一次服务端校验时失效。其他保留演示身份仍按原规则拒绝，正式账号不受影响。

## API 与界面

公开 `GET /api/v1/auth/test-accounts` 返回 `data.accounts`；未启用时为空数组。仅返回上述测试身份，且须与真实目录中的 ID、角色及密码哈希匹配。响应为 `Cache-Control: no-store`，不进入会话投影。不得在日志中打印响应或口令。

登录页依据该接口显示四角色快捷按钮。点击只填入邮箱、密码和身份，由用户再提交登录；不自动执行登录或教学操作。密码保持隐藏，不存入 localStorage。接口不可用时显示重试，正常账号表单仍可使用；断网时禁用测试填充与提交。

错误沿用登录合同：凭据错误或未授权测试身份返回 `INVALID_CREDENTIALS`/401，失效会话返回 `UNAUTHENTICATED`/401，尝试过频沿用 429。快捷目录读取失败由前端提示入口不可用，不能伪造可登录状态。

## 验证

`identity-auth/test-login.test.ts` 验证默认关闭、四角色登录、真实密码校验、关停撤销会话、固定身份边界及目录不匹配过滤。`tooling/test-login-ui.test.mjs` 验证客户端响应解析。

发布时构建真实依赖并运行 API 测试；公网浏览器逐个验证四角色按钮填充、提交、角色回跳与退出。仅保留无口令/会话令牌的汇总；截图遮蔽输入，不归档原始学生对话。

历史回执见 [计划与执行记录](../../Plan/maintenance/usage-records-20261028.md)。