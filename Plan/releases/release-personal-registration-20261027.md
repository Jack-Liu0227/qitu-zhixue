# 个人自助注册发布验收（2026-10-27）

已发布到 study-remote：[注册页](http://122.51.130.204/login?mode=register)。学生与家长分别创建个人账号；家庭联合注册和邀请入口移除。已有账号、订单、监护关系、学习记录及历史审计保留。

## 用户体验与权限

- 首页与登录页提供“创建个人账号”；注册页使用学生/家长身份选择、邮箱/手机号切换、个人信息与独立密码确认。
- 每次注册只创建一个用户，不建立监护关系、项目或付费事实；家长未绑定时提供平台核验指引。
- 教师与管理员不能自助注册；旧邀请、旧家庭注册接口均返回 404，旧邀请链接清除 fragment 并进入个人注册。
- 用户确认尚未申请阿里云签名/模板，先上线邮箱注册。手机号接口和验证码校验已实现，线上显示“待开通”，不可发送短信。

## 验证

| 范围 | 结果 |
| --- | --- |
| 当前源码依赖构建、API 注册模块与 Admin/家长/登录应用类型检查 | 通过 |
| 本地注册、身份与经营单元测试 | 25 项通过 |
| 独立 PostgreSQL 事务验证 | 18 组通过，合成数据 |
| 隔离浏览器 | 学生/家长独立注册、登录、幂等重试、权限拒绝、手机布局、断网与读取失败、模拟短信路径通过 |
| Linux 生产构建与 API 回归 | 176 项通过；API lint 与三个前端类型/构建通过 |
| 线上冒烟 | 2 组通过，浏览器运行错误 0；没有创建生产测试账号或发送实际短信 |
| 迁移与运行状态 | 0055 已应用；数据库/Redis 就绪、前端资源与 Nginx 检查通过 |

短信测试使用独立 fixture，不能代替阿里云实际送达验收。邮箱当前作为登录标识，未发送验证邮件，不宣称已核验邮箱或监护人实名身份。正式短信配置见 [短信注册](../../docs/admin/sms-registration.md)。站点当前仍使用 HTTP，HTTPS 尚未配置。

## 发布与数据保护

- 基于远端 b4a0b870327800e55170db631343ad8a582345bc 的受限文件覆盖，共 46 个路径；未切换生产工作树或覆盖其他功能修改。
- 1845 个非本次目标源码文件完成保留校验。共享工作区 Tutor、课件/教学合同、学习计划及其他管理端改动未纳入发布；完整清单见 [保留改动记录](../issues/assets/20261027-personal-registration/preserved-workspace-changes.json)。它们的行为不计入本次注册验收。
- 加密数据库与代码/构建备份：/var/backups/qitu-personal-registration-20261027-r2。已核验解密及 pg_restore 目录；未执行整库恢复演练。
- 首次发布因登录应用缺少 @qitu/api-client 依赖声明触发回滚，服务恢复。补齐 workspace 依赖及锁文件后重新发布成功。0055 的兼容性新增列和表在回滚期间保留，未删除账号或学习数据。
- 阿里云访问密钥、签名和模板仍未配置；验证码摘要密钥只存在服务器受限环境文件。旧邀请密钥不再被产品代码使用，历史记录保留用于追溯。

证据：[本地验证](../issues/assets/20261027-personal-registration/verification-summary.json)、[PostgreSQL](../issues/assets/20261027-personal-registration/postgres-results.json)、[浏览器](../issues/assets/20261027-personal-registration/browser-results.json)、[线上验收](../issues/assets/20261027-personal-registration/production-results.json)、[发布清单](../issues/assets/20261027-personal-registration/release.json)。
